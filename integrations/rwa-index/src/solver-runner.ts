import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatUnits, type Hash } from "viem";
import { WAD, targetRegionReached } from "../../../src/core/policy.js";
import { solve } from "../../../src/core/solver.js";
import type {
  NoTradeResult,
  PortfolioState,
  RebalancePlan,
  SimulationAdapter,
  SolveInput,
  SolveResult,
  Trade
} from "../../../src/core/types.js";
import { loadConfig } from "./config.js";
import { rwaScenarioDefinitions, type RwaScenarioDefinition } from "./scenario-matrix.js";
import { RwaIndexSetpointAdapter, type PreparedPool, type RawOraclePoint } from "./setpoint-adapter.js";

const config = loadConfig();
const RANGE_TOLERANCE = 25n * 10n ** 14n; // 0.25 percentage points on each side.

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface SolverCycle {
  cycle: number;
  input: ReturnType<typeof summarizeInput>;
  result: SolveResult;
  executionHash?: Hash;
  stateAfter?: ReturnType<typeof summarizeState>;
  actualDriftReduction?: bigint;
  actualNavChange?: bigint;
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
  const entry = Object.entries(config.symbols).find(([address]) => address.toLowerCase() === token.toLowerCase());
  return entry?.[1] ?? token;
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
    baseAssetBalanceFormatted: units(state.baseAssetBalance),
    baseAssetWeight: state.baseAssetWeight,
    baseAssetWeightFormatted: pctWad(state.baseAssetWeight),
    positions: state.positions.map((position) => ({
      ...position,
      symbol: symbolFor(position.token),
      valueFormatted: units(position.value),
      weightFormatted: pctWad(position.weight)
    }))
  };
}

function summarizeInput(input: SolveInput) {
  return {
    vault: input.vault,
    state: summarizeState(input.state),
    policy: input.policy,
    prices: input.prices.map((price) => ({ ...price, symbol: symbolFor(price.token) }))
  };
}

function planTurnover(result: SolveResult): bigint {
  return result.kind === "plan" ? result.expectedTurnover : 0n;
}

async function staleScenario(
  adapter: RwaIndexSetpointAdapter,
  originalPrices: RawOraclePoint[],
  sourceBlock: Awaited<ReturnType<RwaIndexSetpointAdapter["sourceBlock"]>>
) {
  const freshInput = await adapter.readSolveInput(RANGE_TOLERANCE);
  const originalByToken = new Map(originalPrices.map((point) => [point.token.toLowerCase(), point]));
  const staleInput: SolveInput = {
    ...freshInput,
    prices: freshInput.prices.map((price) => ({
      ...price,
      updatedAt: originalByToken.get(price.token.toLowerCase())?.updatedAt ?? price.updatedAt,
      source: `${price.source}; original fork timestamp replay`
    }))
  };
  let simulationCalls = 0;
  const countingSimulator: SimulationAdapter = {
    simulate: async (trades) => {
      simulationCalls += 1;
      return adapter.simulate(trades);
    }
  };
  const result = await solve(staleInput, countingSimulator);
  assert(result.kind === "no-trade" && result.reason === "STALE_PRICE", "stale input must produce STALE_PRICE");
  assert(simulationCalls === 0, "stale input must fail before simulation");
  return {
    schemaVersion: 1,
    benchmark: "setpoint-solver-v1",
    scenario: {
      id: "stale-oracle",
      title: "Stale oracle expected no-trade",
      rationale: "Replays the untouched deployment timestamps captured before fork-only oracle refresh. M1/M2 separately prove the deployed vault itself rejects these stale inputs."
    },
    fork: { sourceBlockNumber: sourceBlock.number, sourceBlockHash: sourceBlock.hash, sourceTimestamp: sourceBlock.timestamp },
    rangeTolerance: RANGE_TOLERANCE,
    input: summarizeInput(staleInput),
    result,
    simulationCalls,
    attemptedSolveCount: 1,
    successfulStepCount: 0,
    cumulativeTurnover: 0n,
    targetRegionReached: false,
    outcome: "no-trade",
    finalReason: result.reason,
    limitations: [
      "Authoritative vault NAV cannot be read while the original oracle timestamps are stale, so this solver-path check replays real captured timestamps onto the post-refresh state.",
      "The actual onchain stale-oracle failure is recorded independently by the M1 and M2 artifacts."
    ]
  };
}

async function runScenario(
  adapter: RwaIndexSetpointAdapter,
  definition: RwaScenarioDefinition,
  pools: readonly PreparedPool[],
  sourceBlock: Awaited<ReturnType<RwaIndexSetpointAdapter["sourceBlock"]>>
) {
  const setupTransactions = [await adapter.setStrategy(definition.weights, definition.cashTarget)];
  const initialInput = await adapter.readSolveInput(RANGE_TOLERANCE);
  const cycles: SolverCycle[] = [];
  let cumulativeTurnover = 0n;
  let successfulStepCount = 0;
  let terminalResult: SolveResult | undefined;

  for (let cycle = 1; cycle <= definition.maxCycles; cycle++) {
    // Every iteration starts with a new authoritative vault read; no projected
    // state or unused portion of a prior plan is carried into this solve.
    const input = await adapter.readSolveInput(RANGE_TOLERANCE);
    const result = await solve(input, adapter);
    const record: SolverCycle = { cycle, input: summarizeInput(input), result };
    cycles.push(record);
    terminalResult = result;
    if (result.kind === "no-trade") break;

    // The plan was simulation-gated by solve(); execute it against the unchanged fork state.
    const hash = await adapter.execute(result.trades);
    const after = await adapter.readSolveInput(RANGE_TOLERANCE);
    assert(after.state.drift < input.state.drift, `cycle ${cycle} did not strictly reduce authoritative vault drift`);
    assert(
      after.state.nav >= input.state.nav * (WAD - input.policy.maxNavLoss) / WAD,
      `cycle ${cycle} violated the authoritative NAV floor`
    );
    record.executionHash = hash;
    record.stateAfter = summarizeState(after.state);
    record.actualDriftReduction = input.state.drift - after.state.drift;
    record.actualNavChange = after.state.nav - input.state.nav;
    cumulativeTurnover += planTurnover(result);
    successfulStepCount += 1;
    // No remaining plan is retained. The next iteration reads and solves confirmed state again.
  }

  const finalInput = await adapter.readSolveInput(RANGE_TOLERANCE);
  const reached = targetRegionReached(finalInput.state, finalInput.policy.assets, finalInput.policy.cashTarget);
  const finalReason = terminalResult?.kind === "no-trade" ? terminalResult.reason : null;
  const initialDrift = initialInput.state.drift;
  const progressed = finalInput.state.drift < initialDrift;
  const exhaustedCycles = cycles.length === definition.maxCycles && cycles.at(-1)?.result.kind === "plan";
  const outcome = reached
    ? "target-region-reached"
    : terminalResult?.kind === "no-trade"
      ? "safe-no-trade"
      : exhaustedCycles
        ? "max-cycles-reached"
        : "no-plan";

  return {
    schemaVersion: 1,
    benchmark: "setpoint-solver-v1",
    algorithm: {
      targetRanges: "onchain target +/- 0.25 percentage points, clipped to [0, 100%]",
      sequencing: "one deterministic USDC-hub step per confirmed-state solve",
      candidatePriority: "hard constraints, cash range, largest range violation, token-address tie-break",
      simulationGate: "every executable plan must pass eth_call against the actual RWA Index vault",
      recomputation: "discard plan after execution, re-read confirmed fork state, solve again",
      basicBackoff: "deterministic halving only for leg cap, balance, minOut construction, or drift-improvement failures",
      depthAwareness: false
    },
    scenario: definition,
    fork: { sourceBlockNumber: sourceBlock.number, sourceBlockHash: sourceBlock.hash, sourceTimestamp: sourceBlock.timestamp },
    rangeTolerance: RANGE_TOLERANCE,
    setupTransactions,
    poolContext: pools.filter(({ token }) => definition.focusAssets.includes(symbolFor(token))),
    initialState: summarizeState(initialInput.state),
    cycles,
    attemptedSolveCount: cycles.length,
    successfulStepCount,
    cumulativeTurnover,
    cumulativeTurnoverOverInitialNav: initialInput.state.nav === 0n ? 0n : cumulativeTurnover * WAD / initialInput.state.nav,
    targetRegionReached: reached,
    safeProgress: progressed,
    initialDrift,
    finalDrift: finalInput.state.drift,
    finalState: summarizeState(finalInput.state),
    outcome,
    finalReason,
    limitations: [
      "M3 deliberately does not consume pool depth, quote curves, gas, or execution-cost estimates.",
      "INSUFFICIENT_OUTPUT is reported without liquidity-aware resizing; that backoff belongs to M4.",
      "Liquidity labels and pool inventories are context only and do not influence the solver.",
      "This fork executes through impersonated deployed manager and oracle-feeder accounts; Setpoint does not custody funds."
    ]
  };
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const adapter = new RwaIndexSetpointAdapter();
  const sourceBlock = await adapter.sourceBlock();
  const { deployment, guards } = await adapter.validate();
  const originalPrices = await adapter.rawOraclePrices();
  const pools = await adapter.prepareOracleAndPools();
  const outputDirectory = resolve(process.cwd(), "artifacts/solver-v1");
  mkdirSync(outputDirectory, { recursive: true });
  console.log(`[prepare] refreshed oracle timestamps and synchronized ${pools.length} deployed pools`);

  const stale = await staleScenario(adapter, originalPrices, sourceBlock);
  writeFileSync(resolve(outputDirectory, "stale-oracle.json"), `${JSON.stringify(jsonValue(stale), null, 2)}\n`);
  console.log("[scenario:stale-oracle] no-trade STALE_PRICE before simulation (expected)");

  let readySnapshot = await adapter.snapshot();
  const results = [];
  const definitions = rwaScenarioDefinitions();
  for (let index = 0; index < definitions.length; index++) {
    if (index > 0) {
      await adapter.revert(readySnapshot);
      readySnapshot = await adapter.snapshot();
    }
    const definition = definitions[index];
    assert(definition, `missing scenario ${index}`);
    const result = await runScenario(adapter, definition, pools, sourceBlock);
    results.push(result);
    writeFileSync(resolve(outputDirectory, `${definition.id}.json`), `${JSON.stringify(jsonValue(result), null, 2)}\n`);
    console.log(
      `[scenario:${definition.id}] ${result.outcome}; solves=${result.attemptedSolveCount}; `
      + `steps=${result.successfulStepCount}; finalDrift=${result.finalState.driftFormatted}; reason=${result.finalReason ?? "none"}`
    );
  }

  const allResults = [stale, ...results];
  const largeTarget = results.find(({ scenario }) => scenario.id === "large-target-change");
  const summary = {
    schemaVersion: 1,
    benchmark: "setpoint-solver-v1",
    startedAt,
    completedAt: new Date().toISOString(),
    upstream: config.upstream,
    network: { name: config.network, chainId: config.chainId },
    fork: { sourceBlockNumber: sourceBlock.number, sourceBlockHash: sourceBlock.hash, sourceTimestamp: sourceBlock.timestamp },
    contracts: { ...config.contracts, baseAsset: deployment.baseAsset, swapAdapter: deployment.adapter },
    guards,
    rangeTolerance: RANGE_TOLERANCE,
    poolContext: pools,
    scenarioCount: allResults.length,
    results: allResults.map((result) => ({
      id: result.scenario.id,
      outcome: result.outcome,
      attemptedSolveCount: result.attemptedSolveCount,
      successfulStepCount: result.successfulStepCount,
      cumulativeTurnover: result.cumulativeTurnover,
      targetRegionReached: result.targetRegionReached,
      initialDrift: "initialDrift" in result ? result.initialDrift : null,
      finalDrift: "finalDrift" in result ? result.finalDrift : null,
      finalReason: result.finalReason
    })),
    milestoneChecks: {
      staleInputFailedClosedBeforeSimulation: stale.simulationCalls === 0 && stale.finalReason === "STALE_PRICE",
      largeTargetMadeSafeProgress: Boolean(largeTarget?.safeProgress && largeTarget.successfulStepCount > 0),
      confirmedStateRereadBetweenSteps: true,
      executablePlansSimulationGated: true
    },
    claims: {
      performanceComparisonMade: false,
      depthAwareSizingIncluded: false,
      note: "M3 validates solver architecture and safe progress only. It makes no performance claim against M2."
    }
  };
  const summaryPath = resolve(process.cwd(), "artifacts/solver-v1-summary.json");
  writeFileSync(summaryPath, `${JSON.stringify(jsonValue(summary), null, 2)}\n`);
  console.log(`[summary] ${summaryPath}`);
}

main().catch((error) => {
  console.error(errorText(error));
  process.exitCode = 1;
});
