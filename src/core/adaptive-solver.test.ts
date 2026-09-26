import assert from "node:assert/strict";
import test from "node:test";
import { buildStaticBaseline } from "../../integrations/rwa-index/src/baseline.js";
import type { PortfolioState as RwaPortfolioState } from "../../integrations/rwa-index/src/math.js";
import { solveAdaptive, solveAdaptiveConfirmed, type AdaptiveSolveInput } from "./adaptive-solver.js";
import type { LiquidityCurve, LiquiditySample, LiquiditySnapshot } from "./liquidity.js";
import { WAD } from "./policy.js";
import type { PortfolioState, SimulationAdapter, SimulationResult, TokenAddress, VaultPolicy } from "./types.js";

const VAULT = "0x0000000000000000000000000000000000000010" as TokenAddress;
const BASE = "0x0000000000000000000000000000000000000001" as TokenAddress;
const A = "0x0000000000000000000000000000000000000002" as TokenAddress;
const B = "0x0000000000000000000000000000000000000003" as TokenAddress;
const POOL = "0x0000000000000000000000000000000000000004" as TokenAddress;
const u = (value: number) => BigInt(value) * WAD;
const p = (value: number) => BigInt(value) * WAD / 100n;

const passSimulator: SimulationAdapter = {
  async simulate(): Promise<SimulationResult> { return { passed: true }; }
};

function policy(overrides: Partial<VaultPolicy> = {}): VaultPolicy {
  return {
    baseAsset: BASE,
    assets: [
      { token: A, target: { min: p(40), max: p(50) }, maxWeight: p(70), enabled: true },
      { token: B, target: { min: p(40), max: p(50) }, maxWeight: p(70), enabled: true }
    ],
    cashTarget: { min: 0n, max: p(20) },
    driftTrigger: 0n,
    maxLegValue: u(10),
    maxNavLoss: p(2),
    slippageTolerance: p(2),
    maxPriceAge: 86_400n,
    paused: false,
    ...overrides
  };
}

function state(overrides: Partial<PortfolioState> = {}): PortfolioState {
  return {
    stateId: "state:1",
    blockNumber: 1n,
    blockTimestamp: 10_000n,
    nav: u(100),
    baseAssetBalance: u(10),
    baseAssetWeight: p(10),
    drift: p(10),
    positions: [
      { token: A, balance: u(60), value: u(60), weight: p(60) },
      { token: B, balance: u(30), value: u(30), weight: p(30) }
    ],
    ...overrides
  };
}

function sample(index: number, amount: bigint, expected = amount, overrides: Partial<LiquiditySample> = {}): LiquiditySample {
  const oracleOut = amount;
  const outputValue = expected;
  return {
    sampleIndex: index,
    amountIn: amount,
    expectedOut: expected,
    oracleOut,
    inputValue: amount,
    outputValue,
    effectiveValueRateWad: amount === 0n ? 0n : outputValue * WAD / amount,
    priceImpactWad: oracleOut > expected ? (oracleOut - expected) * WAD / oracleOut : 0n,
    feeRateWad: 100_000_000_000_000n,
    estimatedFeeValue: amount / 10_000n,
    quoteLossValue: amount > outputValue ? amount - outputValue : 0n,
    minOutCompatible: expected * 100n >= oracleOut * 98n,
    validity: { valid: true, stateId: "state:1", blockNumber: 1n, observedAt: 10_000n, expiresAt: 10_060n },
    ...overrides
  };
}

function curve(tokenIn: TokenAddress, tokenOut: TokenAddress, amounts: number[]): LiquidityCurve {
  const samples = amounts.map((amount, index) => sample(index, u(amount), u(amount) * 99n / 100n));
  return {
    id: `${tokenIn}:${tokenOut}`,
    venue: "test",
    pool: POOL,
    tokenIn,
    tokenOut,
    fee: 100,
    stateId: "state:1",
    blockNumber: 1n,
    observedAt: 10_000n,
    maximumTestedAmountIn: samples.at(-1)?.amountIn ?? 0n,
    maximumExecutableAmountIn: samples.at(-1)?.amountIn ?? 0n,
    samples
  };
}

function input(curves: LiquidityCurve[], stateOverrides: Partial<PortfolioState> = {}, policyOverrides: Partial<VaultPolicy> = {}): AdaptiveSolveInput {
  const currentState = state(stateOverrides);
  const liquidity: LiquiditySnapshot = {
    stateId: currentState.stateId,
    blockNumber: currentState.blockNumber,
    observedAt: currentState.blockTimestamp,
    curves
  };
  return {
    vault: VAULT,
    state: currentState,
    policy: policy(policyOverrides),
    prices: [
      { token: A, priceWad: WAD, updatedAt: 9_999n, source: "test" },
      { token: B, priceWad: WAD, updatedAt: 9_999n, source: "test" }
    ],
    liquidity,
    adaptivePolicy: { maxQuoteAge: 60n, maxSimulationAttempts: 4 }
  };
}

test("deeper liquidity permits a larger safe leg than thinner liquidity", async () => {
  const deep = await solveAdaptive(input([curve(BASE, B, [2, 4, 6, 8, 10])]), passSimulator);
  const thin = await solveAdaptive(input([curve(BASE, B, [2, 4])]), passSimulator);
  assert.equal(deep.kind, "plan");
  assert.equal(thin.kind, "plan");
  if (deep.kind === "plan" && thin.kind === "plan") assert.ok(deep.trades[0]!.amountIn > thin.trades[0]!.amountIn);
});

test("modeled thin liquidity reduces size before simulation failure", async () => {
  let calls = 0;
  const simulator: SimulationAdapter = { async simulate(trades) { calls += 1; assert.ok(trades[0]!.amountIn <= u(4)); return { passed: true }; } };
  const result = await solveAdaptive(input([curve(BASE, B, [2, 4])]), simulator);
  assert.equal(result.kind, "plan");
  assert.equal(calls, 1);
  if (result.kind === "plan") assert.equal(result.trades[0]!.amountIn, u(4));
});

test("adaptive sizing respects vault max leg and target distance", async () => {
  const result = await solveAdaptive(input([curve(BASE, B, [5, 10, 15, 20])], {}, { maxLegValue: u(7) }), passSimulator);
  assert.equal(result.kind, "plan");
  if (result.kind === "plan") assert.equal(result.trades[0]!.amountIn, u(5));

  const targetCapped = await solveAdaptive(input([curve(BASE, B, [5, 10, 15, 20])]), passSimulator);
  assert.equal(targetCapped.kind, "plan");
  if (targetCapped.kind === "plan") assert.equal(targetCapped.trades[0]!.amountIn, u(10));
});

test("sell balance and minimum cash buffer are preserved", async () => {
  const constrainedState: Partial<PortfolioState> = {
    baseAssetBalance: u(10),
    positions: [
      { token: A, balance: u(3), value: u(60), weight: p(60) },
      { token: B, balance: u(30), value: u(30), weight: p(30) }
    ]
  };
  const result = await solveAdaptive(input(
    [curve(A, BASE, [1, 2, 3, 4]), curve(BASE, B, [1, 2])],
    constrainedState,
    { minimumCashBuffer: u(10) }
  ), passSimulator);
  assert.equal(result.kind, "plan");
  if (result.kind === "plan") {
    const sell = result.trades.find(({ tokenIn }) => tokenIn === A);
    assert.ok(sell && sell.amountIn <= u(3));
    const worstCashAfter = u(10) + (sell?.minAmountOut ?? 0n) - (result.trades.find(({ tokenIn }) => tokenIn === BASE)?.amountIn ?? 0n);
    assert.ok(worstCashAfter >= u(10));
  }
});

test("expired or wrong-state liquidity fails closed", async () => {
  const expiredCurve = curve(BASE, B, [5]);
  expiredCurve.samples[0]!.validity.expiresAt = 9_999n;
  const expired = input([expiredCurve]);
  expired.liquidity.observedAt = 9_900n;
  const expiredResult = await solveAdaptive(expired, passSimulator);
  assert.equal(expiredResult.kind, "no-trade");
  if (expiredResult.kind === "no-trade") assert.equal(expiredResult.reason, "STALE_LIQUIDITY");

  const wrongState = input([curve(BASE, B, [5])]);
  wrongState.liquidity.stateId = "state:old";
  const wrongResult = await solveAdaptive(wrongState, passSimulator);
  assert.equal(wrongResult.kind, "no-trade");
  if (wrongResult.kind === "no-trade") assert.equal(wrongResult.reason, "STALE_LIQUIDITY");
});

test("deterministic quote curves produce deterministic plans with expected cost", async () => {
  const candidate = input([curve(BASE, B, [2, 4, 6])]);
  const first = await solveAdaptive(candidate, passSimulator);
  const second = await solveAdaptive(candidate, passSimulator);
  assert.deepEqual(first, second);
  assert.equal(first.kind, "plan");
  if (first.kind === "plan") assert.ok(first.expectedCost && first.expectedCost.quoteLossValue > 0n);
});

test("INSUFFICIENT_OUTPUT causes bounded curve-based rebuild", async () => {
  let calls = 0;
  const simulator: SimulationAdapter = {
    async simulate() {
      calls += 1;
      return calls === 1
        ? { passed: false, failureCode: "INSUFFICIENT_OUTPUT", reason: "depth moved" }
        : { passed: true };
    }
  };
  const result = await solveAdaptive(input([curve(BASE, B, [2, 4, 6, 8])]), simulator);
  assert.equal(result.kind, "plan");
  assert.equal(calls, 2);
  if (result.kind === "plan") {
    assert.equal(result.rejectedAlternatives.length, 1);
    assert.equal(result.trades[0]!.amountIn, u(6));
  }
});

test("no executable depth returns typed no-trade", async () => {
  const result = await solveAdaptive(input([]), passSimulator);
  assert.equal(result.kind, "no-trade");
  if (result.kind === "no-trade") assert.equal(result.reason, "NO_SAFE_LIQUIDITY");
});

test("stale prices retain precedence over liquidity", async () => {
  const candidate = input([curve(BASE, B, [5])]);
  candidate.policy.maxPriceAge = 10n;
  candidate.prices[0] = { ...candidate.prices[0]!, updatedAt: 0n };
  const result = await solveAdaptive(candidate, passSimulator);
  assert.equal(result.kind, "no-trade");
  if (result.kind === "no-trade") assert.equal(result.reason, "STALE_PRICE");
});

test("confirmed adaptive solve re-reads state and never carries a plan", async () => {
  let reads = 0;
  const reader = async () => {
    reads += 1;
    return reads === 1
      ? input([curve(BASE, B, [5])])
      : input([], { stateId: "state:2", blockNumber: 2n, drift: 0n }, { driftTrigger: p(5) });
  };
  const first = await solveAdaptiveConfirmed(reader, passSimulator);
  const second = await solveAdaptiveConfirmed(reader, passSimulator);
  assert.equal(reads, 2);
  assert.equal(first.kind, "plan");
  assert.equal(second.kind, "no-trade");
  assert.equal(second.stateId, "state:2");
});

test("M2 static baseline output remains unchanged and depth-independent", () => {
  const rwaState: RwaPortfolioState = {
    blockNumber: 1n,
    nav: u(100),
    drift: p(10),
    cash: u(10),
    cashTarget: p(10),
    assets: [
      { address: A, symbol: "A", balance: u(60), price: WAD, updatedAt: 1n, value: u(60), weight: p(60), targetWeight: p(50) },
      { address: B, symbol: "B", balance: u(30), price: WAD, updatedAt: 1n, value: u(30), weight: p(30), targetWeight: p(40) }
    ]
  };
  const trades = buildStaticBaseline(rwaState, BASE, { maxTradeFraction: p(10), slippageTolerance: p(2) });
  assert.deepEqual(trades, [
    { tokenIn: A, tokenOut: BASE, amountIn: u(10), minAmountOut: u(98) / 10n },
    { tokenIn: BASE, tokenOut: B, amountIn: u(10), minAmountOut: u(98) / 10n }
  ]);
});
