import { curveFor, quoteIsCurrent, type AdaptivePolicy, type LiquidityCurve, type LiquiditySample, type LiquiditySnapshot } from "./liquidity.js";
import { WAD, rangeDrift, targetRegionReached, validateSolveInput } from "./policy.js";
import type {
  AssetPolicy,
  ExecutionCostEstimate,
  LiquidityDecisionRecord,
  NoTradeResult,
  RebalancePlan,
  RejectedAlternative,
  SimulationAdapter,
  SolveInput,
  SolveResult,
  Trade
} from "./types.js";

export interface AdaptiveSolveInput extends SolveInput {
  liquidity: LiquiditySnapshot;
  adaptivePolicy: AdaptivePolicy;
}

export type ConfirmedAdaptiveInputReader = () => Promise<AdaptiveSolveInput>;

export async function solveAdaptiveConfirmed(
  readConfirmedInput: ConfirmedAdaptiveInputReader,
  simulator: SimulationAdapter
): Promise<SolveResult> {
  return solveAdaptive(await readConfirmedInput(), simulator);
}

interface RankedAsset {
  asset: AssetPolicy;
  balance: bigint;
  value: bigint;
  overValue: bigint;
  underValue: bigint;
  sellHeadroom: bigint;
  buyHeadroom: bigint;
}

interface Decision {
  curve: LiquidityCurve;
  sample: LiquiditySample;
  trade: Trade;
}

interface Candidate {
  id: string;
  trades: Trade[];
  decisions: Decision[];
  expectedDriftAfter: bigint;
  expectedTurnover: bigint;
  expectedCost: ExecutionCostEstimate;
  minimumSafetyMarginWad: bigint;
  reason: string;
}

export async function solveAdaptive(input: AdaptiveSolveInput, simulator: SimulationAdapter): Promise<SolveResult> {
  const issues = validateSolveInput(input);
  if (issues.length > 0) {
    const primary = issues[0];
    return noTrade(input, primary?.reason ?? "INVALID_POLICY", issues.map(({ detail }) => detail));
  }
  if (targetRegionReached(input.state, input.policy.assets, input.policy.cashTarget)) {
    return noTrade(input, "TARGET_REGION_REACHED", ["all enabled assets and cash are inside their target ranges"]);
  }
  if (input.state.drift <= input.policy.driftTrigger) {
    return noTrade(input, "DRIFT_BELOW_TRIGGER", ["authoritative vault drift is at or below the configured trigger"]);
  }
  const liquidityIssue = validateLiquidity(input);
  if (liquidityIssue) return noTrade(input, "STALE_LIQUIDITY", [liquidityIssue]);

  let candidates = buildCandidates(input).sort(compareCandidates);
  if (candidates.length === 0) {
    return noTrade(input, "NO_SAFE_LIQUIDITY", ["no sampled executable quote supports a drift-reducing USDC-hub step"]);
  }

  const rejected: RejectedAlternative[] = [];
  const attempts = Math.max(1, input.adaptivePolicy.maxSimulationAttempts);
  for (let attempt = 0; attempt < attempts && candidates.length > 0; attempt++) {
    const candidate = candidates[0];
    if (!candidate) break;
    const simulation = await simulator.simulate(candidate.trades, input.state);
    if (simulation.passed) return plan(input, candidate, simulation, rejected);

    const binding = tightestDecision(candidate);
    rejected.push({
      candidateId: candidate.id,
      reason: `${simulation.reason ?? simulation.failureCode ?? "simulation rejected"}${binding ? `; binding liquidity leg ${binding.curve.id} sample ${binding.sample.sampleIndex}` : ""}`,
      simulation,
      trades: candidate.trades,
      expectedTurnover: candidate.expectedTurnover,
      liquidityDecisions: candidate.decisions.map(decisionRecord)
    });
    if (simulation.failureCode !== "INSUFFICIENT_OUTPUT") {
      return noTrade(input, "SIMULATION_REJECTED", [simulation.reason ?? simulation.failureCode ?? "unknown simulation failure"], rejected);
    }

    // Rebuild from the sampled curve rather than blind halving: discard this
    // candidate and any alternative that reuses the same-or-larger binding quote.
    candidates = candidates.slice(1).filter((alternative) => {
      if (!binding) return true;
      const corresponding = alternative.decisions.find(({ curve }) => curve.id === binding.curve.id);
      return !corresponding || corresponding.sample.amountIn < binding.sample.amountIn;
    });
  }
  return noTrade(input, "NO_SAFE_LIQUIDITY", ["bounded liquidity-aware simulation rebuild exhausted"], rejected);
}

function validateLiquidity(input: AdaptiveSolveInput): string | undefined {
  const { liquidity, state, adaptivePolicy } = input;
  if (liquidity.stateId !== state.stateId) return "liquidity snapshot does not match confirmed portfolio state";
  if (liquidity.blockNumber !== state.blockNumber) return "liquidity snapshot block does not match portfolio block";
  if (state.blockTimestamp > liquidity.observedAt
    && state.blockTimestamp - liquidity.observedAt > adaptivePolicy.maxQuoteAge) {
    return "liquidity snapshot has expired";
  }
  for (const curve of liquidity.curves) {
    if (curve.stateId !== state.stateId || curve.blockNumber !== state.blockNumber) {
      return `liquidity curve ${curve.id} does not match confirmed state`;
    }
    if (state.blockTimestamp > curve.observedAt
      && state.blockTimestamp - curve.observedAt > adaptivePolicy.maxQuoteAge) {
      return `liquidity curve ${curve.id} has expired`;
    }
    if (curve.samples.some(({ validity }) => validity.stateId !== state.stateId || validity.blockNumber !== state.blockNumber)) {
      return `liquidity sample in ${curve.id} does not match confirmed state`;
    }
  }
  return undefined;
}

function buildCandidates(input: AdaptiveSolveInput): Candidate[] {
  const { state, policy } = input;
  const cashMin = max(state.nav * policy.cashTarget.min / WAD, policy.minimumCashBuffer ?? 0n);
  const cashMax = state.nav * policy.cashTarget.max / WAD;
  const ranked = rankedAssets(input);
  const over = ranked.filter(({ overValue }) => overValue > 0n).sort(byValueThenToken("overValue"));
  const under = ranked.filter(({ underValue }) => underValue > 0n).sort(byValueThenToken("underValue"));
  const candidates: Candidate[] = [];

  if (state.baseAssetBalance < cashMin) {
    const deficit = cashMin - state.baseAssetBalance;
    const sources = over.length > 0
      ? over
      : ranked.filter(({ sellHeadroom }) => sellHeadroom > 0n).sort(byValueThenToken("sellHeadroom"));
    for (const source of sources) {
      const desired = min(source.sellHeadroom, policy.maxLegValue, source.value);
      for (const decision of safeDecisions(input, source.asset.token, policy.baseAsset, desired)) {
        if (decision.sample.expectedOut > deficit + (cashMax - cashMin)) continue;
        const candidate = finalize(input, `cash:${source.asset.token}:${decision.sample.sampleIndex}`, [decision], "raise base-asset balance with the best sampled executable sale");
        if (candidate) candidates.push(candidate);
      }
    }
    return candidates;
  }

  if (state.baseAssetBalance > cashMax) {
    const spendable = state.baseAssetBalance - cashMax;
    const destinations = under.length > 0
      ? under
      : ranked.filter(({ buyHeadroom }) => buyHeadroom > 0n).sort(byValueThenToken("buyHeadroom"));
    for (const destination of destinations) {
      const desired = min(destination.buyHeadroom, policy.maxLegValue, spendable);
      for (const decision of safeDecisions(input, policy.baseAsset, destination.asset.token, desired)) {
        const candidate = finalize(input, `deploy:${destination.asset.token}:${decision.sample.sampleIndex}`, [decision], "deploy excess base asset using a sampled executable buy");
        if (candidate) candidates.push(candidate);
      }
    }
    return candidates;
  }

  const existingSpendable = state.baseAssetBalance > cashMin ? state.baseAssetBalance - cashMin : 0n;
  const pairSources = over.length > 0
    ? over
    : under.length > 0
      ? ranked.filter(({ sellHeadroom }) => sellHeadroom > 0n).sort(byValueThenToken("sellHeadroom"))
      : [];
  const pairDestinations = under.length > 0
    ? under
    : over.length > 0
      ? ranked.filter(({ buyHeadroom }) => buyHeadroom > 0n).sort(byValueThenToken("buyHeadroom"))
      : [];
  for (const source of pairSources) {
    const sourceLimit = min(source.overValue, source.sellHeadroom, policy.maxLegValue, source.value);
    const effectiveSourceLimit = sourceLimit > 0n
      ? sourceLimit
      : min(source.sellHeadroom, policy.maxLegValue, source.value);
    const sells = safeDecisions(input, source.asset.token, policy.baseAsset, effectiveSourceLimit);
    for (const destination of pairDestinations) {
      if (destination.asset.token.toLowerCase() === source.asset.token.toLowerCase()) continue;
      const destinationLimit = destination.underValue > 0n
        ? min(destination.underValue, destination.buyHeadroom, policy.maxLegValue)
        : min(destination.buyHeadroom, policy.maxLegValue);
      const buys = safeDecisions(input, policy.baseAsset, destination.asset.token, destinationLimit);
      for (const buy of buys) {
        const requiredSale = buy.trade.amountIn > existingSpendable ? buy.trade.amountIn - existingSpendable : 0n;
        if (requiredSale === 0n) {
          const candidate = finalize(input, `cash-buy:${destination.asset.token}:${buy.sample.sampleIndex}`, [buy], "use confirmed spendable cash for a sampled executable buy");
          if (candidate) candidates.push(candidate);
          continue;
        }
        const sell = sells.find(({ trade }) => trade.minAmountOut >= requiredSale);
        if (!sell) continue;
        const candidate = finalize(
          input,
          `pair:${source.asset.token}:${destination.asset.token}:${sell.sample.sampleIndex}:${buy.sample.sampleIndex}`,
          [sell, buy],
          "move one depth-aware USDC-hub step from an overweight to an underweight"
        );
        if (candidate) candidates.push(candidate);
      }
    }
  }

  // A remaining one-sided violation may be corrected through available cash
  // capacity without forcing an otherwise in-range asset to move.
  if (under.length > 0 && state.baseAssetBalance > cashMin) {
    const spendable = state.baseAssetBalance - cashMin;
    for (const destination of under) {
      const limit = min(destination.underValue, destination.buyHeadroom, policy.maxLegValue, spendable);
      for (const buy of safeDecisions(input, policy.baseAsset, destination.asset.token, limit)) {
        const candidate = finalize(input, `cash-capacity-buy:${destination.asset.token}:${buy.sample.sampleIndex}`, [buy], "reduce an underweight using available cash capacity");
        if (candidate) candidates.push(candidate);
      }
    }
  }
  if (over.length > 0 && state.baseAssetBalance < cashMax) {
    const capacity = cashMax - state.baseAssetBalance;
    for (const source of over) {
      const limit = min(source.overValue, source.sellHeadroom, policy.maxLegValue, source.value);
      for (const sell of safeDecisions(input, source.asset.token, policy.baseAsset, limit)) {
        if (sell.sample.expectedOut > capacity) continue;
        const candidate = finalize(input, `cash-capacity-sell:${source.asset.token}:${sell.sample.sampleIndex}`, [sell], "reduce an overweight into available cash capacity");
        if (candidate) candidates.push(candidate);
      }
    }
  }
  return candidates;
}

function rankedAssets(input: AdaptiveSolveInput): RankedAsset[] {
  return input.policy.assets.filter(({ enabled }) => enabled).map((asset) => {
    const position = input.state.positions.find(({ token }) => token.toLowerCase() === asset.token.toLowerCase());
    if (!position) throw new Error(`validated input lost position ${asset.token}`);
    const minValue = input.state.nav * asset.target.min / WAD;
    const maxValue = input.state.nav * asset.target.max / WAD;
    return {
      asset,
      balance: position.balance,
      value: position.value,
      overValue: position.value > maxValue ? position.value - maxValue : 0n,
      underValue: position.value < minValue ? minValue - position.value : 0n,
      sellHeadroom: position.value > minValue ? position.value - minValue : 0n,
      buyHeadroom: position.value < maxValue ? maxValue - position.value : 0n
    };
  });
}

function safeDecisions(
  input: AdaptiveSolveInput,
  tokenIn: Trade["tokenIn"],
  tokenOut: Trade["tokenOut"],
  maximumInputValue: bigint
): Decision[] {
  const curve = curveFor(input.liquidity, tokenIn, tokenOut);
  if (!curve) return [];
  return curve.samples.filter((sample) => {
    if (!quoteIsCurrent(sample, input.state.stateId, input.state.blockTimestamp, input.adaptivePolicy.maxQuoteAge)) return false;
    if (!sample.minOutCompatible || sample.inputValue > maximumInputValue) return false;
    if (input.adaptivePolicy.maxPriceImpact !== undefined && sample.priceImpactWad > input.adaptivePolicy.maxPriceImpact) return false;
    return sample.amountIn > 0n && sample.expectedOut > 0n;
  }).sort((a, b) => a.amountIn < b.amountIn ? -1 : a.amountIn > b.amountIn ? 1 : 0).map((sample) => ({
    curve,
    sample,
    trade: {
      tokenIn,
      tokenOut,
      amountIn: sample.amountIn,
      minAmountOut: sample.oracleOut * (WAD - input.policy.slippageTolerance) / WAD
    }
  }));
}

function finalize(input: AdaptiveSolveInput, id: string, decisions: Decision[], reason: string): Candidate | undefined {
  const trades = decisions.map(({ trade }) => trade);
  if (!balancesCover(input, trades)) return undefined;
  const projection = project(input, decisions);
  const driftBefore = currentRangeDrift(input);
  if (projection.drift >= driftBefore) return undefined;
  if (input.policy.minimumExpectedImprovement !== undefined
    && driftBefore - projection.drift < input.policy.minimumExpectedImprovement) return undefined;
  if (input.policy.maxTurnover !== undefined
    && projection.turnover > input.state.nav * input.policy.maxTurnover / WAD) return undefined;
  return {
    id,
    trades,
    decisions,
    expectedDriftAfter: projection.drift,
    expectedTurnover: projection.turnover,
    expectedCost: {
      quoteLossValue: decisions.reduce((sum, { sample }) => sum + sample.quoteLossValue, 0n),
      estimatedFeeValue: decisions.reduce((sum, { sample }) => sum + sample.estimatedFeeValue, 0n),
      gasCostValue: null,
      model: "fork-executed adapter quote loss; known pool fee reported as a component"
    },
    minimumSafetyMarginWad: decisions.reduce((minimum, decision) => {
      const margin = safetyMarginWad(decision);
      return margin < minimum ? margin : minimum;
    }, WAD),
    reason
  };
}

function balancesCover(input: AdaptiveSolveInput, trades: readonly Trade[]): boolean {
  const balances = new Map(input.state.positions.map(({ token, balance }) => [token.toLowerCase(), balance]));
  balances.set(input.policy.baseAsset.toLowerCase(), input.state.baseAssetBalance);
  for (const trade of trades) {
    const available = balances.get(trade.tokenIn.toLowerCase()) ?? 0n;
    if (trade.amountIn > available) return false;
    balances.set(trade.tokenIn.toLowerCase(), available - trade.amountIn);
    balances.set(trade.tokenOut.toLowerCase(), (balances.get(trade.tokenOut.toLowerCase()) ?? 0n) + trade.minAmountOut);
  }
  return (balances.get(input.policy.baseAsset.toLowerCase()) ?? 0n) >= (input.policy.minimumCashBuffer ?? 0n);
}

function project(input: AdaptiveSolveInput, decisions: readonly Decision[]): { drift: bigint; turnover: bigint } {
  let baseValue = input.state.baseAssetBalance;
  const values = new Map(input.state.positions.map(({ token, value }) => [token.toLowerCase(), value]));
  let turnover = 0n;
  for (const { trade, sample } of decisions) {
    turnover += sample.inputValue;
    if (trade.tokenIn.toLowerCase() === input.policy.baseAsset.toLowerCase()) {
      baseValue -= trade.amountIn;
      values.set(trade.tokenOut.toLowerCase(), (values.get(trade.tokenOut.toLowerCase()) ?? 0n) + sample.outputValue);
    } else {
      values.set(trade.tokenIn.toLowerCase(), (values.get(trade.tokenIn.toLowerCase()) ?? 0n) - sample.inputValue);
      baseValue += sample.expectedOut;
    }
  }
  const projectedNav = baseValue + [...values.values()].reduce((sum, value) => sum + value, 0n);
  return {
    drift: rangeDrift(projectedNav, baseValue, values, input.policy.assets, input.policy.cashTarget),
    turnover
  };
}

function currentRangeDrift(input: AdaptiveSolveInput): bigint {
  return rangeDrift(
    input.state.nav,
    input.state.baseAssetBalance,
    new Map(input.state.positions.map(({ token, value }) => [token.toLowerCase(), value])),
    input.policy.assets,
    input.policy.cashTarget
  );
}

function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.expectedDriftAfter !== b.expectedDriftAfter) return a.expectedDriftAfter < b.expectedDriftAfter ? -1 : 1;
  if (a.expectedCost.quoteLossValue !== b.expectedCost.quoteLossValue) return a.expectedCost.quoteLossValue < b.expectedCost.quoteLossValue ? -1 : 1;
  if (a.expectedTurnover !== b.expectedTurnover) return a.expectedTurnover < b.expectedTurnover ? -1 : 1;
  if (a.minimumSafetyMarginWad !== b.minimumSafetyMarginWad) return a.minimumSafetyMarginWad > b.minimumSafetyMarginWad ? -1 : 1;
  if (a.trades.length !== b.trades.length) return a.trades.length - b.trades.length;
  return a.id.localeCompare(b.id);
}

function tightestDecision(candidate: Candidate): Decision | undefined {
  return [...candidate.decisions].sort((a, b) => {
    const left = safetyMarginWad(a);
    const right = safetyMarginWad(b);
    return left < right ? -1 : left > right ? 1 : a.curve.id.localeCompare(b.curve.id);
  })[0];
}

function safetyMarginWad(decision: Decision): bigint {
  if (decision.trade.minAmountOut === 0n || decision.sample.expectedOut <= decision.trade.minAmountOut) return 0n;
  return (decision.sample.expectedOut - decision.trade.minAmountOut) * WAD / decision.trade.minAmountOut;
}

function plan(
  input: AdaptiveSolveInput,
  candidate: Candidate,
  simulation: RebalancePlan["simulation"],
  rejectedAlternatives: RejectedAlternative[]
): RebalancePlan {
  return {
    kind: "plan",
    vault: input.vault,
    stateId: input.state.stateId,
    blockNumber: input.state.blockNumber,
    trades: candidate.trades,
    expectedDriftBefore: currentRangeDrift(input),
    expectedDriftAfter: candidate.expectedDriftAfter,
    expectedTurnover: candidate.expectedTurnover,
    expectedCost: candidate.expectedCost,
    activeConstraints: [
      `maxLegValue=${input.policy.maxLegValue}`,
      `slippageTolerance=${input.policy.slippageTolerance}`,
      `maxNavLoss=${input.policy.maxNavLoss}`,
      `maxQuoteAge=${input.adaptivePolicy.maxQuoteAge}`,
      "fork-executable-liquidity",
      "simulation-required"
    ],
    rejectedAlternatives,
    simulation,
    reason: candidate.reason,
    liquidityDecisions: candidate.decisions.map(decisionRecord)
  };
}

function decisionRecord({ curve, sample, trade }: Decision): LiquidityDecisionRecord {
  return {
    curveId: curve.id,
    sampleIndex: sample.sampleIndex,
    tokenIn: curve.tokenIn,
    tokenOut: curve.tokenOut,
    amountIn: sample.amountIn,
    expectedOut: sample.expectedOut,
    oracleOut: sample.oracleOut,
    safetyMarginOut: sample.expectedOut > trade.minAmountOut ? sample.expectedOut - trade.minAmountOut : 0n,
    safetyMarginWad: safetyMarginWad({ curve, sample, trade }),
    priceImpactWad: sample.priceImpactWad
  };
}

function noTrade(
  input: AdaptiveSolveInput,
  reason: NoTradeResult["reason"],
  details: string[],
  rejectedAlternatives: RejectedAlternative[] = []
): NoTradeResult {
  return { kind: "no-trade", stateId: input.state.stateId, reason, details, rejectedAlternatives };
}

function byValueThenToken<K extends "overValue" | "underValue" | "sellHeadroom" | "buyHeadroom">(
  field: K
): (a: RankedAsset, b: RankedAsset) => number {
  return (a, b) => {
    if (a[field] !== b[field]) return a[field] > b[field] ? -1 : 1;
    return a.asset.token.toLowerCase().localeCompare(b.asset.token.toLowerCase());
  };
}

function min(...values: bigint[]): bigint {
  const first = values[0];
  if (first === undefined) throw new Error("min requires values");
  return values.reduce((smallest, value) => value < smallest ? value : smallest, first);
}

function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
