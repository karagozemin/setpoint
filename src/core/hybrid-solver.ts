import { solveBatchAdaptive } from "./batch-solver.js";
import type { AdaptiveSolveInput } from "./adaptive-solver.js";
import { curveFor, quoteIsCurrent, type LiquiditySample } from "./liquidity.js";
import { WAD, rangeDrift, targetRegionReached, validateSolveInput } from "./policy.js";
import type {
  ExecutionCostEstimate,
  LiquidityDecisionRecord,
  NoTradeReason,
  NoTradeResult,
  RebalancePlan,
  SimulationAdapter,
  SimulationFailureCode,
  SimulationResult,
  SolveResult,
  TokenAddress,
  Trade
} from "./types.js";

export type HybridMode = "FAST_PATH" | "ADAPTIVE_FALLBACK" | "NO_TRADE";

export interface HybridSolveInput extends AdaptiveSolveInput {
  fastPathTrades: Trade[];
}

export interface HybridPreflightIssue {
  code: string;
  detail: string;
  recoverable: boolean;
}

export interface FastPathEvidence {
  trades: Trade[];
  preflightPassed: boolean;
  preflightIssues: HybridPreflightIssue[];
  simulation?: SimulationResult;
  expectedTurnover: bigint;
  expectedCost: ExecutionCostEstimate | null;
  minimumSafetyMarginWad: bigint | null;
  liquidityDecisions: LiquidityDecisionRecord[];
}

export interface HybridPlan extends RebalancePlan {
  mode: Exclude<HybridMode, "NO_TRADE">;
  modeSelectionReason: string;
  fastPath: FastPathEvidence;
  fallbackInvoked: boolean;
  fallbackTriggerReason?: string;
}

export interface HybridNoTrade extends NoTradeResult {
  mode: "NO_TRADE";
  modeSelectionReason: string;
  fastPath: FastPathEvidence;
  fallbackInvoked: boolean;
  fallbackTriggerReason?: string;
}

export type HybridSolveResult = HybridPlan | HybridNoTrade;
export type AdaptiveBatchSolver = (input: AdaptiveSolveInput, simulator: SimulationAdapter) => Promise<SolveResult>;
export type ConfirmedHybridInputReader = () => Promise<HybridSolveInput>;

const RECOVERABLE_SIMULATION_FAILURES = new Set<SimulationFailureCode>([
  "INSUFFICIENT_OUTPUT",
  "TRADE_TOO_LARGE",
  "INSUFFICIENT_BALANCE",
  "DRIFT_NOT_IMPROVED",
  "EXCESSIVE_VALUE_LOSS"
]);

export function isRecoverableSimulationFailure(code: SimulationFailureCode | undefined): boolean {
  return code !== undefined && RECOVERABLE_SIMULATION_FAILURES.has(code);
}

export async function solveHybrid(
  input: HybridSolveInput,
  simulator: SimulationAdapter,
  adaptiveSolver: AdaptiveBatchSolver = solveBatchAdaptive
): Promise<HybridSolveResult> {
  const validation = validateSolveInput(input);
  if (validation.length > 0) {
    const primary = validation[0];
    return hybridNoTrade(
      input,
      primary?.reason ?? "INVALID_POLICY",
      validation.map(({ detail }) => detail),
      emptyFastPath(input.fastPathTrades),
      "NON_RECOVERABLE_INPUT_VALIDATION",
      false
    );
  }
  if (targetRegionReached(input.state, input.policy.assets, input.policy.cashTarget)) {
    return hybridNoTrade(input, "TARGET_REGION_REACHED", ["all enabled assets and cash are inside their target ranges"], emptyFastPath(input.fastPathTrades), "TARGET_REGION_REACHED", false);
  }
  if (input.state.drift <= input.policy.driftTrigger) {
    return hybridNoTrade(input, "DRIFT_BELOW_TRIGGER", ["authoritative vault drift is at or below the configured trigger"], emptyFastPath(input.fastPathTrades), "DRIFT_BELOW_TRIGGER", false);
  }

  const preflight = preflightFastPath(input);
  if (preflight.issues.some(({ recoverable }) => !recoverable)) {
    const issue = preflight.issues.find(({ recoverable }) => !recoverable)!;
    return hybridNoTrade(input, preflightReason(issue), [issue.detail], preflight.evidence, `FAST_PATH_NON_RECOVERABLE:${issue.code}`, false);
  }

  const simulation = input.fastPathTrades.length > 0
    ? await simulator.simulate(input.fastPathTrades, input.state)
    : { passed: false, reason: "fast path produced no trades" };
  const fastPath: FastPathEvidence = { ...preflight.evidence, simulation };

  if (preflight.issues.length === 0 && simulation.passed) {
    return fastPathPlan(input, fastPath);
  }

  const trigger = preflight.issues[0]?.code ?? simulation.failureCode ?? "FAST_PATH_NO_PLAN";
  const recoverable = preflight.issues.length > 0
    ? preflight.issues.every(({ recoverable: canRecover }) => canRecover)
    : isRecoverableSimulationFailure(simulation.failureCode);
  if (!recoverable) {
    return hybridNoTrade(
      input,
      "SIMULATION_REJECTED",
      [simulation.reason ?? simulation.failureCode ?? "fast-path simulation rejected"],
      fastPath,
      `FAST_PATH_NON_RECOVERABLE:${trigger}`,
      false
    );
  }

  const adaptive = await adaptiveSolver(input, simulator);
  if (adaptive.kind === "plan") {
    return {
      ...adaptive,
      mode: "ADAPTIVE_FALLBACK",
      modeSelectionReason: `FAST_PATH_RECOVERABLE_FAILURE:${trigger}`,
      fastPath,
      fallbackInvoked: true,
      fallbackTriggerReason: trigger
    };
  }
  return {
    ...adaptive,
    mode: "NO_TRADE",
    modeSelectionReason: `ADAPTIVE_FALLBACK_NO_SAFE_PLAN:${adaptive.reason}`,
    fastPath,
    fallbackInvoked: true,
    fallbackTriggerReason: trigger
  };
}

export async function solveHybridConfirmed(
  readConfirmedInput: ConfirmedHybridInputReader,
  simulator: SimulationAdapter,
  adaptiveSolver: AdaptiveBatchSolver = solveBatchAdaptive
): Promise<HybridSolveResult> {
  return solveHybrid(await readConfirmedInput(), simulator, adaptiveSolver);
}

function preflightFastPath(input: HybridSolveInput): { issues: HybridPreflightIssue[]; evidence: FastPathEvidence } {
  const issues: HybridPreflightIssue[] = [];
  const decisions: LiquidityDecisionRecord[] = [];
  let turnover = 0n;
  let quoteLoss = 0n;
  let fee = 0n;
  let minimumSafety: bigint | null = null;

  if (input.fastPathTrades.length === 0) {
    issues.push({ code: "NO_FAST_PATH_TRADES", detail: "simple planner produced no trades", recoverable: true });
  }
  const liquidityIssue = validateLiquidityState(input);
  if (liquidityIssue) issues.push({ code: "STALE_LIQUIDITY", detail: liquidityIssue, recoverable: false });

  let encounteredBuy = false;
  const balances = new Map(input.state.positions.map(({ token, balance }) => [token.toLowerCase(), balance]));
  balances.set(input.policy.baseAsset.toLowerCase(), input.state.baseAssetBalance);
  for (const [index, trade] of input.fastPathTrades.entries()) {
    const direction = directionOf(input, trade);
    if (!direction) {
      issues.push({ code: "UNSUPPORTED_ROUTE", detail: `fast-path leg ${index} is not a supported USDC-hub route`, recoverable: false });
      continue;
    }
    if (direction === "buy") encounteredBuy = true;
    if (direction === "sell" && encounteredBuy) {
      issues.push({ code: "INVALID_TRADE_ORDER", detail: `sell leg ${index} appears after a buy`, recoverable: false });
    }
    if (trade.amountIn <= 0n || trade.minAmountOut <= 0n) {
      issues.push({ code: "MALFORMED_TRADE", detail: `fast-path leg ${index} has a zero amount`, recoverable: false });
      continue;
    }
    const inputValue = valueOf(input, trade.tokenIn, trade.amountIn);
    turnover += inputValue;
    if (inputValue > input.policy.maxLegValue) {
      issues.push({ code: "LEG_EXCEEDS_MAX", detail: `fast-path leg ${index} exceeds maxLegValue`, recoverable: true });
    }
    const oracleOut = oracleOutput(input, trade.tokenIn, trade.tokenOut, trade.amountIn);
    const requiredMinOut = oracleOut * (WAD - input.policy.slippageTolerance) / WAD;
    if (trade.minAmountOut < requiredMinOut) {
      issues.push({ code: "MINOUT_TOO_LOOSE", detail: `fast-path leg ${index} minAmountOut is below the policy floor`, recoverable: false });
    }

    const available = balances.get(trade.tokenIn.toLowerCase()) ?? 0n;
    if (trade.amountIn > available) {
      issues.push({ code: "INSUFFICIENT_CONSERVATIVE_BALANCE", detail: `fast-path leg ${index} overspends conservative input balance`, recoverable: true });
    } else {
      balances.set(trade.tokenIn.toLowerCase(), available - trade.amountIn);
      balances.set(trade.tokenOut.toLowerCase(), (balances.get(trade.tokenOut.toLowerCase()) ?? 0n) + trade.minAmountOut);
    }

    const curve = curveFor(input.liquidity, trade.tokenIn, trade.tokenOut);
    const sample = curve?.samples.find(({ amountIn }) => amountIn === trade.amountIn);
    if (!curve) {
      issues.push({ code: "MISSING_LIQUIDITY_CURVE", detail: `fast-path leg ${index} has no executable-liquidity curve`, recoverable: true });
      continue;
    }
    if (!sample || !quoteIsCurrent(sample, input.state.stateId, input.state.blockTimestamp, input.adaptivePolicy.maxQuoteAge)) {
      issues.push({ code: "MISSING_EXACT_QUOTE", detail: `fast-path leg ${index} has no current exact-size quote`, recoverable: true });
      continue;
    }
    if (!sample.minOutCompatible || sample.expectedOut < trade.minAmountOut) {
      issues.push({ code: "MINOUT_INCOMPATIBLE", detail: `fast-path leg ${index} executable output is below minAmountOut`, recoverable: true });
    }
    if (input.adaptivePolicy.maxPriceImpact !== undefined && sample.priceImpactWad > input.adaptivePolicy.maxPriceImpact) {
      issues.push({ code: "PRICE_IMPACT_LIMIT", detail: `fast-path leg ${index} exceeds price-impact policy`, recoverable: true });
    }
    quoteLoss += sample.quoteLossValue;
    fee += sample.estimatedFeeValue;
    const margin = safetyMargin(sample, trade);
    minimumSafety = minimumSafety === null || margin < minimumSafety ? margin : minimumSafety;
    decisions.push({
      curveId: curve.id,
      sampleIndex: sample.sampleIndex,
      tokenIn: trade.tokenIn,
      tokenOut: trade.tokenOut,
      amountIn: trade.amountIn,
      expectedOut: sample.expectedOut,
      minAmountOut: trade.minAmountOut,
      oracleOut: sample.oracleOut,
      safetyMarginOut: sample.expectedOut > trade.minAmountOut ? sample.expectedOut - trade.minAmountOut : 0n,
      safetyMarginWad: margin,
      priceImpactWad: sample.priceImpactWad,
      desiredAmountIn: trade.amountIn,
      maximumSafeAmountIn: curve.maximumExecutableAmountIn,
      bindingConstraint: "SIMPLE_PLANNER",
      expectedQuoteLossValue: sample.quoteLossValue
    });
  }

  const cash = balances.get(input.policy.baseAsset.toLowerCase()) ?? 0n;
  const cashFloor = input.policy.minimumCashBuffer ?? 0n;
  if (cash < cashFloor) issues.push({ code: "CASH_RESERVE", detail: "fast path violates the conservative cash reserve", recoverable: true });
  if (input.policy.maxTurnover !== undefined && turnover > input.state.nav * input.policy.maxTurnover / WAD) {
    issues.push({ code: "MAX_TURNOVER", detail: "fast path exceeds maxTurnover", recoverable: true });
  }
  if (quoteLoss > input.state.nav * input.policy.maxNavLoss / WAD) {
    issues.push({ code: "EXPECTED_NAV_LOSS", detail: "fast-path executable quotes exceed maxNavLoss", recoverable: true });
  }

  return {
    issues: deduplicateIssues(issues),
    evidence: {
      trades: input.fastPathTrades,
      preflightPassed: issues.length === 0,
      preflightIssues: deduplicateIssues(issues),
      expectedTurnover: turnover,
      expectedCost: decisions.length === 0 ? null : {
        quoteLossValue: quoteLoss,
        estimatedFeeValue: fee,
        gasCostValue: null,
        model: "exact-size fork-executed adapter quotes for the simple batch"
      },
      minimumSafetyMarginWad: minimumSafety,
      liquidityDecisions: decisions
    }
  };
}

function fastPathPlan(input: HybridSolveInput, fastPath: FastPathEvidence): HybridPlan {
  return {
    kind: "plan",
    mode: "FAST_PATH",
    modeSelectionReason: "FAST_PATH_PREFLIGHT_AND_SIMULATION_PASSED",
    fastPath,
    fallbackInvoked: false,
    vault: input.vault,
    stateId: input.state.stateId,
    blockNumber: input.state.blockNumber,
    trades: input.fastPathTrades,
    expectedDriftBefore: currentRangeDrift(input),
    expectedDriftAfter: projectedRangeDrift(input, fastPath.liquidityDecisions),
    expectedTurnover: fastPath.expectedTurnover,
    expectedCost: fastPath.expectedCost,
    activeConstraints: ["hybrid-fast-path", "policy-preflight", "exact-size-liquidity", "simulation-required"],
    rejectedAlternatives: [],
    simulation: fastPath.simulation ?? { passed: false, reason: "missing simulation" },
    reason: "use the simplest coherent rebalance because policy preflight and real vault simulation passed",
    liquidityDecisions: fastPath.liquidityDecisions,
    excludedLiquidityLegs: []
  };
}

function hybridNoTrade(
  input: HybridSolveInput,
  reason: NoTradeReason,
  details: string[],
  fastPath: FastPathEvidence,
  modeSelectionReason: string,
  fallbackInvoked: boolean
): HybridNoTrade {
  return { kind: "no-trade", mode: "NO_TRADE", stateId: input.state.stateId, reason, details, rejectedAlternatives: [], modeSelectionReason, fastPath, fallbackInvoked };
}

function validateLiquidityState(input: HybridSolveInput): string | undefined {
  if (input.liquidity.stateId !== input.state.stateId || input.liquidity.blockNumber !== input.state.blockNumber) return "liquidity snapshot does not match confirmed state";
  if (input.state.blockTimestamp > input.liquidity.observedAt && input.state.blockTimestamp - input.liquidity.observedAt > input.adaptivePolicy.maxQuoteAge) return "liquidity snapshot has expired";
  return undefined;
}

function directionOf(input: HybridSolveInput, trade: Trade): "sell" | "buy" | undefined {
  const base = input.policy.baseAsset.toLowerCase();
  const allowed = new Set(input.policy.assets.filter(({ enabled }) => enabled).map(({ token }) => token.toLowerCase()));
  if (trade.tokenOut.toLowerCase() === base && allowed.has(trade.tokenIn.toLowerCase())) return "sell";
  if (trade.tokenIn.toLowerCase() === base && allowed.has(trade.tokenOut.toLowerCase())) return "buy";
  return undefined;
}

function valueOf(input: HybridSolveInput, token: TokenAddress, amount: bigint): bigint {
  if (token.toLowerCase() === input.policy.baseAsset.toLowerCase()) return amount;
  const price = input.prices.find((point) => point.token.toLowerCase() === token.toLowerCase());
  return price ? amount * price.priceWad / WAD : 0n;
}

function oracleOutput(input: HybridSolveInput, tokenIn: TokenAddress, tokenOut: TokenAddress, amountIn: bigint): bigint {
  if (tokenIn.toLowerCase() === input.policy.baseAsset.toLowerCase()) {
    const price = input.prices.find((point) => point.token.toLowerCase() === tokenOut.toLowerCase());
    return price ? amountIn * WAD / price.priceWad : 0n;
  }
  const price = input.prices.find((point) => point.token.toLowerCase() === tokenIn.toLowerCase());
  return price ? amountIn * price.priceWad / WAD : 0n;
}

function safetyMargin(sample: LiquiditySample, trade: Trade): bigint {
  return trade.minAmountOut === 0n || sample.expectedOut <= trade.minAmountOut ? 0n : (sample.expectedOut - trade.minAmountOut) * WAD / trade.minAmountOut;
}

function currentRangeDrift(input: HybridSolveInput): bigint {
  return rangeDrift(input.state.nav, input.state.baseAssetBalance, new Map(input.state.positions.map(({ token, value }) => [token.toLowerCase(), value])), input.policy.assets, input.policy.cashTarget);
}

function projectedRangeDrift(input: HybridSolveInput, decisions: readonly LiquidityDecisionRecord[]): bigint {
  let base = input.state.baseAssetBalance;
  const values = new Map(input.state.positions.map(({ token, value }) => [token.toLowerCase(), value]));
  for (const decision of decisions) {
    if (decision.tokenOut.toLowerCase() === input.policy.baseAsset.toLowerCase()) {
      values.set(decision.tokenIn.toLowerCase(), (values.get(decision.tokenIn.toLowerCase()) ?? 0n) - valueOf(input, decision.tokenIn, decision.amountIn));
      base += decision.expectedOut;
    } else {
      base -= decision.amountIn;
      values.set(decision.tokenOut.toLowerCase(), (values.get(decision.tokenOut.toLowerCase()) ?? 0n) + valueOf(input, decision.tokenOut, decision.expectedOut));
    }
  }
  const nav = base + [...values.values()].reduce((sum, value) => sum + value, 0n);
  return rangeDrift(nav, base, values, input.policy.assets, input.policy.cashTarget);
}

function emptyFastPath(trades: Trade[]): FastPathEvidence {
  return { trades, preflightPassed: false, preflightIssues: [], expectedTurnover: 0n, expectedCost: null, minimumSafetyMarginWad: null, liquidityDecisions: [] };
}

function preflightReason(issue: HybridPreflightIssue): NoTradeReason {
  if (issue.code === "STALE_LIQUIDITY") return "STALE_LIQUIDITY";
  if (issue.code === "UNSUPPORTED_ROUTE") return "UNSUPPORTED_ASSET";
  return "INVALID_POLICY";
}

function deduplicateIssues(issues: HybridPreflightIssue[]): HybridPreflightIssue[] {
  return [...new Map(issues.map((issue) => [`${issue.code}:${issue.detail}`, issue])).values()];
}
