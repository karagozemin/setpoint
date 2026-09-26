import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AdaptiveSolveInput } from "./adaptive-solver.js";
import { solveBatchAdaptive } from "./batch-solver.js";
import { isRecoverableSimulationFailure, solveHybrid, solveHybridConfirmed, type HybridSolveInput } from "./hybrid-solver.js";
import type { LiquidityCurve, LiquiditySample } from "./liquidity.js";
import { WAD } from "./policy.js";
import type { RebalancePlan, SimulationAdapter, SimulationResult, TokenAddress, Trade } from "./types.js";

const VAULT = "0x0000000000000000000000000000000000000010" as TokenAddress;
const BASE = "0x0000000000000000000000000000000000000001" as TokenAddress;
const A = "0x0000000000000000000000000000000000000002" as TokenAddress;
const B = "0x0000000000000000000000000000000000000003" as TokenAddress;
const POOL = "0x0000000000000000000000000000000000000004" as TokenAddress;
const u = (value: number) => BigInt(value) * WAD;
const p = (value: number) => BigInt(value) * WAD / 100n;

const fastTrades: Trade[] = [
  { tokenIn: A, tokenOut: BASE, amountIn: u(20), minAmountOut: u(196) / 10n },
  { tokenIn: BASE, tokenOut: B, amountIn: u(20), minAmountOut: u(196) / 10n }
];

function quote(index: number, amountIn: bigint): LiquiditySample {
  const expectedOut = amountIn * 99n / 100n;
  return {
    sampleIndex: index,
    amountIn,
    expectedOut,
    oracleOut: amountIn,
    inputValue: amountIn,
    outputValue: expectedOut,
    effectiveValueRateWad: expectedOut * WAD / amountIn,
    priceImpactWad: p(1),
    feeRateWad: p(1) / 100n,
    estimatedFeeValue: amountIn / 10_000n,
    quoteLossValue: amountIn - expectedOut,
    minOutCompatible: true,
    validity: { valid: true, stateId: "state:hybrid", blockNumber: 10n, observedAt: 10_000n, expiresAt: 10_060n }
  };
}

function curve(tokenIn: TokenAddress, tokenOut: TokenAddress): LiquidityCurve {
  const samples = [quote(0, u(10)), quote(1, u(20))];
  return {
    id: `${tokenIn}:${tokenOut}`,
    venue: "test",
    pool: POOL,
    tokenIn,
    tokenOut,
    fee: 100,
    stateId: "state:hybrid",
    blockNumber: 10n,
    observedAt: 10_000n,
    maximumTestedAmountIn: u(20),
    maximumExecutableAmountIn: u(20),
    samples
  };
}

function input(overrides: Partial<HybridSolveInput> = {}): HybridSolveInput {
  return {
    vault: VAULT,
    state: {
      stateId: "state:hybrid",
      blockNumber: 10n,
      blockTimestamp: 10_000n,
      nav: u(100),
      baseAssetBalance: u(20),
      baseAssetWeight: p(20),
      drift: p(20),
      positions: [
        { token: A, balance: u(60), value: u(60), weight: p(60) },
        { token: B, balance: u(20), value: u(20), weight: p(20) }
      ]
    },
    policy: {
      baseAsset: BASE,
      assets: [A, B].map((token) => ({ token, target: { min: p(35), max: p(45) }, maxWeight: p(80), enabled: true })),
      cashTarget: { min: p(15), max: p(25) },
      driftTrigger: 0n,
      maxLegValue: u(25),
      maxNavLoss: p(2),
      slippageTolerance: p(2),
      maxPriceAge: 100n,
      paused: false
    },
    prices: [A, B].map((token) => ({ token, priceWad: WAD, updatedAt: 9_999n, source: "test" })),
    liquidity: {
      stateId: "state:hybrid",
      blockNumber: 10n,
      observedAt: 10_000n,
      curves: [curve(A, BASE), curve(BASE, B)]
    },
    adaptivePolicy: { maxQuoteAge: 60n, maxSimulationAttempts: 3, maxPriceImpact: p(2) },
    fastPathTrades: fastTrades,
    ...overrides
  };
}

const pass: SimulationAdapter = { async simulate(): Promise<SimulationResult> { return { passed: true }; } };

function fallbackPlan(candidate: AdaptiveSolveInput): RebalancePlan {
  return {
    kind: "plan",
    vault: candidate.vault,
    stateId: candidate.state.stateId,
    blockNumber: candidate.state.blockNumber,
    trades: [fastTrades[0]!],
    expectedDriftBefore: p(10),
    expectedDriftAfter: p(5),
    expectedTurnover: u(20),
    expectedCost: null,
    activeConstraints: [],
    rejectedAlternatives: [],
    simulation: { passed: true },
    reason: "test fallback"
  };
}

test("passing fast path does not invoke adaptive solver", async () => {
  let adaptiveCalls = 0;
  const result = await solveHybrid(input(), pass, async (candidate) => { adaptiveCalls += 1; return fallbackPlan(candidate); });
  assert.equal(result.kind, "plan");
  assert.equal(result.mode, "FAST_PATH");
  assert.equal(result.fallbackInvoked, false);
  assert.equal(adaptiveCalls, 0);
});

test("recoverable fast-path failure invokes adaptive fallback", async () => {
  let simulations = 0;
  const simulator: SimulationAdapter = { async simulate() { simulations += 1; return { passed: false, failureCode: "INSUFFICIENT_OUTPUT" }; } };
  const result = await solveHybrid(input(), simulator, async (candidate) => fallbackPlan(candidate));
  assert.equal(result.kind, "plan");
  assert.equal(result.mode, "ADAPTIVE_FALLBACK");
  assert.equal(result.fallbackTriggerReason, "INSUFFICIENT_OUTPUT");
});

test("recoverable simulation failure mapping is explicit", () => {
  for (const code of ["INSUFFICIENT_OUTPUT", "TRADE_TOO_LARGE", "INSUFFICIENT_BALANCE", "DRIFT_NOT_IMPROVED", "EXCESSIVE_VALUE_LOSS"] as const) {
    assert.equal(isRecoverableSimulationFailure(code), true, code);
  }
  for (const code of ["STALE_PRICE", "SLIPPAGE_TOO_LOOSE", "UNAUTHORIZED", "UNSUPPORTED_ASSET", "UNKNOWN_REVERT"] as const) {
    assert.equal(isRecoverableSimulationFailure(code), false, code);
  }
});

test("stale price never invokes adaptive fallback", async () => {
  let calls = 0;
  const candidate = input();
  candidate.prices = candidate.prices.map((price) => ({ ...price, updatedAt: 1n }));
  const result = await solveHybrid(candidate, pass, async (adaptive) => { calls += 1; return fallbackPlan(adaptive); });
  assert.equal(result.mode, "NO_TRADE");
  assert.equal(result.reason, "STALE_PRICE");
  assert.equal(calls, 0);
});

test("invalid policy never invokes fallback", async () => {
  let calls = 0;
  const candidate = input();
  candidate.policy = { ...candidate.policy, maxLegValue: 0n };
  const result = await solveHybrid(candidate, pass, async (adaptive) => { calls += 1; return fallbackPlan(adaptive); });
  assert.equal(result.mode, "NO_TRADE");
  assert.equal(result.reason, "INVALID_POLICY");
  assert.equal(calls, 0);
});

test("fast path remains simulation-gated", async () => {
  const result = await solveHybrid(input(), { async simulate() { return { passed: false, failureCode: "UNAUTHORIZED" }; } });
  assert.equal(result.kind, "no-trade");
  assert.equal(result.mode, "NO_TRADE");
  assert.equal(result.fallbackInvoked, false);
});

test("adaptive fallback remains simulation-gated", async () => {
  let simulations = 0;
  const simulator: SimulationAdapter = {
    async simulate() {
      simulations += 1;
      return simulations === 1
        ? { passed: false, failureCode: "INSUFFICIENT_OUTPUT" }
        : { passed: false, failureCode: "UNAUTHORIZED" };
    }
  };
  const result = await solveHybrid(input(), simulator, solveBatchAdaptive);
  assert.equal(result.kind, "no-trade");
  assert.equal(result.mode, "NO_TRADE");
  assert.equal(result.fallbackInvoked, true);
});

test("selected mode and reason are persisted deterministically", async () => {
  const result = await solveHybrid(input(), pass);
  assert.equal(result.mode, "FAST_PATH");
  assert.equal(result.modeSelectionReason, "FAST_PATH_PREFLIGHT_AND_SIMULATION_PASSED");
  assert.equal(result.fastPath.simulation?.passed, true);
});

test("confirmed input is re-read after fast-path execution", async () => {
  let reads = 0;
  const reader = async () => { reads += 1; return input(); };
  await solveHybridConfirmed(reader, pass);
  await solveHybridConfirmed(reader, pass);
  assert.equal(reads, 2);
});

test("confirmed input is re-read after fallback execution", async () => {
  let reads = 0;
  let simulations = 0;
  const reader = async () => { reads += 1; return input(); };
  const simulator: SimulationAdapter = { async simulate() { simulations += 1; return simulations % 2 === 1 ? { passed: false, failureCode: "INSUFFICIENT_OUTPUT" } : { passed: true }; } };
  await solveHybridConfirmed(reader, simulator, solveBatchAdaptive);
  await solveHybridConfirmed(reader, simulator, solveBatchAdaptive);
  assert.equal(reads, 2);
});

test("a later confirmed cycle can choose a different mode", async () => {
  const fallback = await solveHybrid(input(), { async simulate() { return { passed: false, failureCode: "INSUFFICIENT_OUTPUT" }; } }, async (candidate) => fallbackPlan(candidate));
  const fast = await solveHybrid(input(), pass);
  assert.equal(fallback.mode, "ADAPTIVE_FALLBACK");
  assert.equal(fast.mode, "FAST_PATH");
});

test("failed fast-path trades are never returned for execution before fallback", async () => {
  const result = await solveHybrid(input(), { async simulate() { return { passed: false, failureCode: "INSUFFICIENT_OUTPUT" }; } }, async (candidate) => fallbackPlan(candidate));
  assert.equal(result.kind, "plan");
  if (result.kind === "plan") {
    assert.equal(result.mode, "ADAPTIVE_FALLBACK");
    assert.deepEqual(result.trades, [fastTrades[0]]);
    assert.deepEqual(result.fastPath.trades, fastTrades);
  }
});

test("M2 planner source hash remains unchanged", () => {
  const hash = createHash("sha256").update(readFileSync("integrations/rwa-index/src/baseline.ts")).digest("hex");
  assert.equal(hash, "dcd079ed25ff6fd7683c947fbf46748abd70862fe2a85a368c919b26fe7cee92");
});

test("identical confirmed state gives an identical hybrid result", async () => {
  assert.deepEqual(await solveHybrid(input(), pass), await solveHybrid(input(), pass));
});

test("no safe fast path and no safe adaptive progress returns typed no-trade", async () => {
  const result = await solveHybrid(
    input(),
    { async simulate() { return { passed: false, failureCode: "INSUFFICIENT_OUTPUT" }; } },
    async (candidate) => ({ kind: "no-trade", stateId: candidate.state.stateId, reason: "NO_SAFE_LIQUIDITY", details: ["none"], rejectedAlternatives: [] })
  );
  assert.equal(result.kind, "no-trade");
  assert.equal(result.mode, "NO_TRADE");
  assert.equal(result.fallbackInvoked, true);
  assert.equal(result.reason, "NO_SAFE_LIQUIDITY");
});

test("recoverable preflight liquidity gap invokes fallback after fast simulation", async () => {
  let simulated = 0;
  const candidate = input();
  candidate.liquidity = { ...candidate.liquidity, curves: [curve(A, BASE)] };
  const result = await solveHybrid(candidate, { async simulate() { simulated += 1; return { passed: true }; } }, async (adaptive) => fallbackPlan(adaptive));
  assert.equal(simulated, 1);
  assert.equal(result.mode, "ADAPTIVE_FALLBACK");
  assert.equal(result.fallbackTriggerReason, "MISSING_LIQUIDITY_CURVE");
});
