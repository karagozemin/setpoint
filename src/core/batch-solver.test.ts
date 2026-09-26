import assert from "node:assert/strict";
import test from "node:test";
import type { AdaptiveSolveInput } from "./adaptive-solver.js";
import { solveBatchAdaptive, solveBatchConfirmed } from "./batch-solver.js";
import type { LiquidityCurve, LiquiditySample } from "./liquidity.js";
import { WAD } from "./policy.js";
import type { PortfolioState, SimulationAdapter, SimulationResult, TokenAddress, VaultPolicy } from "./types.js";

const VAULT = "0x0000000000000000000000000000000000000010" as TokenAddress;
const BASE = "0x0000000000000000000000000000000000000001" as TokenAddress;
const A = "0x0000000000000000000000000000000000000002" as TokenAddress;
const B = "0x0000000000000000000000000000000000000003" as TokenAddress;
const C = "0x0000000000000000000000000000000000000004" as TokenAddress;
const D = "0x0000000000000000000000000000000000000005" as TokenAddress;
const POOL = "0x0000000000000000000000000000000000000006" as TokenAddress;
const u = (value: number) => BigInt(value) * WAD;
const p = (value: number) => BigInt(value) * WAD / 100n;

const passSimulator: SimulationAdapter = {
  async simulate(): Promise<SimulationResult> { return { passed: true }; }
};

function policy(overrides: Partial<VaultPolicy> = {}): VaultPolicy {
  return {
    baseAsset: BASE,
    assets: [A, B, C, D].map((token) => ({ token, target: { min: p(15), max: p(25) }, maxWeight: p(40), enabled: true })),
    cashTarget: { min: 0n, max: p(40) },
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
    stateId: "state:batch",
    blockNumber: 10n,
    blockTimestamp: 10_000n,
    nav: u(100),
    baseAssetBalance: u(20),
    baseAssetWeight: p(20),
    drift: p(10),
    positions: [
      { token: A, balance: u(30), value: u(30), weight: p(30) },
      { token: B, balance: u(30), value: u(30), weight: p(30) },
      { token: C, balance: u(10), value: u(10), weight: p(10) },
      { token: D, balance: u(10), value: u(10), weight: p(10) }
    ],
    ...overrides
  };
}

function sample(index: number, amount: bigint, compatible = true): LiquiditySample {
  const expected = compatible ? amount * 99n / 100n : amount * 97n / 100n;
  return {
    sampleIndex: index,
    amountIn: amount,
    expectedOut: expected,
    oracleOut: amount,
    inputValue: amount,
    outputValue: expected,
    effectiveValueRateWad: expected * WAD / amount,
    priceImpactWad: (amount - expected) * WAD / amount,
    feeRateWad: 100_000_000_000_000n,
    estimatedFeeValue: amount / 10_000n,
    quoteLossValue: amount - expected,
    minOutCompatible: compatible,
    validity: { valid: true, stateId: "state:batch", blockNumber: 10n, observedAt: 10_000n, expiresAt: 10_060n }
  };
}

function curve(tokenIn: TokenAddress, tokenOut: TokenAddress, amounts = [2, 5], compatible = true): LiquidityCurve {
  const samples = amounts.map((amount, index) => sample(index, u(amount), compatible));
  return {
    id: `${tokenIn}:${tokenOut}`,
    venue: "test",
    pool: POOL,
    tokenIn,
    tokenOut,
    fee: 100,
    stateId: "state:batch",
    blockNumber: 10n,
    observedAt: 10_000n,
    maximumTestedAmountIn: samples.at(-1)?.amountIn ?? 0n,
    maximumExecutableAmountIn: compatible ? samples.at(-1)?.amountIn ?? 0n : 0n,
    samples
  };
}

function allCurves(overrides: LiquidityCurve[] = []): LiquidityCurve[] {
  const byPair = new Map([
    curve(A, BASE), curve(B, BASE), curve(BASE, C), curve(BASE, D), ...overrides
  ].map((item) => [`${item.tokenIn}:${item.tokenOut}`, item]));
  return [...byPair.values()];
}

function input(curves = allCurves(), stateOverrides: Partial<PortfolioState> = {}, policyOverrides: Partial<VaultPolicy> = {}): AdaptiveSolveInput {
  const current = state(stateOverrides);
  return {
    vault: VAULT,
    state: current,
    policy: policy(policyOverrides),
    prices: [A, B, C, D].map((token) => ({ token, priceWad: WAD, updatedAt: 9_999n, source: "test" })),
    liquidity: { stateId: current.stateId, blockNumber: current.blockNumber, observedAt: current.blockTimestamp, curves },
    adaptivePolicy: { maxQuoteAge: 60n, maxSimulationAttempts: 5, maxPriceImpact: p(2) }
  };
}

test("constructs one coherent batch with multiple sells and buys", async () => {
  const result = await solveBatchAdaptive(input(), passSimulator);
  assert.equal(result.kind, "plan");
  if (result.kind === "plan") {
    assert.equal(result.trades.filter(({ tokenOut }) => tokenOut === BASE).length, 2);
    assert.equal(result.trades.filter(({ tokenIn }) => tokenIn === BASE).length, 2);
    assert.ok(result.expectedDriftAfter < result.expectedDriftBefore);
    assert.equal(result.simulation.passed, true);
  }
});

test("conservative sell proceeds fund buys and preserve batch cash reserve", async () => {
  const result = await solveBatchAdaptive(input(
    allCurves([curve(BASE, C, [2, 4]), curve(BASE, D, [2, 4])]),
    {},
    { cashTarget: { min: p(20), max: p(40) }, minimumCashBuffer: u(20) }
  ), passSimulator);
  assert.equal(result.kind, "plan");
  if (result.kind === "plan") {
    const guaranteedSells = result.trades.filter(({ tokenOut }) => tokenOut === BASE).reduce((sum, trade) => sum + trade.minAmountOut, 0n);
    const buys = result.trades.filter(({ tokenIn }) => tokenIn === BASE).reduce((sum, trade) => sum + trade.amountIn, 0n);
    assert.ok(u(20) + guaranteedSells - buys >= u(20));
    assert.ok(guaranteedSells > 0n && buys > 0n);
  }
});

test("never overspends an input balance and respects independent liquidity limits", async () => {
  const constrained = state({
    positions: [
      { token: A, balance: u(3), value: u(30), weight: p(30) },
      { token: B, balance: u(30), value: u(30), weight: p(30) },
      { token: C, balance: u(10), value: u(10), weight: p(10) },
      { token: D, balance: u(10), value: u(10), weight: p(10) }
    ]
  });
  const result = await solveBatchAdaptive(input(allCurves(), constrained), passSimulator);
  assert.equal(result.kind, "plan");
  if (result.kind === "plan") {
    const aSell = result.trades.find(({ tokenIn }) => tokenIn === A);
    assert.ok(aSell && aSell.amountIn <= u(3));
    for (const decision of result.liquidityDecisions ?? []) {
      assert.ok(decision.amountIn <= (decision.maximumSafeAmountIn ?? 0n));
      assert.ok(decision.bindingConstraint);
    }
  }
});

test("removes one unavailable buy without discarding unrelated safe legs", async () => {
  const result = await solveBatchAdaptive(input(allCurves([curve(BASE, C, [2, 5], false)])), passSimulator);
  assert.equal(result.kind, "plan");
  if (result.kind === "plan") {
    assert.ok(result.trades.some(({ tokenOut }) => tokenOut === D));
    assert.ok(!result.trades.some(({ tokenOut }) => tokenOut === C));
    assert.ok(result.trades.some(({ tokenIn }) => tokenIn === A || tokenIn === B));
    assert.ok(result.excludedLiquidityLegs?.some(({ tokenOut, reason }) => tokenOut === C && reason === "NO_MINOUT_COMPATIBLE_SAMPLE"));
  }
});

test("INSUFFICIENT_OUTPUT selectively backs off one binding leg", async () => {
  const attempts: Array<readonly { tokenIn: TokenAddress; tokenOut: TokenAddress; amountIn: bigint }[]> = [];
  const simulator: SimulationAdapter = {
    async simulate(trades) {
      attempts.push(trades.map(({ tokenIn, tokenOut, amountIn }) => ({ tokenIn, tokenOut, amountIn })));
      return attempts.length === 1
        ? { passed: false, failureCode: "INSUFFICIENT_OUTPUT", reason: "binding leg" }
        : { passed: true };
    }
  };
  const result = await solveBatchAdaptive(input(), simulator);
  assert.equal(result.kind, "plan");
  assert.equal(attempts.length, 2);
  if (result.kind === "plan") {
    assert.equal(result.rejectedAlternatives.length, 1);
    const first = attempts[0]!;
    const second = attempts[1]!;
    const unchanged = first.filter((trade) => second.some((next) => next.tokenIn === trade.tokenIn && next.tokenOut === trade.tokenOut && next.amountIn === trade.amountIn));
    assert.ok(unchanged.length >= 2, "independent legs should survive selective backoff");
    assert.ok(second.some((trade) => first.some((prior) => prior.tokenIn === trade.tokenIn && prior.tokenOut === trade.tokenOut && trade.amountIn < prior.amountIn)));
  }
});

test("batch construction is deterministic for equivalent input", async () => {
  const first = await solveBatchAdaptive(input(), passSimulator);
  const second = await solveBatchAdaptive(input(), passSimulator);
  assert.deepEqual(first, second);
  if (first.kind === "plan" && second.kind === "plan") assert.deepEqual(first.trades, second.trades);
});

test("stale liquidity invalidates the whole batch before simulation", async () => {
  let calls = 0;
  const simulator: SimulationAdapter = { async simulate() { calls += 1; return { passed: true }; } };
  const candidate = input();
  candidate.liquidity.stateId = "old-state";
  const result = await solveBatchAdaptive(candidate, simulator);
  assert.equal(result.kind, "no-trade");
  if (result.kind === "no-trade") assert.equal(result.reason, "STALE_LIQUIDITY");
  assert.equal(calls, 0);
});

test("simulation gate is mandatory and non-liquidity rejection is never executable", async () => {
  const result = await solveBatchAdaptive(input(), {
    async simulate() { return { passed: false, failureCode: "EXCESSIVE_VALUE_LOSS", reason: "NAV floor" }; }
  });
  assert.equal(result.kind, "no-trade");
  if (result.kind === "no-trade") assert.equal(result.reason, "SIMULATION_REJECTED");
});

test("confirmed batch solver re-reads state for every solve", async () => {
  let reads = 0;
  const reader = async () => {
    reads += 1;
    return reads === 1
      ? input()
      : input([], { stateId: "state:next", blockNumber: 11n, drift: 0n }, { driftTrigger: p(5) });
  };
  const first = await solveBatchConfirmed(reader, passSimulator);
  const second = await solveBatchConfirmed(reader, passSimulator);
  assert.equal(reads, 2);
  assert.equal(first.kind, "plan");
  assert.equal(second.kind, "no-trade");
  assert.equal(second.stateId, "state:next");
});
