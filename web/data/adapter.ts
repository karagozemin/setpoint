import type {
  EvidenceSourceViewModel,
  GuardViewModel,
  OperatorScenarioViewModel,
  PipelineStepViewModel,
  PortfolioAssetViewModel,
  PortfolioStateViewModel,
  TradeLegViewModel,
} from "./types";

interface RawPosition {
  token: string;
  balance: string;
  value: string;
  weight: string;
  symbol: string;
}

interface RawState {
  stateId: string;
  blockNumber: string;
  nav: string;
  navFormatted: string;
  driftFormatted: string;
  baseAssetBalance: string;
  baseAssetWeight: string;
  positions: RawPosition[];
}

interface RawTrade {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minAmountOut: string;
}

interface RawLiquidityDecision extends RawTrade {
  expectedOut: string;
  safetyMarginWad: string;
  priceImpactWad: string;
  desiredAmountIn?: string;
  bindingConstraint?: string;
  sampleIndex: number;
}

interface RawExcludedLeg {
  tokenIn: string;
  tokenOut: string;
  desiredAmountIn: string;
  reason: string;
}

interface RawSimulation {
  passed: boolean;
  failureCode?: string;
}

interface RawFastPath {
  trades: RawTrade[];
  preflightPassed: boolean;
  expectedTurnover: string;
  liquidityDecisions?: RawLiquidityDecision[];
  simulation?: RawSimulation;
}

interface RawResult {
  kind: "plan" | "no-trade";
  mode: "FAST_PATH" | "ADAPTIVE_FALLBACK" | "NO_TRADE";
  modeSelectionReason: string;
  reason?: string;
  fallbackInvoked?: boolean;
  fallbackTriggerReason?: string;
  vault?: string;
  trades?: RawTrade[];
  liquidityDecisions?: RawLiquidityDecision[];
  excludedLiquidityLegs?: RawExcludedLeg[];
  simulation?: RawSimulation;
  fastPath?: RawFastPath;
}

interface RawCycle {
  cycle: number;
  stateBefore: RawState;
  stateAfter?: RawState;
  result: RawResult;
  executionHash?: string;
}

export interface RawScenarioArtifact {
  scenario: {
    id: string;
    title: string;
    weights?: string[];
    cashTarget?: string;
  };
  fork: {
    sourceBlockNumber: string;
    sourceBlockHash: string;
  };
  setpoint: {
    initialState?: RawState;
    finalState?: RawState;
    targetBandsSatisfied: boolean;
    attemptedLegs: number;
    executedLegs: number;
    successfulBatches: number;
    attemptedTurnoverOverInitialNav?: string;
    executedTurnoverOverInitialNav?: string;
    terminalReason: string;
    mode?: "NO_TRADE";
    modeSelectionReason?: string;
    fallbackInvoked?: boolean;
    fastPath?: RawFastPath;
    cycles?: RawCycle[];
  };
}

export interface RawSummaryArtifact {
  network: { name: string; chainId: number };
  contracts: { vault: string; manager: string; baseAsset: string };
  guards: {
    driftThreshold: string;
    maxTradeFraction: string;
    slippageTolerance: string;
    maxStaleness: string;
    maxRebalanceLoss: string;
    paused: boolean;
  };
  quoteMaxAge: string;
  rangeTolerance: string;
}

export interface ScenarioPresentation {
  shortLabel: string;
  subtitle: string;
  artifactPath: string;
  evidenceHref: string;
}

const WAD = 1_000_000_000_000_000_000n;
const BASE_SYMBOL = "USDC";

function wadNumber(value: string | undefined): number {
  return value === undefined ? 0 : Number(BigInt(value)) / Number(WAD);
}

function percent(value: string | undefined, digits = 3): string {
  if (value === undefined) return "Not measured";
  return `${(wadNumber(value) * 100).toFixed(digits)}%`;
}

function tokenAmount(value: string, digits = 5): string {
  const amount = BigInt(value);
  const whole = amount / WAD;
  const fraction = (amount % WAD).toString().padStart(18, "0").slice(0, digits).replace(/0+$/, "");
  return fraction.length > 0 ? `${whole.toLocaleString("en-US")}.${fraction}` : whole.toLocaleString("en-US");
}

function fractionOf(numerator: string, denominator: string): string {
  if (BigInt(denominator) === 0n) return "0";
  return ((BigInt(numerator) * WAD) / BigInt(denominator)).toString();
}

function compactAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function readableCode(code: string): string {
  return code.toLowerCase().replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function statusForWeight(weight: number, minimum: number, maximum: number): string {
  if (weight < minimum) return `Under by ${((minimum - weight) * 100).toFixed(2)} pp`;
  if (weight > maximum) return `Over by ${((weight - maximum) * 100).toFixed(2)} pp`;
  return "In range";
}

function symbolFor(address: string, positions: RawPosition[], baseAsset: string): string {
  if (address.toLowerCase() === baseAsset.toLowerCase()) return BASE_SYMBOL;
  return positions.find((position) => position.token.toLowerCase() === address.toLowerCase())?.symbol ?? compactAddress(address);
}

function mapTrade(
  trade: RawTrade,
  index: number,
  positions: RawPosition[],
  baseAsset: string,
  decisions: RawLiquidityDecision[],
  status: TradeLegViewModel["status"],
  reason: string | null = null,
): TradeLegViewModel {
  const decision = decisions.find(
    (candidate) =>
      candidate.tokenIn.toLowerCase() === trade.tokenIn.toLowerCase() &&
      candidate.tokenOut.toLowerCase() === trade.tokenOut.toLowerCase() &&
      candidate.amountIn === trade.amountIn,
  );
  const wasResized = decision?.desiredAmountIn !== undefined && decision.desiredAmountIn !== trade.amountIn;

  return {
    index: index + 1,
    tokenIn: symbolFor(trade.tokenIn, positions, baseAsset),
    tokenOut: symbolFor(trade.tokenOut, positions, baseAsset),
    tokenInAddress: trade.tokenIn,
    tokenOutAddress: trade.tokenOut,
    amountIn: tokenAmount(trade.amountIn),
    minAmountOut: tokenAmount(trade.minAmountOut),
    expectedOut: decision === undefined ? null : tokenAmount(decision.expectedOut),
    quoteImpact: decision === undefined ? null : percent(decision.priceImpactWad),
    safetyMargin: decision === undefined ? null : percent(decision.safetyMarginWad),
    bindingConstraint: decision?.bindingConstraint ?? null,
    sampleIndex: decision?.sampleIndex ?? null,
    status: status === "accepted" && wasResized ? "resized" : status,
    reason,
  };
}

function mapBlockedLeg(
  leg: RawExcludedLeg,
  index: number,
  positions: RawPosition[],
  baseAsset: string,
): TradeLegViewModel {
  return {
    index: index + 1,
    tokenIn: symbolFor(leg.tokenIn, positions, baseAsset),
    tokenOut: symbolFor(leg.tokenOut, positions, baseAsset),
    tokenInAddress: leg.tokenIn,
    tokenOutAddress: leg.tokenOut,
    amountIn: tokenAmount(leg.desiredAmountIn),
    minAmountOut: "Not measured",
    expectedOut: null,
    quoteImpact: null,
    safetyMargin: null,
    bindingConstraint: null,
    sampleIndex: null,
    status: leg.reason === "CASH_CAPACITY_OR_BACKOFF" ? "removed" : "blocked",
    reason: leg.reason,
  };
}

function uniqueBlockedLegs(legs: RawExcludedLeg[]): RawExcludedLeg[] {
  const seen = new Set<string>();
  return legs.filter((leg) => {
    const key = `${leg.tokenIn}:${leg.tokenOut}:${leg.desiredAmountIn}:${leg.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function targetFor(index: number, weights: string[], tolerance: number): [number, number] {
  const target = wadNumber(weights[index]);
  return [Math.max(0, target - tolerance), target + tolerance];
}

function mapState(
  state: RawState,
  counterpart: RawState | undefined,
  weights: string[],
  cashTarget: string,
  tolerance: number,
  constrainedTokens: Set<string>,
  sampledTokens: Set<string>,
  baseAsset: string,
  bandsReached: boolean,
): PortfolioStateViewModel {
  const otherByToken = new Map(counterpart?.positions.map((position) => [position.token.toLowerCase(), position]));
  const assets: PortfolioAssetViewModel[] = state.positions.map((position, index) => {
    const other = otherByToken.get(position.token.toLowerCase());
    const [targetMin, targetMax] = targetFor(index, weights, tolerance);
    const beforeWeight = wadNumber(position.weight);
    const afterWeight = other === undefined ? null : wadNumber(other.weight);
    const tokenKey = position.token.toLowerCase();

    return {
      symbol: position.symbol,
      token: position.token,
      weightBefore: beforeWeight,
      weightAfter: afterWeight,
      targetMin,
      targetMax,
      targetLabel: `${(targetMin * 100).toFixed(2)}–${(targetMax * 100).toFixed(2)}%`,
      statusBefore: statusForWeight(beforeWeight, targetMin, targetMax),
      statusAfter: afterWeight === null ? null : statusForWeight(afterWeight, targetMin, targetMax),
      balanceBefore: tokenAmount(position.balance),
      balanceAfter: other === undefined ? null : tokenAmount(other.balance),
      valueBefore: tokenAmount(position.value, 3),
      valueAfter: other === undefined ? null : tokenAmount(other.value, 3),
      liquidityStatus: constrainedTokens.has(tokenKey)
        ? "Route constrained"
        : sampledTokens.has(tokenKey)
          ? "Executable sample"
          : "Not sampled",
    };
  });

  const cashWeight = wadNumber(state.baseAssetWeight);
  const otherCashWeight = counterpart === undefined ? null : wadNumber(counterpart.baseAssetWeight);
  const cashTargetValue = wadNumber(cashTarget);
  const cashMinimum = Math.max(0, cashTargetValue - tolerance);
  const cashMaximum = cashTargetValue + tolerance;
  assets.push({
    symbol: BASE_SYMBOL,
    token: baseAsset,
    weightBefore: cashWeight,
    weightAfter: otherCashWeight,
    targetMin: cashMinimum,
    targetMax: cashMaximum,
    targetLabel: `${(cashMinimum * 100).toFixed(2)}–${(cashMaximum * 100).toFixed(2)}%`,
    statusBefore: statusForWeight(cashWeight, cashMinimum, cashMaximum),
    statusAfter: otherCashWeight === null ? null : statusForWeight(otherCashWeight, cashMinimum, cashMaximum),
    balanceBefore: tokenAmount(state.baseAssetBalance),
    balanceAfter: counterpart === undefined ? null : tokenAmount(counterpart.baseAssetBalance),
    valueBefore: tokenAmount(state.baseAssetBalance, 3),
    valueAfter: counterpart === undefined ? null : tokenAmount(counterpart.baseAssetBalance, 3),
    liquidityStatus: sampledTokens.has(baseAsset.toLowerCase()) ? "Executable sample" : "Not sampled",
  });

  return {
    nav: state.navFormatted,
    drift: state.driftFormatted,
    cashWeight: percent(state.baseAssetWeight),
    targetStatus: bandsReached ? "Target bands reached" : "Outside target bands",
    assets,
  };
}

function guardsFor(
  summary: RawSummaryArtifact,
  cashTarget: string | undefined,
  isStale: boolean,
): GuardViewModel[] {
  return [
    {
      label: "Maximum leg",
      value: percent(summary.guards.maxTradeFraction, 1),
      state: "active",
      detail: "Oracle value / NAV",
    },
    {
      label: "Oracle freshness",
      value: isStale ? "Failed" : `≤ ${(Number(summary.guards.maxStaleness) / 3600).toFixed(0)}h`,
      state: isStale ? "failed" : "clear",
      detail: isStale ? "Age not recorded in artifact" : "Hard vault guard",
    },
    {
      label: "Minimum output",
      value: `≥ ${((1 - wadNumber(summary.guards.slippageTolerance)) * 100).toFixed(0)}% oracle`,
      state: "active",
      detail: "Per-leg floor",
    },
    {
      label: "Maximum NAV loss",
      value: percent(summary.guards.maxRebalanceLoss, 1),
      state: "active",
      detail: "Post-rebalance floor",
    },
    {
      label: "Cash target",
      value: cashTarget === undefined ? "Not recorded" : percent(cashTarget, 1),
      state: cashTarget === undefined ? "not-recorded" : "active",
      detail: "Scenario policy",
    },
    {
      label: "Vault state",
      value: summary.guards.paused ? "Paused" : "Unpaused",
      state: summary.guards.paused ? "failed" : "clear",
      detail: "Execution gate",
    },
  ];
}

function sourceFor(
  artifact: RawScenarioArtifact,
  summary: RawSummaryArtifact,
  presentation: ScenarioPresentation,
  firstState: RawState | undefined,
): EvidenceSourceViewModel {
  return {
    network: summary.network.name,
    chainId: summary.network.chainId,
    vault: summary.contracts.vault,
    caller: summary.contracts.manager,
    forkBlock: artifact.fork.sourceBlockNumber,
    forkHash: artifact.fork.sourceBlockHash,
    stateBlock: firstState?.blockNumber ?? null,
    stateId: firstState?.stateId ?? null,
    label: "Fork-backed historical evidence",
    artifactPath: presentation.artifactPath,
    evidenceHref: presentation.evidenceHref,
  };
}

function fastPipeline(result: RawResult, legCount: number, transactionHash: string | null): PipelineStepViewModel[] {
  return [
    { label: "Confirmed state", value: "Read", tone: "confirmed" },
    { label: "Simple batch", value: `${legCount} ordered legs`, tone: "neutral" },
    { label: "Policy + liquidity", value: "Preflight passed", tone: "passed" },
    { label: "Vault simulation", value: result.fastPath?.simulation?.passed ? "Passed" : "Not recorded", tone: "passed" },
    { label: "Mode selection", value: "Fast path", tone: "passed" },
    { label: "Fork execution", value: transactionHash === null ? "Not recorded" : "Confirmed", tone: "confirmed" },
    { label: "Confirmed state", value: "Target bands reached", tone: "confirmed" },
  ];
}

function fallbackPipeline(
  result: RawResult,
  selectedCount: number,
  transactionHash: string | null,
  terminalReason: string,
): PipelineStepViewModel[] {
  return [
    { label: "Confirmed state", value: "Read", tone: "confirmed" },
    { label: "Simple batch", value: `${result.fastPath?.trades.length ?? 0} legs`, tone: "neutral" },
    {
      label: "Vault simulation",
      value: readableCode(result.fastPath?.simulation?.failureCode ?? "Failed"),
      tone: "blocked",
    },
    { label: "Recovery", value: "Adaptive fallback", tone: "intervention" },
    { label: "Safe subset", value: `${selectedCount} legs · simulation passed`, tone: "passed" },
    { label: "Fork execution", value: transactionHash === null ? "Not recorded" : "Confirmed", tone: "confirmed" },
    { label: "Residual", value: readableCode(terminalReason), tone: "blocked" },
  ];
}

function stalePipeline(): PipelineStepViewModel[] {
  return [
    { label: "Authoritative accounting", value: "Freshness failed", tone: "blocked" },
    { label: "Decision", value: "NO_TRADE", tone: "confirmed" },
    { label: "Vault simulation", value: "Not run", tone: "neutral" },
    { label: "Adaptive fallback", value: "Not invoked", tone: "neutral" },
    { label: "Execution", value: "None proposed", tone: "neutral" },
  ];
}

export function mapScenarioArtifact(
  artifact: RawScenarioArtifact,
  summary: RawSummaryArtifact,
  presentation: ScenarioPresentation,
): OperatorScenarioViewModel {
  const cycles = artifact.setpoint.cycles ?? [];
  const planCycle = cycles.find((cycle) => cycle.result.kind === "plan");
  const terminalCycle = cycles.at(-1);
  const isStale = artifact.setpoint.terminalReason === "STALE_PRICE";
  const mode = isStale ? "NO_TRADE" : (planCycle?.result.mode ?? "ERROR");
  const initialState = artifact.setpoint.initialState ?? planCycle?.stateBefore;
  const finalState = artifact.setpoint.finalState ?? planCycle?.stateAfter;
  const positions = initialState?.positions ?? [];
  const selectedDecisions = planCycle?.result.liquidityDecisions ?? [];
  const blockedRaw = uniqueBlockedLegs(cycles.flatMap((cycle) => cycle.result.excludedLiquidityLegs ?? []));
  const constrainedTokens = new Set(
    blockedRaw.flatMap((leg) => [leg.tokenIn.toLowerCase(), leg.tokenOut.toLowerCase()]),
  );
  const sampledTokens = new Set(
    selectedDecisions.flatMap((decision) => [decision.tokenIn.toLowerCase(), decision.tokenOut.toLowerCase()]),
  );
  const weights = artifact.scenario.weights ?? [];
  const cashTarget = artifact.scenario.cashTarget;
  const tolerance = wadNumber(summary.rangeTolerance);
  const transactionHash = planCycle?.executionHash ?? null;
  const selectedTrades = planCycle?.result.trades ?? [];
  const originalTrades = planCycle?.result.fastPath?.trades ?? artifact.setpoint.fastPath?.trades ?? [];
  const originalDecisions = planCycle?.result.fastPath?.liquidityDecisions ??
    (mode === "FAST_PATH" ? selectedDecisions : []);

  const before =
    initialState !== undefined && weights.length === initialState.positions.length && cashTarget !== undefined
      ? mapState(
          initialState,
          finalState,
          weights,
          cashTarget,
          tolerance,
          constrainedTokens,
          sampledTokens,
          summary.contracts.baseAsset,
          false,
        )
      : null;
  const after =
    finalState !== undefined && weights.length === finalState.positions.length && cashTarget !== undefined
      ? mapState(
          finalState,
          undefined,
          weights,
          cashTarget,
          tolerance,
          constrainedTokens,
          sampledTokens,
          summary.contracts.baseAsset,
          artifact.setpoint.targetBandsSatisfied,
        )
      : null;

  const isFallback = mode === "ADAPTIVE_FALLBACK";
  const decisionSummary = isStale
    ? "Oracle freshness failed before planning. No transaction was proposed."
    : isFallback
      ? "The complete rebalance failed real vault simulation. Setpoint executed a bounded safe subset, then refused the unsafe residual."
      : "Simple rebalance is executable. Adaptive fallback not required.";
  const modeReason = isStale
    ? artifact.setpoint.modeSelectionReason ?? "NON_RECOVERABLE_INPUT_VALIDATION:STALE_PRICE"
    : planCycle?.result.modeSelectionReason ?? "UNKNOWN";
  const terminalReason = terminalCycle?.result.reason ?? artifact.setpoint.terminalReason;
  const simpleAttemptedTurnover =
    isFallback && planCycle?.result.fastPath?.expectedTurnover !== undefined && initialState !== undefined
      ? fractionOf(planCycle.result.fastPath.expectedTurnover, initialState.nav)
      : artifact.setpoint.attemptedTurnoverOverInitialNav;

  return {
    id: artifact.scenario.id,
    shortLabel: presentation.shortLabel,
    title: artifact.scenario.title,
    subtitle: presentation.subtitle,
    mode,
    modeReason,
    decisionSummary,
    terminalReason,
    targetBandsReached: artifact.setpoint.targetBandsSatisfied,
    fallbackInvoked: planCycle?.result.fallbackInvoked ?? artifact.setpoint.fallbackInvoked ?? false,
    adaptiveNotRequired: mode === "FAST_PATH" && planCycle?.result.fallbackInvoked === false,
    attemptedTurnover: percent(simpleAttemptedTurnover, 6),
    executedTurnover: percent(artifact.setpoint.executedTurnoverOverInitialNav, 6),
    batchSummary: isStale
      ? "0 batches · 0 legs"
      : `${artifact.setpoint.successfulBatches} batch · ${artifact.setpoint.executedLegs} executed legs`,
    before,
    after,
    originalPlan: originalTrades.map((trade, index) =>
      mapTrade(
        trade,
        index,
        positions,
        summary.contracts.baseAsset,
        originalDecisions,
        isFallback ? "blocked" : "accepted",
        isFallback ? planCycle?.result.fastPath?.simulation?.failureCode ?? "Simulation failed" : null,
      ),
    ),
    selectedPlan: selectedTrades.map((trade, index) =>
      mapTrade(trade, index, positions, summary.contracts.baseAsset, selectedDecisions, "accepted"),
    ),
    blockedLegs: blockedRaw.map((leg, index) => mapBlockedLeg(leg, index, positions, summary.contracts.baseAsset)),
    guards: guardsFor(summary, cashTarget, isStale),
    pipeline: isStale
      ? stalePipeline()
      : isFallback && planCycle !== undefined
        ? fallbackPipeline(planCycle.result, selectedTrades.length, transactionHash, terminalReason)
        : planCycle === undefined
          ? []
          : fastPipeline(planCycle.result, selectedTrades.length, transactionHash),
    simulation: {
      fastPathStatus: isStale
        ? "NOT_RUN"
        : planCycle?.result.fastPath?.simulation?.passed === true
          ? "PASSED"
          : "FAILED",
      fastPathFailure: planCycle?.result.fastPath?.simulation?.failureCode ?? null,
      selectedPlanStatus: planCycle?.result.simulation?.passed === true ? "PASSED" : "NOT_RUN",
      executionHash: transactionHash,
      exactVault: planCycle?.result.vault ?? summary.contracts.vault,
      caller: summary.contracts.manager,
    },
    source: sourceFor(artifact, summary, presentation, initialState),
    oracleAge: null,
    terminalExplanation: isStale
      ? "Fail-closed input validation. NO_TRADE is a deliberate safety decision, not an application error."
      : isFallback
        ? "Further execution is blocked by current route liquidity and the vault's oracle-derived minimum-output floor. Target bands remain unreached."
        : "The confirmed batch reached every target band. No adaptive work was performed.",
  };
}

export const formatting = { compactAddress, percent, readableCode, tokenAmount };
