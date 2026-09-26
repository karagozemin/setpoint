import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatUnits, type Hash } from "viem";
import { solveAdaptive, type AdaptiveSolveInput } from "../../../src/core/adaptive-solver.js";
import { WAD, targetRegionReached } from "../../../src/core/policy.js";
import type { PortfolioState, SolveInput, SolveResult, Trade } from "../../../src/core/types.js";
import { buildStaticBaseline, grossTurnover } from "./baseline.js";
import { loadConfig } from "./config.js";
import { sampleRwaLiquidity } from "./liquidity-sampler.js";
import type { PortfolioState as RwaPortfolioState } from "./math.js";
import { rwaScenarioDefinitions, type RwaScenarioDefinition } from "./scenario-matrix.js";
import { RwaIndexSetpointAdapter, type RawOraclePoint, type RwaDeployment, type RwaGuardState } from "./setpoint-adapter.js";

const config = loadConfig();
const RANGE_TOLERANCE = 25n * 10n ** 14n;
const QUOTE_MAX_AGE = 60n;
const MAX_SIMULATION_ATTEMPTS = 6;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface BaselineCycle {
  cycle: number;
  stateBefore: ReturnType<typeof summarizeState>;
  trades: Trade[];
  turnover: bigint;
  simulation: Awaited<ReturnType<RwaIndexSetpointAdapter["simulate"]>>;
  executionHash?: Hash;
  stateAfter?: ReturnType<typeof summarizeState>;
}

interface AdaptiveCycle {
  cycle: number;
  stateBefore: ReturnType<typeof summarizeState>;
  liquidityArtifact: string;
  result: SolveResult;
  executionHash?: Hash;
  stateAfter?: ReturnType<typeof summarizeState>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jsonValue(value: unknown): Json {
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  return String(value);
}

function units(value: bigint): string {
  return formatUnits(value, 18);
}

function pctWad(value: bigint): string {
  return `${(Number(value) / 1e16).toFixed(6)}%`;
}

function symbolFor(token: string): string {
  return Object.entries(config.symbols).find(([address]) => address.toLowerCase() === token.toLowerCase())?.[1] ?? token;
}

function summarizeState(state: PortfolioState) {
  return {
    stateId: state.stateId,
    blockNumber: state.blockNumber,
    blockTimestamp: state.blockTimestamp,
    nav: state.nav,
    navFormatted: units(state.nav),
    drift: state.drift,
    driftFormatted: pctWad(state.drift),
    baseAssetBalance: state.baseAssetBalance,
    baseAssetWeight: state.baseAssetWeight,
    positions: state.positions.map((position) => ({ ...position, symbol: symbolFor(position.token) }))
  };
}

function asBaselineState(input: SolveInput): RwaPortfolioState {
  return {
    blockNumber: input.state.blockNumber,
    nav: input.state.nav,
    drift: input.state.drift,
    cash: input.state.baseAssetBalance,
    cashTarget: midpoint(input.policy.cashTarget.min, input.policy.cashTarget.max),
    assets: input.state.positions.map((position) => {
      const assetPolicy = input.policy.assets.find(({ token }) => token.toLowerCase() === position.token.toLowerCase());
      const price = input.prices.find((point) => point.token.toLowerCase() === position.token.toLowerCase());
      assert(assetPolicy && price, `missing baseline mapping for ${position.token}`);
      return {
        address: position.token,
        symbol: symbolFor(position.token),
        balance: position.balance,
        price: price.priceWad,
        updatedAt: price.updatedAt,
        value: position.value,
        weight: position.weight,
        targetWeight: midpoint(assetPolicy.target.min, assetPolicy.target.max)
      };
    })
  };
}

function midpoint(minimum: bigint, maximum: bigint): bigint {
  return minimum + (maximum - minimum) / 2n;
}

function benchmarkStatus(input: SolveInput, guards: RwaGuardState) {
  return {
    vaultTriggerSatisfied: input.state.drift <= guards.driftThreshold,
    targetBandsSatisfied: targetRegionReached(input.state, input.policy.assets, input.policy.cashTarget)
  };
}

async function runCommonBaseline(
  adapter: RwaIndexSetpointAdapter,
  definition: RwaScenarioDefinition,
  guards: RwaGuardState
) {
  const initial = await adapter.readSolveInput(RANGE_TOLERANCE);
  const cycles: BaselineCycle[] = [];
  let attemptedTurnover = 0n;
  let executedTurnover = 0n;
  let executedLegs = 0;
  let terminalReason = "MAX_CYCLES";

  for (let cycle = 1; cycle <= definition.maxCycles; cycle++) {
    const before = await adapter.readSolveInput(RANGE_TOLERANCE);
    if (benchmarkStatus(before, guards).targetBandsSatisfied) {
      terminalReason = "TARGET_BANDS_SATISFIED";
      break;
    }
    const rwaState = asBaselineState(before);
    const trades = buildStaticBaseline(rwaState, before.policy.baseAsset, guards);
    if (trades.length === 0) {
      terminalReason = "NO_PLAN";
      break;
    }
    const turnover = grossTurnover(trades, rwaState, before.policy.baseAsset);
    const simulation = await adapter.simulate(trades);
    const record: BaselineCycle = { cycle, stateBefore: summarizeState(before.state), trades, turnover, simulation };
    cycles.push(record);
    attemptedTurnover += turnover;
    if (!simulation.passed) {
      terminalReason = simulation.failureCode ?? "SIMULATION_REJECTED";
      break;
    }
    const hash = await adapter.execute(trades);
    const after = await adapter.readSolveInput(RANGE_TOLERANCE);
    assert(after.state.drift < before.state.drift, "baseline execution did not reduce authoritative drift");
    assert(after.state.nav >= before.state.nav * (WAD - guards.maxRebalanceLoss) / WAD, "baseline execution violated NAV floor");
    record.executionHash = hash;
    record.stateAfter = summarizeState(after.state);
    executedTurnover += turnover;
    executedLegs += trades.length;
  }
  const final = await adapter.readSolveInput(RANGE_TOLERANCE);
  const status = benchmarkStatus(final, guards);
  if (status.targetBandsSatisfied) terminalReason = "TARGET_BANDS_SATISFIED";
  return {
    algorithm: "unchanged M2 truthful static planner under the explicit common benchmark terminal loop",
    initialState: summarizeState(initial.state),
    finalState: summarizeState(final.state),
    ...status,
    attemptedPlans: cycles.length,
    successfulExecutionSteps: cycles.filter(({ executionHash }) => executionHash !== undefined).length,
    failedSimulations: cycles.filter(({ simulation }) => !simulation.passed).length,
    rejectedAlternatives: [],
    attemptedLegs: cycles.reduce((sum, { trades }) => sum + trades.length, 0),
    executedLegs,
    attemptedTurnover,
    attemptedTurnoverOverInitialNav: initial.state.nav === 0n ? 0n : attemptedTurnover * WAD / initial.state.nav,
    executedTurnover,
    executedTurnoverOverInitialNav: initial.state.nav === 0n ? 0n : executedTurnover * WAD / initial.state.nav,
    expectedExecutionCost: null,
    realizedNavDelta: final.state.nav - initial.state.nav,
    cyclesOffTarget: cycles.length,
    minimumSafetyMarginWad: null,
    terminalReason,
    cycles
  };
}

async function runAdaptive(
  adapter: RwaIndexSetpointAdapter,
  deployment: RwaDeployment,
  definition: RwaScenarioDefinition,
  guards: RwaGuardState,
  liquidityDirectory: string
) {
  const initial = await adapter.readSolveInput(RANGE_TOLERANCE);
  const cycles: AdaptiveCycle[] = [];
  let attemptedTurnover = 0n;
  let executedTurnover = 0n;
  let attemptedLegs = 0;
  let executedLegs = 0;
  let expectedQuoteLoss = 0n;
  let expectedFee = 0n;
  let minimumSafetyMarginWad: bigint | null = null;
  let terminalReason = "MAX_CYCLES";

  for (let cycle = 1; cycle <= definition.maxCycles; cycle++) {
    const confirmed = await adapter.readSolveInput(RANGE_TOLERANCE);
    if (benchmarkStatus(confirmed, guards).targetBandsSatisfied) {
      terminalReason = "TARGET_BANDS_SATISFIED";
      break;
    }
    // Benchmark-only convergence policy: do not stop at the informational 5%
    // trigger. The deployed vault guard itself is not changed.
    const benchmarkInput: SolveInput = {
      ...confirmed,
      policy: { ...confirmed.policy, driftTrigger: 0n }
    };
    const liquidity = await sampleRwaLiquidity(adapter, deployment, benchmarkInput, { quoteMaxAge: QUOTE_MAX_AGE });
    const liquidityName = `${definition.id}-cycle-${String(cycle).padStart(2, "0")}.json`;
    writeFileSync(resolve(liquidityDirectory, liquidityName), `${JSON.stringify(jsonValue({
      schemaVersion: 1,
      scenario: definition.id,
      cycle,
      quoteSource: "real deployed SynthraSwapAdapter.swap executed with eth_call on an isolated fork snapshot",
      liquidity
    }), null, 2)}\n`);
    const adaptiveInput: AdaptiveSolveInput = {
      ...benchmarkInput,
      liquidity,
      adaptivePolicy: {
        maxQuoteAge: QUOTE_MAX_AGE,
        maxSimulationAttempts: MAX_SIMULATION_ATTEMPTS,
        maxPriceImpact: guards.slippageTolerance
      }
    };
    const result = await solveAdaptive(adaptiveInput, adapter);
    const record: AdaptiveCycle = {
      cycle,
      stateBefore: summarizeState(confirmed.state),
      liquidityArtifact: `artifacts/liquidity/${liquidityName}`,
      result
    };
    cycles.push(record);
    for (const rejected of result.rejectedAlternatives) {
      attemptedTurnover += rejected.expectedTurnover ?? 0n;
      attemptedLegs += rejected.trades?.length ?? 0;
    }
    if (result.kind === "no-trade") {
      terminalReason = result.reason;
      break;
    }
    attemptedTurnover += result.expectedTurnover;
    attemptedLegs += result.trades.length;
    const hash = await adapter.execute(result.trades);
    const after = await adapter.readSolveInput(RANGE_TOLERANCE);
    assert(after.state.drift < confirmed.state.drift, "adaptive execution did not reduce authoritative drift");
    assert(after.state.nav >= confirmed.state.nav * (WAD - guards.maxRebalanceLoss) / WAD, "adaptive execution violated NAV floor");
    record.executionHash = hash;
    record.stateAfter = summarizeState(after.state);
    executedTurnover += result.expectedTurnover;
    executedLegs += result.trades.length;
    expectedQuoteLoss += result.expectedCost?.quoteLossValue ?? 0n;
    expectedFee += result.expectedCost?.estimatedFeeValue ?? 0n;
    for (const decision of result.liquidityDecisions ?? []) {
      minimumSafetyMarginWad = minimumSafetyMarginWad === null || decision.safetyMarginWad < minimumSafetyMarginWad
        ? decision.safetyMarginWad
        : minimumSafetyMarginWad;
    }
  }
  const final = await adapter.readSolveInput(RANGE_TOLERANCE);
  const status = benchmarkStatus(final, guards);
  if (status.targetBandsSatisfied) terminalReason = "TARGET_BANDS_SATISFIED";
  const rejectedAlternatives = cycles.flatMap(({ result }) => result.rejectedAlternatives);
  return {
    algorithm: "Setpoint Solver v2 with fork-executed Synthra liquidity curves and lexicographic candidate scoring",
    initialState: summarizeState(initial.state),
    finalState: summarizeState(final.state),
    ...status,
    attemptedPlans: cycles.length,
    successfulExecutionSteps: cycles.filter(({ executionHash }) => executionHash !== undefined).length,
    failedSimulations: rejectedAlternatives.filter(({ simulation }) => simulation?.passed === false).length,
    rejectedAlternatives,
    attemptedLegs,
    executedLegs,
    attemptedTurnover,
    attemptedTurnoverOverInitialNav: initial.state.nav === 0n ? 0n : attemptedTurnover * WAD / initial.state.nav,
    executedTurnover,
    executedTurnoverOverInitialNav: initial.state.nav === 0n ? 0n : executedTurnover * WAD / initial.state.nav,
    expectedExecutionCost: {
      quoteLossValue: expectedQuoteLoss,
      estimatedFeeValue: expectedFee,
      gasCostValue: null,
      note: "Quote loss includes fee and price impact; known fee is also broken out and must not be added again."
    },
    realizedNavDelta: final.state.nav - initial.state.nav,
    cyclesOffTarget: cycles.length,
    minimumSafetyMarginWad,
    terminalReason,
    cycles
  };
}

function staleComparison(originalPrices: RawOraclePoint[], guards: RwaGuardState, sourceBlock: Awaited<ReturnType<RwaIndexSetpointAdapter["sourceBlock"]>>) {
  const stale = originalPrices.filter(({ updatedAt }) => sourceBlock.timestamp > updatedAt && sourceBlock.timestamp - updatedAt > guards.maxStaleness);
  assert(stale.length > 0, "expected untouched deployment prices to be stale");
  const common = {
    initialAuthoritativeDrift: null,
    finalAuthoritativeDrift: null,
    vaultTriggerSatisfied: false,
    targetBandsSatisfied: false,
    attemptedPlans: 0,
    successfulExecutionSteps: 0,
    failedSimulations: 0,
    attemptedLegs: 0,
    executedLegs: 0,
    attemptedTurnover: 0n,
    executedTurnover: 0n,
    realizedNavDelta: null,
    cyclesOffTarget: 0,
    terminalReason: "STALE_PRICE"
  };
  return {
    schemaVersion: 1,
    scenario: { id: "stale-oracle", title: "Stale oracle expected no-trade" },
    fork: { sourceBlockNumber: sourceBlock.number, sourceBlockHash: sourceBlock.hash, sourceTimestamp: sourceBlock.timestamp },
    stalePrices: stale,
    baseline: { ...common, algorithm: "unchanged M2 baseline" },
    setpoint: { ...common, algorithm: "Setpoint Solver v2", expectedExecutionCost: null },
    fairness: "Both paths fail closed before liquidity sampling or trade construction because authoritative vault accounting rejects stale prices."
  };
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const adapter = new RwaIndexSetpointAdapter();
  const sourceBlock = await adapter.sourceBlock();
  const { deployment, guards } = await adapter.validate();
  const originalPrices = await adapter.rawOraclePrices();
  const liquidityDirectory = resolve(process.cwd(), "artifacts/liquidity");
  const solverDirectory = resolve(process.cwd(), "artifacts/solver-v2");
  const comparisonDirectory = resolve(process.cwd(), "artifacts/comparison");
  for (const directory of [liquidityDirectory, solverDirectory, comparisonDirectory]) {
    mkdirSync(directory, { recursive: true });
    for (const name of readdirSync(directory)) {
      if (name.endsWith(".json")) unlinkSync(resolve(directory, name));
    }
  }

  const stale = staleComparison(originalPrices, guards, sourceBlock);
  writeFileSync(resolve(comparisonDirectory, "stale-oracle.json"), `${JSON.stringify(jsonValue(stale), null, 2)}\n`);
  writeFileSync(resolve(solverDirectory, "stale-oracle.json"), `${JSON.stringify(jsonValue({
    schemaVersion: 1,
    benchmark: "setpoint-solver-v2",
    scenario: stale.scenario,
    fork: stale.fork,
    setpoint: stale.setpoint
  }), null, 2)}\n`);
  writeFileSync(resolve(liquidityDirectory, "stale-oracle.json"), `${JSON.stringify(jsonValue({
    schemaVersion: 1,
    scenario: "stale-oracle",
    samplingSkipped: true,
    reason: "STALE_PRICE validation precedes liquidity sampling"
  }), null, 2)}\n`);
  console.log("[scenario:stale-oracle] both paths no-trade STALE_PRICE (expected)");

  const pools = await adapter.prepareOracleAndPools();
  console.log(`[prepare] refreshed oracle timestamps and synchronized ${pools.length} deployed pools`);
  let readySnapshot = await adapter.snapshot();
  const comparisons = [];
  for (let index = 0; index < rwaScenarioDefinitions().length; index++) {
    if (index > 0) {
      await adapter.revert(readySnapshot);
      readySnapshot = await adapter.snapshot();
    }
    const definition = rwaScenarioDefinitions()[index];
    assert(definition, `missing scenario ${index}`);
    const setupTransaction = await adapter.setStrategy(definition.weights, definition.cashTarget);
    const scenarioSnapshot = await adapter.snapshot();
    const baseline = await runCommonBaseline(adapter, definition, guards);
    await adapter.revert(scenarioSnapshot);
    const setpoint = await runAdaptive(adapter, deployment, definition, guards, liquidityDirectory);
    assert(baseline.initialState.stateId === setpoint.initialState.stateId, "comparison paths did not start from identical fork state");
    assert(baseline.initialState.nav === setpoint.initialState.nav, "comparison paths did not start from identical NAV");
    assert(baseline.initialState.drift === setpoint.initialState.drift, "comparison paths did not start from identical drift");
    const comparison = {
      schemaVersion: 1,
      benchmark: "m4-equivalent-state-comparison",
      scenario: definition,
      fork: { sourceBlockNumber: sourceBlock.number, sourceBlockHash: sourceBlock.hash, sourceTimestamp: sourceBlock.timestamp },
      setupTransaction,
      commonTerminalCriterion: {
        primary: "all Setpoint target bands satisfied (onchain exact target +/- 0.25 percentage points)",
        secondary: "deployed vault drift trigger satisfied",
        maxCycles: definition.maxCycles,
        deployedGuardsChanged: false,
        benchmarkOnlyBehavior: "both paths may continue below the informational 5% trigger until target bands, failure, or max cycles"
      },
      baseline,
      setpoint
    };
    comparisons.push(comparison);
    writeFileSync(resolve(comparisonDirectory, `${definition.id}.json`), `${JSON.stringify(jsonValue(comparison), null, 2)}\n`);
    writeFileSync(resolve(solverDirectory, `${definition.id}.json`), `${JSON.stringify(jsonValue({
      schemaVersion: 1,
      benchmark: "setpoint-solver-v2",
      scenario: definition,
      fork: comparison.fork,
      commonTerminalCriterion: comparison.commonTerminalCriterion,
      setpoint
    }), null, 2)}\n`);
    console.log(
      `[scenario:${definition.id}] baseline=${baseline.terminalReason}/${baseline.finalState.driftFormatted}; `
      + `setpoint=${setpoint.terminalReason}/${setpoint.finalState.driftFormatted}; steps=${setpoint.successfulExecutionSteps}`
    );
  }

  const allComparisons = [stale, ...comparisons];
  const plannerPath = resolve(process.cwd(), "integrations/rwa-index/src/baseline.ts");
  const summary = {
    schemaVersion: 1,
    milestone: "M4",
    startedAt,
    completedAt: new Date().toISOString(),
    upstream: config.upstream,
    network: { name: config.network, chainId: config.chainId },
    fork: { sourceBlockNumber: sourceBlock.number, sourceBlockHash: sourceBlock.hash, sourceTimestamp: sourceBlock.timestamp },
    contracts: { ...config.contracts, baseAsset: deployment.baseAsset, swapAdapter: deployment.adapter },
    guards,
    pools,
    rangeTolerance: RANGE_TOLERANCE,
    quoteMaxAge: QUOTE_MAX_AGE,
    quoteSampling: "13 geometric/linear points from 1/256 to full directional need, plus state-specific cash boundary amounts",
    m2PlannerSourceSha256: createHash("sha256").update(readFileSync(plannerPath)).digest("hex"),
    benchmarkFairness: {
      identicalForkStatePerScenario: true,
      commonPrimaryCriterion: "target bands satisfied",
      vaultTriggerReportedSeparately: true,
      deployedGuardsChanged: false,
      m2PlannerChanged: false,
      note: "The comparison harness explicitly allows both algorithms to continue below the informational drift trigger; the standalone M2 command and artifacts are unchanged."
    },
    results: allComparisons.map((comparison) => ({
      id: comparison.scenario.id,
      baseline: summarizeComparisonSide(comparison.baseline),
      setpoint: summarizeComparisonSide(comparison.setpoint)
    })),
    claims: {
      performanceConclusionAutomated: false,
      note: "Artifacts report observations under a common criterion. Reviewers must not infer production performance from toy testnet pools."
    }
  };
  const summaryPath = resolve(process.cwd(), "artifacts/m4-summary.json");
  writeFileSync(summaryPath, `${JSON.stringify(jsonValue(summary), null, 2)}\n`);
  console.log(`[summary] ${summaryPath}`);
}

function summarizeComparisonSide(side: Record<string, unknown>) {
  const finalState = side.finalState as { drift?: bigint } | undefined;
  const initialState = side.initialState as { drift?: bigint } | undefined;
  return {
    terminalReason: side.terminalReason,
    vaultTriggerSatisfied: side.vaultTriggerSatisfied,
    targetBandsSatisfied: side.targetBandsSatisfied,
    attemptedPlans: side.attemptedPlans,
    successfulExecutionSteps: side.successfulExecutionSteps,
    failedSimulations: side.failedSimulations,
    attemptedLegs: side.attemptedLegs,
    executedLegs: side.executedLegs,
    attemptedTurnoverOverInitialNav: side.attemptedTurnoverOverInitialNav ?? 0n,
    executedTurnoverOverInitialNav: side.executedTurnoverOverInitialNav ?? 0n,
    expectedExecutionCost: side.expectedExecutionCost ?? null,
    realizedNavDelta: side.realizedNavDelta,
    minimumSafetyMarginWad: side.minimumSafetyMarginWad ?? null,
    initialDrift: initialState?.drift ?? null,
    finalDrift: finalState?.drift ?? null
  };
}

main().catch((error) => {
  console.error(errorText(error));
  process.exitCode = 1;
});
