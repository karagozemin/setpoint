import type { AdaptiveSolveInput } from "./adaptive-solver.js";
import { curveFor, quoteIsCurrent, type LiquidityCurve, type LiquiditySample } from "./liquidity.js";
import { WAD, rangeDrift, targetRegionReached, validateSolveInput } from "./policy.js";
import type {
  AssetPolicy,
  ExcludedLiquidityLeg,
  ExecutionCostEstimate,
  LiquidityDecisionRecord,
  NoTradeResult,
  RebalancePlan,
  RejectedAlternative,
  SimulationAdapter,
  SolveResult,
  TokenAddress,
  Trade
} from "./types.js";

export type ConfirmedBatchInputReader = () => Promise<AdaptiveSolveInput>;

interface RankedAsset {
  asset: AssetPolicy;
  balance: bigint;
  value: bigint;
  overValue: bigint;
  underValue: bigint;
  sellHeadroom: bigint;
  buyHeadroom: bigint;
  priceWad: bigint;
}

interface LegOption {
  id: string;
  direction: "sell" | "buy";
  asset: RankedAsset;
  curve: LiquidityCurve;
  desiredAmountIn: bigint;
  maximumSafeAmountIn: bigint;
  samples: LiquiditySample[];
  unavailableReason?: string;
}

interface SelectedLeg {
  option: LegOption;
  sample: LiquiditySample;
  trade: Trade;
  bindingConstraint: string;
}

interface BatchCandidate {
  id: string;
  trades: Trade[];
  legs: SelectedLeg[];
  excluded: ExcludedLiquidityLeg[];
  expectedDriftAfter: bigint;
  expectedTurnover: bigint;
  expectedCost: ExecutionCostEstimate;
  minimumSafetyMarginWad: bigint;
}

interface BuildLimits {
  maximumAmountByCurve: Map<string, bigint>;
  bindingByCurve: Map<string, string>;
}

export async function solveBatchAdaptive(input: AdaptiveSolveInput, simulator: SimulationAdapter): Promise<SolveResult> {
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

  const catalog = buildCatalog(input);
  const limits: BuildLimits = { maximumAmountByCurve: new Map(), bindingByCurve: new Map() };
  const rejected: RejectedAlternative[] = [];
  const attempts = Math.max(1, input.adaptivePolicy.maxSimulationAttempts);

  for (let attempt = 0; attempt < attempts; attempt++) {
    const candidate = bestBoundedCandidate(input, catalog.options, catalog.excluded, limits);
    if (!candidate) {
      return noTrade(
        input,
        "NO_SAFE_LIQUIDITY",
        [rejected.length > 0 ? "selective liquidity-aware rebuild exhausted" : "no coherent executable multi-leg batch reduces target-band drift"],
        rejected,
        noProgressExclusions(catalog.options, catalog.excluded)
      );
    }

    const simulation = await simulator.simulate(candidate.trades, input.state);
    if (simulation.passed) return plan(input, candidate, simulation, rejected);

    const binding = tightestLeg(candidate.legs);
    rejected.push({
      candidateId: candidate.id,
      reason: `${simulation.reason ?? simulation.failureCode ?? "simulation rejected"}${binding ? `; selective binding leg ${binding.option.id} sample ${binding.sample.sampleIndex}` : ""}`,
      simulation,
      trades: candidate.trades,
      expectedTurnover: candidate.expectedTurnover,
      liquidityDecisions: candidate.legs.map(decisionRecord)
    });
    if (simulation.failureCode !== "INSUFFICIENT_OUTPUT" || !binding) {
      return noTrade(input, "SIMULATION_REJECTED", [simulation.reason ?? simulation.failureCode ?? "unknown simulation failure"], rejected, candidate.excluded);
    }
    const smaller = binding.option.samples.filter(({ amountIn }) => amountIn < binding.sample.amountIn).at(-1);
    limits.maximumAmountByCurve.set(binding.option.curve.id, smaller?.amountIn ?? 0n);
    limits.bindingByCurve.set(binding.option.curve.id, smaller ? "SIMULATION_SELECTIVE_BACKOFF" : "SIMULATION_LEG_REMOVED");
  }
  return noTrade(input, "NO_SAFE_LIQUIDITY", ["bounded selective simulation backoff exhausted"], rejected, noProgressExclusions(catalog.options, catalog.excluded));
}

export async function solveBatchConfirmed(
  readConfirmedInput: ConfirmedBatchInputReader,
  simulator: SimulationAdapter
): Promise<SolveResult> {
  return solveBatchAdaptive(await readConfirmedInput(), simulator);
}

function validateLiquidity(input: AdaptiveSolveInput): string | undefined {
  const { liquidity, state, adaptivePolicy } = input;
  if (liquidity.stateId !== state.stateId || liquidity.blockNumber !== state.blockNumber) {
    return "liquidity snapshot does not match confirmed state";
  }
  if (state.blockTimestamp > liquidity.observedAt && state.blockTimestamp - liquidity.observedAt > adaptivePolicy.maxQuoteAge) {
    return "liquidity snapshot has expired";
  }
  for (const curve of liquidity.curves) {
    if (curve.stateId !== state.stateId || curve.blockNumber !== state.blockNumber) return `curve ${curve.id} does not match confirmed state`;
    if (curve.samples.some(({ validity }) => validity.stateId !== state.stateId || validity.blockNumber !== state.blockNumber)) {
      return `sample in ${curve.id} does not match confirmed state`;
    }
  }
  return undefined;
}

function buildCatalog(input: AdaptiveSolveInput): { options: LegOption[]; excluded: ExcludedLiquidityLeg[] } {
  const ranked = rankedAssets(input);
  const cashMin = max(input.state.nav * input.policy.cashTarget.min / WAD, input.policy.minimumCashBuffer ?? 0n);
  const cashMax = input.state.nav * input.policy.cashTarget.max / WAD;
  const cashBelow = input.state.baseAssetBalance < cashMin;
  const cashAbove = input.state.baseAssetBalance > cashMax;
  const hasOver = ranked.some(({ overValue }) => overValue > 0n);
  const hasUnder = ranked.some(({ underValue }) => underValue > 0n);
  const options: LegOption[] = [];
  const excluded: ExcludedLiquidityLeg[] = [];

  for (const item of ranked) {
    const sellValue = item.overValue > 0n
      ? item.overValue
      : (cashBelow || (hasUnder && !hasOver)) ? item.sellHeadroom : 0n;
    if (sellValue > 0n) {
      const desiredValue = min(sellValue, input.policy.maxLegValue, item.value);
      const desiredAmount = min(item.balance, desiredValue * WAD / item.priceWad);
      addOption(input, options, excluded, "sell", item, item.asset.token, input.policy.baseAsset, desiredAmount);
    }

    const buyValue = item.underValue > 0n
      ? item.underValue
      : (cashAbove || (hasOver && !hasUnder)) ? item.buyHeadroom : 0n;
    if (buyValue > 0n) {
      const desiredAmount = min(buyValue, input.policy.maxLegValue);
      addOption(input, options, excluded, "buy", item, input.policy.baseAsset, item.asset.token, desiredAmount);
    }
  }
  return { options, excluded };
}

function addOption(
  input: AdaptiveSolveInput,
  options: LegOption[],
  excluded: ExcludedLiquidityLeg[],
  direction: LegOption["direction"],
  asset: RankedAsset,
  tokenIn: TokenAddress,
  tokenOut: TokenAddress,
  desiredAmountIn: bigint
): void {
  if (desiredAmountIn <= 0n) return;
  const curve = curveFor(input.liquidity, tokenIn, tokenOut);
  if (!curve) {
    excluded.push({ tokenIn, tokenOut, desiredAmountIn, reason: "MISSING_LIQUIDITY_CURVE" });
    return;
  }
  const samples = curve.samples.filter((sample) => {
    if (!quoteIsCurrent(sample, input.state.stateId, input.state.blockTimestamp, input.adaptivePolicy.maxQuoteAge)) return false;
    if (!sample.minOutCompatible || sample.amountIn > desiredAmountIn) return false;
    if (input.adaptivePolicy.maxPriceImpact !== undefined && sample.priceImpactWad > input.adaptivePolicy.maxPriceImpact) return false;
    return sample.amountIn > 0n && sample.expectedOut > 0n;
  }).sort((a, b) => a.amountIn < b.amountIn ? -1 : a.amountIn > b.amountIn ? 1 : 0);
  if (samples.length === 0) {
    excluded.push({ tokenIn, tokenOut, desiredAmountIn, reason: "NO_MINOUT_COMPATIBLE_SAMPLE", curveId: curve.id });
    return;
  }
  options.push({
    id: `${direction}:${asset.asset.token}`,
    direction,
    asset,
    curve,
    desiredAmountIn,
    maximumSafeAmountIn: samples.at(-1)?.amountIn ?? 0n,
    samples
  });
}

function constructBatch(
  input: AdaptiveSolveInput,
  allOptions: readonly LegOption[],
  catalogExcluded: readonly ExcludedLiquidityLeg[],
  limits: BuildLimits
): BatchCandidate | undefined {
  const sells = allOptions.filter(({ direction }) => direction === "sell").sort(compareOptions);
  const buys = allOptions.filter(({ direction }) => direction === "buy").sort(compareOptions);
  const selectedBuys: SelectedLeg[] = [];
  const selectedSells: SelectedLeg[] = [];
  const excluded = [...catalogExcluded];
  const cashMin = max(input.state.nav * input.policy.cashTarget.min / WAD, input.policy.minimumCashBuffer ?? 0n);
  const cashMax = input.state.nav * input.policy.cashTarget.max / WAD;
  const cashMid = input.state.nav * midpoint(input.policy.cashTarget.min, input.policy.cashTarget.max) / WAD;
  const cashGoal = input.state.baseAssetBalance < cashMin || input.state.baseAssetBalance > cashMax
    ? max(cashMid, input.policy.minimumCashBuffer ?? 0n)
    : cashMin;

  const maximumSellProceeds = sells.reduce((sum, option) => {
    const sample = maximumAllowedSample(option, limits);
    return sum + (sample ? conservativeOut(input, option, sample) : 0n);
  }, 0n);
  let buyBudget = (input.state.baseAssetBalance > cashGoal ? input.state.baseAssetBalance - cashGoal : 0n) + maximumSellProceeds;
  for (const option of buys) {
    const sample = largestSampleWithin(option, limits, buyBudget);
    if (!sample) {
      excluded.push(excludedOption(option, "INSUFFICIENT_CONSERVATIVE_USDC"));
      continue;
    }
    selectedBuys.push(selectedLeg(input, option, sample, limits));
    buyBudget -= sample.amountIn;
  }

  const adjustmentBound = selectedBuys.reduce((sum, { option }) => sum + option.samples.length, 0) + 1;
  for (let adjustment = 0; adjustment < adjustmentBound; adjustment++) {
    selectedSells.length = 0;
    const selectedBuySpend = selectedBuys.reduce((sum, { sample }) => sum + sample.amountIn, 0n);
    const requiredProceeds = selectedBuySpend + cashGoal > input.state.baseAssetBalance
      ? selectedBuySpend + cashGoal - input.state.baseAssetBalance
      : 0n;
    const sellCapacity = selectedBuySpend + cashMax > input.state.baseAssetBalance
      ? selectedBuySpend + cashMax - input.state.baseAssetBalance
      : 0n;
    let proceeds = 0n;
    let remainingCapacity = sellCapacity;
    for (const option of sells) {
      if (remainingCapacity === 0n) continue;
      const sample = largestSampleByConservativeOut(input, option, limits, remainingCapacity);
      if (!sample) continue;
      const leg = selectedLeg(input, option, sample, limits);
      selectedSells.push(leg);
      const guaranteed = leg.trade.minAmountOut;
      proceeds += guaranteed;
      remainingCapacity = guaranteed >= remainingCapacity ? 0n : remainingCapacity - guaranteed;
    }
    if (proceeds >= requiredProceeds) {
      const selectedSellIds = new Set(selectedSells.map(({ option }) => option.id));
      for (const option of sells) {
        if (!selectedSellIds.has(option.id)) excluded.push(excludedOption(option, "CASH_CAPACITY_OR_BACKOFF"));
      }
      return constructWithSelections(input, selectedSells, selectedBuys, excluded);
    }

    // Downgrade only the lowest-priority funded buy until conservative sell
    // proceeds cover every buy while retaining higher-priority independent legs.
    const bindingBuy = selectedBuys.at(-1);
    if (!bindingBuy) break;
    const smaller = bindingBuy.option.samples.filter(({ amountIn }) => amountIn < bindingBuy.sample.amountIn).at(-1);
    if (smaller) {
      selectedBuys[selectedBuys.length - 1] = selectedLeg(input, bindingBuy.option, smaller, limits);
    } else {
      selectedBuys.pop();
      excluded.push(excludedOption(bindingBuy.option, "CONSERVATIVE_SELL_PROCEEDS"));
    }
  }
  return constructWithSelections(input, selectedSells, selectedBuys, excluded);
}

function bestBoundedCandidate(
  input: AdaptiveSolveInput,
  options: readonly LegOption[],
  excluded: readonly ExcludedLiquidityLeg[],
  limits: BuildLimits
): BatchCandidate | undefined {
  const candidates = new Map<string, BatchCandidate>();
  addCandidate(candidates, candidateForLimits(input, options, excluded, copyLimits(limits)));

  // The search is deliberately bounded to the maximal batch plus one local
  // reduction/removal per directional leg. This captures independently
  // binding liquidity without an exponential subset search.
  for (const option of options) {
    const allowed = maximumAllowedSample(option, limits);
    if (!allowed) continue;
    const smaller = option.samples.filter(({ amountIn }) => amountIn < allowed.amountIn).at(-1);
    const local = copyLimits(limits);
    local.maximumAmountByCurve.set(option.curve.id, smaller?.amountIn ?? 0n);
    local.bindingByCurve.set(option.curve.id, smaller ? "BOUNDED_ALTERNATIVE_BACKOFF" : "BOUNDED_ALTERNATIVE_REMOVAL");
    addCandidate(candidates, candidateForLimits(input, options, excluded, local));
  }
  return [...candidates.values()].sort(compareCandidates)[0];
}

function candidateForLimits(
  input: AdaptiveSolveInput,
  options: readonly LegOption[],
  excluded: readonly ExcludedLiquidityLeg[],
  limits: BuildLimits
): BatchCandidate | undefined {
  return applyTurnoverLimit(input, options, excluded, limits, constructBatch(input, options, excluded, limits));
}

function addCandidate(candidates: Map<string, BatchCandidate>, candidate: BatchCandidate | undefined): void {
  if (candidate) candidates.set(candidate.id, candidate);
}

function compareCandidates(a: BatchCandidate, b: BatchCandidate): number {
  if (a.expectedDriftAfter !== b.expectedDriftAfter) return a.expectedDriftAfter < b.expectedDriftAfter ? -1 : 1;
  if (a.expectedCost.quoteLossValue !== b.expectedCost.quoteLossValue) return a.expectedCost.quoteLossValue < b.expectedCost.quoteLossValue ? -1 : 1;
  if (a.expectedTurnover !== b.expectedTurnover) return a.expectedTurnover < b.expectedTurnover ? -1 : 1;
  if (a.minimumSafetyMarginWad !== b.minimumSafetyMarginWad) return a.minimumSafetyMarginWad > b.minimumSafetyMarginWad ? -1 : 1;
  if (a.trades.length !== b.trades.length) return a.trades.length < b.trades.length ? -1 : 1;
  return a.id.localeCompare(b.id);
}

function copyLimits(limits: BuildLimits): BuildLimits {
  return {
    maximumAmountByCurve: new Map(limits.maximumAmountByCurve),
    bindingByCurve: new Map(limits.bindingByCurve)
  };
}

function noProgressExclusions(options: readonly LegOption[], excluded: readonly ExcludedLiquidityLeg[]): ExcludedLiquidityLeg[] {
  const known = new Set(excluded.map(({ tokenIn, tokenOut }) => `${tokenIn.toLowerCase()}:${tokenOut.toLowerCase()}`));
  return [
    ...excluded,
    ...options
      .filter(({ curve }) => !known.has(`${curve.tokenIn.toLowerCase()}:${curve.tokenOut.toLowerCase()}`))
      .map((option) => excludedOption(option, "NO_PORTFOLIO_LEVEL_SAFE_PROGRESS"))
  ];
}

function constructWithSelections(
  input: AdaptiveSolveInput,
  sells: readonly SelectedLeg[],
  buys: readonly SelectedLeg[],
  excluded: ExcludedLiquidityLeg[]
): BatchCandidate | undefined {
  const legs = [...sells, ...buys];
  if (legs.length === 0) return undefined;
  const trades = legs.map(({ trade }) => trade);
  if (!balancesCover(input, trades)) return undefined;
  const projection = project(input, legs);
  const before = currentRangeDrift(input);
  if (projection.drift >= before) return undefined;
  if (input.policy.minimumExpectedImprovement !== undefined && before - projection.drift < input.policy.minimumExpectedImprovement) return undefined;
  const loss = legs.reduce((sum, { sample }) => sum + sample.quoteLossValue, 0n);
  const fee = legs.reduce((sum, { sample }) => sum + sample.estimatedFeeValue, 0n);
  return {
    id: `batch:${legs.map(({ option, sample }) => `${option.id}@${sample.sampleIndex}`).join("|")}`,
    trades,
    legs,
    excluded,
    expectedDriftAfter: projection.drift,
    expectedTurnover: projection.turnover,
    expectedCost: {
      quoteLossValue: loss,
      estimatedFeeValue: fee,
      gasCostValue: null,
      model: "fork-executed adapter quote loss; known pool fee reported as a component"
    },
    minimumSafetyMarginWad: legs.reduce((minimum, leg) => min(minimum, safetyMarginWad(leg)), WAD)
  };
}

function applyTurnoverLimit(
  input: AdaptiveSolveInput,
  options: readonly LegOption[],
  excluded: readonly ExcludedLiquidityLeg[],
  limits: BuildLimits,
  initial: BatchCandidate | undefined
): BatchCandidate | undefined {
  if (!initial || input.policy.maxTurnover === undefined) return initial;
  const cap = input.state.nav * input.policy.maxTurnover / WAD;
  let candidate = initial;
  const bound = options.reduce((sum, { samples }) => sum + samples.length, 0) + 1;
  for (let index = 0; candidate.expectedTurnover > cap && index < bound; index++) {
    const largest = [...candidate.legs].sort((a, b) => a.sample.inputValue > b.sample.inputValue ? -1 : 1)[0];
    if (!largest) return undefined;
    const smaller = largest.option.samples.filter(({ amountIn }) => amountIn < largest.sample.amountIn).at(-1);
    limits.maximumAmountByCurve.set(largest.option.curve.id, smaller?.amountIn ?? 0n);
    limits.bindingByCurve.set(largest.option.curve.id, "MAX_TURNOVER");
    const rebuilt = constructBatch(input, options, excluded, limits);
    if (!rebuilt) return undefined;
    candidate = rebuilt;
  }
  return candidate.expectedTurnover <= cap ? candidate : undefined;
}

function selectedLeg(input: AdaptiveSolveInput, option: LegOption, sample: LiquiditySample, limits: BuildLimits): SelectedLeg {
  const minAmountOut = sample.oracleOut * (WAD - input.policy.slippageTolerance) / WAD;
  return {
    option,
    sample,
    trade: { tokenIn: option.curve.tokenIn, tokenOut: option.curve.tokenOut, amountIn: sample.amountIn, minAmountOut },
    bindingConstraint: limits.bindingByCurve.get(option.curve.id) ?? inferBinding(input, option, sample)
  };
}

function inferBinding(input: AdaptiveSolveInput, option: LegOption, sample: LiquiditySample): string {
  if (sample.amountIn < option.desiredAmountIn && sample.amountIn === option.maximumSafeAmountIn) return "EXECUTABLE_LIQUIDITY";
  if (sample.amountIn < option.maximumSafeAmountIn) return option.direction === "buy" ? "CONSERVATIVE_USDC" : "CASH_CAPACITY";
  const desiredValue = option.direction === "buy" ? option.desiredAmountIn : option.desiredAmountIn * option.asset.priceWad / WAD;
  if (desiredValue >= input.policy.maxLegValue) return "VAULT_MAX_LEG";
  if (option.direction === "sell" && option.desiredAmountIn >= option.asset.balance) return "AVAILABLE_BALANCE";
  return "TARGET_BAND_DISTANCE";
}

function maximumAllowedSample(option: LegOption, limits: BuildLimits): LiquiditySample | undefined {
  const limit = limits.maximumAmountByCurve.get(option.curve.id) ?? option.maximumSafeAmountIn;
  return option.samples.filter(({ amountIn }) => amountIn <= limit).at(-1);
}

function largestSampleWithin(option: LegOption, limits: BuildLimits, inputBudget: bigint): LiquiditySample | undefined {
  const limit = limits.maximumAmountByCurve.get(option.curve.id) ?? option.maximumSafeAmountIn;
  return option.samples.filter(({ amountIn }) => amountIn <= limit && amountIn <= inputBudget).at(-1);
}

function largestSampleByConservativeOut(
  input: AdaptiveSolveInput,
  option: LegOption,
  limits: BuildLimits,
  outputCapacity: bigint
): LiquiditySample | undefined {
  const limit = limits.maximumAmountByCurve.get(option.curve.id) ?? option.maximumSafeAmountIn;
  return option.samples.filter((sample) => sample.amountIn <= limit && conservativeOut(input, option, sample) <= outputCapacity).at(-1);
}

function conservativeOut(input: AdaptiveSolveInput, option: LegOption, sample: LiquiditySample): bigint {
  return sample.oracleOut * (WAD - input.policy.slippageTolerance) / WAD;
}

function rankedAssets(input: AdaptiveSolveInput): RankedAsset[] {
  return input.policy.assets.filter(({ enabled }) => enabled).map((asset) => {
    const position = input.state.positions.find(({ token }) => token.toLowerCase() === asset.token.toLowerCase());
    const price = input.prices.find(({ token }) => token.toLowerCase() === asset.token.toLowerCase());
    if (!position || !price) throw new Error(`validated input lost asset ${asset.token}`);
    const minValue = input.state.nav * asset.target.min / WAD;
    const maxValue = input.state.nav * asset.target.max / WAD;
    const targetValue = input.state.nav * midpoint(asset.target.min, asset.target.max) / WAD;
    return {
      asset,
      balance: position.balance,
      value: position.value,
      overValue: position.value > maxValue ? position.value - targetValue : 0n,
      underValue: position.value < minValue ? targetValue - position.value : 0n,
      sellHeadroom: position.value > targetValue ? position.value - targetValue : 0n,
      buyHeadroom: position.value < targetValue ? targetValue - position.value : 0n,
      priceWad: price.priceWad
    };
  });
}

function compareOptions(a: LegOption, b: LegOption): number {
  const aDistance = a.direction === "sell" ? a.asset.overValue : a.asset.underValue;
  const bDistance = b.direction === "sell" ? b.asset.overValue : b.asset.underValue;
  if (aDistance !== bDistance) return aDistance > bDistance ? -1 : 1;
  const aSample = a.samples.at(-1);
  const bSample = b.samples.at(-1);
  const aLoss = aSample?.quoteLossValue ?? 0n;
  const bLoss = bSample?.quoteLossValue ?? 0n;
  if (aLoss !== bLoss) return aLoss < bLoss ? -1 : 1;
  return a.id.localeCompare(b.id);
}

function excludedOption(option: LegOption, reason: string): ExcludedLiquidityLeg {
  return {
    tokenIn: option.curve.tokenIn,
    tokenOut: option.curve.tokenOut,
    desiredAmountIn: option.desiredAmountIn,
    reason,
    curveId: option.curve.id
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

function project(input: AdaptiveSolveInput, legs: readonly SelectedLeg[]): { drift: bigint; turnover: bigint } {
  let base = input.state.baseAssetBalance;
  const values = new Map(input.state.positions.map(({ token, value }) => [token.toLowerCase(), value]));
  let turnover = 0n;
  for (const { option, sample } of legs) {
    turnover += sample.inputValue;
    if (option.direction === "sell") {
      values.set(option.asset.asset.token.toLowerCase(), (values.get(option.asset.asset.token.toLowerCase()) ?? 0n) - sample.inputValue);
      base += sample.expectedOut;
    } else {
      base -= sample.amountIn;
      values.set(option.asset.asset.token.toLowerCase(), (values.get(option.asset.asset.token.toLowerCase()) ?? 0n) + sample.outputValue);
    }
  }
  const nav = base + [...values.values()].reduce((sum, value) => sum + value, 0n);
  return { drift: rangeDrift(nav, base, values, input.policy.assets, input.policy.cashTarget), turnover };
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

function tightestLeg(legs: readonly SelectedLeg[]): SelectedLeg | undefined {
  return [...legs].sort((a, b) => {
    const left = safetyMarginWad(a);
    const right = safetyMarginWad(b);
    return left < right ? -1 : left > right ? 1 : a.option.id.localeCompare(b.option.id);
  })[0];
}

function safetyMarginWad(leg: SelectedLeg): bigint {
  return leg.trade.minAmountOut === 0n || leg.sample.expectedOut <= leg.trade.minAmountOut
    ? 0n
    : (leg.sample.expectedOut - leg.trade.minAmountOut) * WAD / leg.trade.minAmountOut;
}

function decisionRecord(leg: SelectedLeg): LiquidityDecisionRecord {
  return {
    curveId: leg.option.curve.id,
    sampleIndex: leg.sample.sampleIndex,
    tokenIn: leg.trade.tokenIn,
    tokenOut: leg.trade.tokenOut,
    amountIn: leg.sample.amountIn,
    expectedOut: leg.sample.expectedOut,
    minAmountOut: leg.trade.minAmountOut,
    oracleOut: leg.sample.oracleOut,
    safetyMarginOut: leg.sample.expectedOut > leg.trade.minAmountOut ? leg.sample.expectedOut - leg.trade.minAmountOut : 0n,
    safetyMarginWad: safetyMarginWad(leg),
    priceImpactWad: leg.sample.priceImpactWad,
    desiredAmountIn: leg.option.desiredAmountIn,
    maximumSafeAmountIn: leg.option.maximumSafeAmountIn,
    bindingConstraint: leg.bindingConstraint,
    expectedQuoteLossValue: leg.sample.quoteLossValue
  };
}

function plan(
  input: AdaptiveSolveInput,
  candidate: BatchCandidate,
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
      "batch-conservative-minOut-funding",
      "state-bound-executable-liquidity",
      "simulation-required"
    ],
    rejectedAlternatives,
    simulation,
    reason: "execute the maximal bounded multi-asset batch ranked by target-band convergence",
    liquidityDecisions: candidate.legs.map(decisionRecord),
    excludedLiquidityLegs: candidate.excluded
  };
}

function noTrade(
  input: AdaptiveSolveInput,
  reason: NoTradeResult["reason"],
  details: string[],
  rejectedAlternatives: RejectedAlternative[] = [],
  excludedLiquidityLegs: ExcludedLiquidityLeg[] = []
): NoTradeResult {
  return {
    kind: "no-trade",
    stateId: input.state.stateId,
    reason,
    details,
    rejectedAlternatives,
    ...(excludedLiquidityLegs.length > 0 ? { excludedLiquidityLegs } : {})
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

function midpoint(minimum: bigint, maximum: bigint): bigint {
  return minimum + (maximum - minimum) / 2n;
}
