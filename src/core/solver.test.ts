import assert from "node:assert/strict";
import test from "node:test";
import { classifyWeight, WAD } from "./policy.js";
import { solve, solveConfirmedState } from "./solver.js";
import type {
  PortfolioState,
  SimulationAdapter,
  SimulationResult,
  SolveInput,
  TokenAddress,
  VaultPolicy
} from "./types.js";

const VAULT = "0x0000000000000000000000000000000000000010" as TokenAddress;
const BASE = "0x0000000000000000000000000000000000000001" as TokenAddress;
const A = "0x0000000000000000000000000000000000000002" as TokenAddress;
const B = "0x0000000000000000000000000000000000000003" as TokenAddress;
const u = (value: number) => BigInt(value) * WAD;
const p = (value: number) => BigInt(value) * WAD / 100n;

const passSimulator: SimulationAdapter = {
  async simulate(): Promise<SimulationResult> {
    return { passed: true };
  }
};

function policy(overrides: Partial<VaultPolicy> = {}): VaultPolicy {
  return {
    baseAsset: BASE,
    assets: [
      { token: A, target: { min: p(40), max: p(50) }, maxWeight: p(70), enabled: true },
      { token: B, target: { min: p(40), max: p(50) }, maxWeight: p(70), enabled: true }
    ],
    cashTarget: { min: 0n, max: p(20) },
    driftTrigger: p(5),
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
    stateId: "block:1",
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

function input(stateOverrides: Partial<PortfolioState> = {}, policyOverrides: Partial<VaultPolicy> = {}): SolveInput {
  return {
    vault: VAULT,
    state: state(stateOverrides),
    policy: policy(policyOverrides),
    prices: [
      { token: A, priceWad: WAD, updatedAt: 9_999n, source: "test" },
      { token: B, priceWad: WAD, updatedAt: 9_999n, source: "test" }
    ]
  };
}

test("classifies weights against target ranges", () => {
  const range = { min: p(40), max: p(50) };
  assert.equal(classifyWeight(p(39), range), "BELOW_RANGE");
  assert.equal(classifyWeight(p(45), range), "IN_RANGE");
  assert.equal(classifyWeight(p(51), range), "ABOVE_RANGE");
});

test("does not trade an in-range asset without a higher-priority reason", async () => {
  const result = await solve(input({
    baseAssetBalance: u(20),
    baseAssetWeight: p(20),
    positions: [
      { token: A, balance: u(45), value: u(45), weight: p(45) },
      { token: B, balance: u(35), value: u(35), weight: p(35) }
    ]
  }, { cashTarget: { min: p(5), max: p(15) } }), passSimulator);
  assert.equal(result.kind, "plan");
  if (result.kind === "plan") assert.ok(result.trades.every(({ tokenIn, tokenOut }) => tokenIn !== A && tokenOut !== A));
});

test("rejects an impossible target policy before simulation", async () => {
  let simulationCalls = 0;
  const simulator: SimulationAdapter = { async simulate() { simulationCalls += 1; return { passed: true }; } };
  const bad = policy({
    assets: [
      { token: A, target: { min: p(60), max: p(70) }, maxWeight: p(70), enabled: true },
      { token: B, target: { min: p(60), max: p(70) }, maxWeight: p(70), enabled: true }
    ]
  });
  const result = await solve({ ...input(), policy: bad }, simulator);
  assert.equal(result.kind, "no-trade");
  if (result.kind === "no-trade") assert.equal(result.reason, "INVALID_POLICY");
  assert.equal(simulationCalls, 0);
});

test("stale price takes precedence over a low drift outcome", async () => {
  const staleInput = input({ drift: 0n }, { maxPriceAge: 100n });
  staleInput.prices[0] = { ...staleInput.prices[0]!, updatedAt: 0n };
  const result = await solve(staleInput, passSimulator);
  assert.equal(result.kind, "no-trade");
  if (result.kind === "no-trade") assert.equal(result.reason, "STALE_PRICE");
});

test("produces deterministic overweight-to-underweight USDC-hub trades", async () => {
  const first = await solve(input(), passSimulator);
  const second = await solve(input(), passSimulator);
  assert.deepEqual(first, second);
  assert.equal(first.kind, "plan");
  if (first.kind === "plan") {
    assert.equal(first.trades[0]?.tokenIn, A);
    assert.equal(first.trades[0]?.tokenOut, BASE);
    assert.equal(first.trades[1]?.tokenIn, BASE);
    assert.equal(first.trades[1]?.tokenOut, B);
    assert.equal(first.simulation.passed, true);
  }
});

test("returns NO_FEASIBLE_PLAN when rounding and cash policy prevent a nonzero trade", async () => {
  const tiny = input({
    nav: 100n,
    baseAssetBalance: 1n,
    baseAssetWeight: p(1),
    drift: p(1),
    positions: [
      { token: A, balance: 49n, value: 49n, weight: p(49) },
      { token: B, balance: 50n, value: 50n, weight: p(50) }
    ]
  }, {
    driftTrigger: 0n,
    maxLegValue: 10n,
    cashTarget: { min: 0n, max: p(1) },
    assets: [
      { token: A, target: { min: p(50), max: p(50) }, maxWeight: p(60), enabled: true },
      { token: B, target: { min: p(49), max: p(50) }, maxWeight: p(60), enabled: true }
    ]
  });
  tiny.prices[0] = { ...tiny.prices[0]!, priceWad: 1_000n * WAD };
  const result = await solve(tiny, passSimulator);
  assert.equal(result.kind, "no-trade");
  if (result.kind === "no-trade") assert.equal(result.reason, "NO_FEASIBLE_PLAN");
});

test("never marks a simulation rejection executable", async () => {
  const simulator: SimulationAdapter = {
    async simulate() { return { passed: false, failureCode: "INSUFFICIENT_OUTPUT", reason: "adapter output below minOut" }; }
  };
  const result = await solve(input(), simulator);
  assert.equal(result.kind, "no-trade");
  if (result.kind === "no-trade") {
    assert.equal(result.reason, "SIMULATION_REJECTED");
    assert.equal(result.rejectedAlternatives.length, 1);
  }
});

test("uses deterministic basic backoff only for eligible constraint failures", async () => {
  let calls = 0;
  const simulator: SimulationAdapter = {
    async simulate() {
      calls += 1;
      return calls === 1
        ? { passed: false, failureCode: "TRADE_TOO_LARGE", reason: "cap" }
        : { passed: true };
    }
  };
  const result = await solve(input(), simulator);
  assert.equal(result.kind, "plan");
  if (result.kind === "plan") {
    assert.equal(result.rejectedAlternatives.length, 1);
    assert.equal(result.trades[0]?.amountIn, u(5));
  }
});

test("re-reads confirmed input on every solve and never advances expected state internally", async () => {
  let reads = 0;
  const reader = async () => {
    reads += 1;
    return reads === 1 ? input() : input({ stateId: "block:2", blockNumber: 2n, drift: p(4) });
  };
  const first = await solveConfirmedState(reader, passSimulator);
  const second = await solveConfirmedState(reader, passSimulator);
  assert.equal(reads, 2);
  assert.equal(first.stateId, "block:1");
  assert.equal(second.stateId, "block:2");
  assert.equal(second.kind, "no-trade");
  if (second.kind === "no-trade") assert.equal(second.reason, "DRIFT_BELOW_TRIGGER");
});
