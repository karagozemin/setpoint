import {
  WAD,
  classifyWeight,
  policyForToken,
  priceForToken,
  rangeDrift,
  targetRegionReached,
  validateSolveInput
} from "./policy.js";
import type {
  AssetPolicy,
  ConfirmedInputReader,
  NoTradeResult,
  PortfolioState,
  RebalancePlan,
  RejectedAlternative,
  SimulationAdapter,
  SimulationFailureCode,
  SolveInput,
  SolveResult,
  TokenAddress,
  Trade
} from "./types.js";

interface Candidate {
  id: string;
  trades: Trade[];
  expectedDriftAfter: bigint;
  expectedTurnover: bigint;
  reason: string;
}

const BASIC_BACKOFF_FAILURES = new Set<SimulationFailureCode>([
  "TRADE_TOO_LARGE",
  "INSUFFICIENT_BALANCE",
  "SLIPPAGE_TOO_LOOSE",
  "DRIFT_NOT_IMPROVED"
]);

export async function solve(input: SolveInput, simulator: SimulationAdapter): Promise<SolveResult> {
  const issues = validateSolveInput(input);
  if (issues.length > 0) {
    const primary = issues[0];
    if (!primary) return noTrade(input, "INVALID_POLICY", ["unknown policy validation failure"]);
    return noTrade(input, primary.reason, issues.map(({ detail }) => detail));
  }

  const cashBufferSatisfied = input.state.baseAssetBalance >= (input.policy.minimumCashBuffer ?? 0n);
  if (cashBufferSatisfied && targetRegionReached(input.state, input.policy.assets, input.policy.cashTarget)) {
    return noTrade(input, "TARGET_REGION_REACHED", ["all enabled assets and cash are inside their target ranges"]);
  }
  if (cashBufferSatisfied && input.state.drift <= input.policy.driftTrigger) {
    return noTrade(input, "DRIFT_BELOW_TRIGGER", ["authoritative vault drift is at or below the configured trigger"]);
  }

  const initial = buildCandidate(input);
  if (!initial) return noTrade(input, "NO_FEASIBLE_PLAN", ["no deterministic USDC-hub step satisfies available balances and target direction"]);
  const driftBefore = currentRangeDrift(input);
  if (input.policy.maxTurnover !== undefined && initial.expectedTurnover > input.state.nav * input.policy.maxTurnover / WAD) {
    return noTrade(input, "NO_FEASIBLE_PLAN", ["candidate exceeds maxTurnover"]);
  }

  const rejected: RejectedAlternative[] = [];
  let candidate = initial;
  for (let attempt = 0; attempt < 4; attempt++) {
    const improvement = driftBefore > candidate.expectedDriftAfter ? driftBefore - candidate.expectedDriftAfter : 0n;
    if (improvement === 0n) {
      return noTrade(input, "NO_FEASIBLE_PLAN", ["candidate does not reduce expected target-range drift"], rejected);
    }
    if (input.policy.minimumExpectedImprovement !== undefined
      && improvement < input.policy.minimumExpectedImprovement) {
      return noTrade(input, "NO_FEASIBLE_PLAN", ["candidate improvement is below minimumExpectedImprovement"], rejected);
    }
    const constructionFailure = validateCandidate(input, candidate.trades);
    if (constructionFailure) {
      rejected.push({ candidateId: candidate.id, reason: constructionFailure });
      if (attempt === 3) {
        const reason = constructionFailure.startsWith("insufficient available balance")
          ? "INSUFFICIENT_BALANCE"
          : "NO_FEASIBLE_PLAN";
        return noTrade(input, reason, ["basic deterministic backoff exhausted", constructionFailure], rejected);
      }
      const backedOff = backoffCandidate(input, candidate, attempt + 1);
      if (!backedOff) return noTrade(input, "INSUFFICIENT_BALANCE", [constructionFailure], rejected);
      candidate = backedOff;
      continue;
    }

    const simulation = await simulator.simulate(candidate.trades, input.state);
    if (simulation.passed) {
      return {
        kind: "plan",
        vault: input.vault,
        stateId: input.state.stateId,
        blockNumber: input.state.blockNumber,
        trades: candidate.trades,
        expectedDriftBefore: driftBefore,
        expectedDriftAfter: candidate.expectedDriftAfter,
        expectedTurnover: candidate.expectedTurnover,
        expectedCost: null,
        activeConstraints: [
          `maxLegValue=${input.policy.maxLegValue}`,
          `slippageTolerance=${input.policy.slippageTolerance}`,
          `maxNavLoss=${input.policy.maxNavLoss}`,
          `maxPriceAge=${input.policy.maxPriceAge}`,
          "simulation-required"
        ],
        rejectedAlternatives: rejected,
        simulation,
        reason: candidate.reason
      };
    }

    rejected.push({ candidateId: candidate.id, reason: simulation.reason ?? simulation.failureCode ?? "simulation rejected", simulation });
    if (!simulation.failureCode || !BASIC_BACKOFF_FAILURES.has(simulation.failureCode)) {
      return noTrade(input, "SIMULATION_REJECTED", [simulation.reason ?? simulation.failureCode ?? "unknown simulation failure"], rejected);
    }
    const backedOff = backoffCandidate(input, candidate, attempt + 1);
    if (!backedOff) return noTrade(input, "SIMULATION_REJECTED", ["basic deterministic backoff exhausted"], rejected);
    candidate = backedOff;
  }

  return noTrade(input, "SIMULATION_REJECTED", ["basic deterministic backoff exhausted"], rejected);
}

function currentRangeDrift(input: SolveInput): bigint {
  return rangeDrift(
    input.state.nav,
    input.state.baseAssetBalance,
    new Map(input.state.positions.map(({ token, value }) => [token.toLowerCase(), value])),
    input.policy.assets,
    input.policy.cashTarget
  );
}

export async function solveConfirmedState(readConfirmedInput: ConfirmedInputReader, simulator: SimulationAdapter): Promise<SolveResult> {
  return solve(await readConfirmedInput(), simulator);
}

function buildCandidate(input: SolveInput): Candidate | undefined {
  const { state, policy } = input;
  const cashMin = max(state.nav * policy.cashTarget.min / WAD, policy.minimumCashBuffer ?? 0n);
  const cashMax = state.nav * policy.cashTarget.max / WAD;
  const ranked = policy.assets.filter(({ enabled }) => enabled).map((asset) => {
    const position = state.positions.find(({ token }) => token.toLowerCase() === asset.token.toLowerCase());
    if (!position) return undefined;
    const minValue = state.nav * asset.target.min / WAD;
    const maxValue = state.nav * asset.target.max / WAD;
    return {
      asset,
      position,
      overValue: position.value > maxValue ? position.value - maxValue : 0n,
      underValue: position.value < minValue ? minValue - position.value : 0n,
      sellHeadroom: position.value > minValue ? position.value - minValue : 0n,
      buyHeadroom: position.value < maxValue ? maxValue - position.value : 0n
    };
  }).filter((item): item is NonNullable<typeof item> => item !== undefined);

  const over = [...ranked].filter(({ overValue }) => overValue > 0n).sort(byValueThenToken("overValue"));
  const under = [...ranked].filter(({ underValue }) => underValue > 0n).sort(byValueThenToken("underValue"));

  if (state.baseAssetBalance < cashMin) {
    const source = (over.length > 0 ? over : [...ranked].filter(({ sellHeadroom }) => sellHeadroom > 0n).sort(byValueThenToken("sellHeadroom")))[0];
    if (!source) return undefined;
    const cashDeficit = cashMin - state.baseAssetBalance;
    const grossForGuaranteedCash = ceilDiv(cashDeficit * WAD, WAD - policy.slippageTolerance);
    const value = min(grossForGuaranteedCash, source.sellHeadroom, policy.maxLegValue, source.position.value);
    const sell = sellTrade(input, source.asset, value);
    return sell ? finalizeCandidate(input, "cash-below-range", [sell], "raise base-asset balance into its target range before risk allocation") : undefined;
  }

  if (state.baseAssetBalance > cashMax) {
    const destination = (under.length > 0 ? under : [...ranked].filter(({ buyHeadroom }) => buyHeadroom > 0n).sort(byValueThenToken("buyHeadroom")))[0];
    if (!destination) return undefined;
    const spendable = state.baseAssetBalance - cashMax;
    const value = min(spendable, destination.buyHeadroom, policy.maxLegValue);
    const buy = buyTrade(input, destination.asset, value);
    return buy ? finalizeCandidate(input, "cash-above-range", [buy], "deploy excess base asset toward the largest underweight") : undefined;
  }

  const source = over[0];
  const destination = under[0];
  if (source && destination) {
    const sellValue = min(source.overValue, policy.maxLegValue, source.position.value);
    const sell = sellTrade(input, source.asset, sellValue);
    if (!sell) return undefined;
    const guaranteedSale = sell.minAmountOut;
    const existingSpendable = state.baseAssetBalance > cashMin ? state.baseAssetBalance - cashMin : 0n;
    const buyValue = min(destination.underValue, policy.maxLegValue, guaranteedSale + existingSpendable);
    const buy = buyTrade(input, destination.asset, buyValue);
    if (!buy) return undefined;
    return finalizeCandidate(input, `pair:${source.asset.token}:${destination.asset.token}`, [sell, buy], "move one deterministic USDC-hub step from the largest overweight to the largest underweight");
  }

  if (destination && state.baseAssetBalance > cashMin) {
    const buy = buyTrade(input, destination.asset, min(destination.underValue, policy.maxLegValue, state.baseAssetBalance - cashMin));
    return buy ? finalizeCandidate(input, "cash-funded-buy", [buy], "use available base asset to reduce the largest underweight") : undefined;
  }
  if (source && state.baseAssetBalance < cashMax) {
    const sell = sellTrade(input, source.asset, min(source.overValue, policy.maxLegValue, cashMax - state.baseAssetBalance));
    return sell ? finalizeCandidate(input, "cash-capacity-sell", [sell], "reduce the largest overweight without exceeding the cash range") : undefined;
  }
  return undefined;
}

function sellTrade(input: SolveInput, asset: AssetPolicy, value: bigint): Trade | undefined {
  if (value <= 0n) return undefined;
  const price = priceForToken(input.prices, asset.token);
  if (!price || price.priceWad <= 0n) return undefined;
  const amountIn = value * WAD / price.priceWad;
  if (amountIn <= 0n) return undefined;
  const oracleOut = amountIn * price.priceWad / WAD;
  return {
    tokenIn: asset.token,
    tokenOut: input.policy.baseAsset,
    amountIn,
    minAmountOut: oracleOut * (WAD - input.policy.slippageTolerance) / WAD
  };
}

function buyTrade(input: SolveInput, asset: AssetPolicy, value: bigint): Trade | undefined {
  if (value <= 0n) return undefined;
  const price = priceForToken(input.prices, asset.token);
  if (!price || price.priceWad <= 0n) return undefined;
  const oracleOut = value * WAD / price.priceWad;
  if (oracleOut <= 0n) return undefined;
  return {
    tokenIn: input.policy.baseAsset,
    tokenOut: asset.token,
    amountIn: value,
    minAmountOut: oracleOut * (WAD - input.policy.slippageTolerance) / WAD
  };
}

function finalizeCandidate(input: SolveInput, id: string, trades: Trade[], reason: string): Candidate {
  const projection = project(input, trades);
  return {
    id,
    trades,
    expectedDriftAfter: projection.drift,
    expectedTurnover: projection.turnover,
    reason
  };
}

function project(input: SolveInput, trades: readonly Trade[]): { drift: bigint; turnover: bigint } {
  let baseValue = input.state.baseAssetBalance;
  const values = new Map(input.state.positions.map(({ token, value }) => [token.toLowerCase(), value]));
  let turnover = 0n;
  for (const trade of trades) {
    if (trade.tokenIn.toLowerCase() === input.policy.baseAsset.toLowerCase()) {
      baseValue -= trade.amountIn;
      const outputPolicy = policyForToken(input.policy.assets, trade.tokenOut);
      const price = outputPolicy ? priceForToken(input.prices, outputPolicy.token) : undefined;
      const valueOut = price ? trade.amountIn : 0n;
      values.set(trade.tokenOut.toLowerCase(), (values.get(trade.tokenOut.toLowerCase()) ?? 0n) + valueOut);
      turnover += trade.amountIn;
    } else {
      const price = priceForToken(input.prices, trade.tokenIn);
      const valueIn = price ? trade.amountIn * price.priceWad / WAD : 0n;
      values.set(trade.tokenIn.toLowerCase(), (values.get(trade.tokenIn.toLowerCase()) ?? 0n) - valueIn);
      baseValue += valueIn;
      turnover += valueIn;
    }
  }
  return {
    drift: rangeDrift(input.state.nav, baseValue, values, input.policy.assets, input.policy.cashTarget),
    turnover
  };
}

function validateCandidate(input: SolveInput, trades: readonly Trade[]): string | undefined {
  if (trades.length === 0) return "candidate has no trades";
  const balances = new Map(input.state.positions.map(({ token, balance }) => [token.toLowerCase(), balance]));
  balances.set(input.policy.baseAsset.toLowerCase(), input.state.baseAssetBalance);
  for (const trade of trades) {
    const allowed = trade.tokenIn.toLowerCase() === input.policy.baseAsset.toLowerCase()
      || policyForToken(input.policy.assets, trade.tokenIn)?.enabled === true;
    const outputAllowed = trade.tokenOut.toLowerCase() === input.policy.baseAsset.toLowerCase()
      || policyForToken(input.policy.assets, trade.tokenOut)?.enabled === true;
    if (!allowed || !outputAllowed) return "candidate contains an unsupported asset";
    const notional = trade.tokenIn.toLowerCase() === input.policy.baseAsset.toLowerCase()
      ? trade.amountIn
      : trade.amountIn * (priceForToken(input.prices, trade.tokenIn)?.priceWad ?? 0n) / WAD;
    if (notional > input.policy.maxLegValue) return "candidate leg exceeds maxLegValue";
    const available = balances.get(trade.tokenIn.toLowerCase()) ?? 0n;
    if (trade.amountIn > available) return `insufficient available balance for ${trade.tokenIn}`;
    balances.set(trade.tokenIn.toLowerCase(), available - trade.amountIn);
    const output = balances.get(trade.tokenOut.toLowerCase()) ?? 0n;
    balances.set(trade.tokenOut.toLowerCase(), output + trade.minAmountOut);
  }
  if ((balances.get(input.policy.baseAsset.toLowerCase()) ?? 0n) < (input.policy.minimumCashBuffer ?? 0n)) {
    return "candidate would violate minimumCashBuffer";
  }
  return undefined;
}

function backoffCandidate(input: SolveInput, candidate: Candidate, attempt: number): Candidate | undefined {
  const divisor = 2n;
  const trades: Trade[] = [];
  for (const trade of candidate.trades) {
    const amountIn = trade.amountIn / divisor;
    if (amountIn === 0n) return undefined;
    const inputIsBase = trade.tokenIn.toLowerCase() === input.policy.baseAsset.toLowerCase();
    const price = priceForToken(input.prices, inputIsBase ? trade.tokenOut : trade.tokenIn);
    if (!price || price.priceWad <= 0n) return undefined;
    const oracleOut = inputIsBase
      ? amountIn * WAD / price.priceWad
      : amountIn * price.priceWad / WAD;
    const minAmountOut = oracleOut * (WAD - input.policy.slippageTolerance) / WAD;
    if (minAmountOut === 0n) return undefined;
    trades.push({ ...trade, amountIn, minAmountOut });
  }
  return finalizeCandidate(input, `${candidate.id}:backoff-${attempt}`, trades, `${candidate.reason}; basic backoff ${attempt}`);
}

function noTrade(
  input: SolveInput,
  reason: NoTradeResult["reason"],
  details: string[],
  rejectedAlternatives: RejectedAlternative[] = []
): NoTradeResult {
  return { kind: "no-trade", stateId: input.state.stateId, reason, details, rejectedAlternatives };
}

function byValueThenToken<K extends "overValue" | "underValue" | "sellHeadroom" | "buyHeadroom">(
  field: K
): (a: Record<K, bigint> & { asset: AssetPolicy }, b: Record<K, bigint> & { asset: AssetPolicy }) => number {
  return (a, b) => {
    if (a[field] !== b[field]) return a[field] > b[field] ? -1 : 1;
    return a.asset.token.toLowerCase().localeCompare(b.asset.token.toLowerCase());
  };
}

function min(...values: bigint[]): bigint {
  const first = values[0];
  if (first === undefined) throw new Error("min requires at least one value");
  return values.reduce((smallest, value) => value < smallest ? value : smallest, first);
}

function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return numerator === 0n ? 0n : (numerator - 1n) / denominator + 1n;
}
