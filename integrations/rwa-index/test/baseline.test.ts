import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";
import {
  allocationDeltas,
  buildStaticBaseline,
  classifyRevert,
  minimumOutput,
  staleTokens,
  tradeNotional
} from "../src/baseline.js";
import { WAD, type AssetState, type PortfolioState } from "../src/math.js";

const BASE = "0x0000000000000000000000000000000000000001" as Address;
const A = "0x0000000000000000000000000000000000000002" as Address;
const B = "0x0000000000000000000000000000000000000003" as Address;

function asset(address: Address, value: bigint, targetWeight: bigint, price = WAD): AssetState {
  return {
    address,
    symbol: address === A ? "A" : "B",
    balance: value,
    price,
    updatedAt: 1_000n,
    value,
    weight: value,
    targetWeight
  };
}

function state(aValue = 70n * WAD, bValue = 30n * WAD): PortfolioState {
  return {
    blockNumber: 1n,
    nav: 100n * WAD,
    drift: 20n * WAD / 100n,
    cash: 0n,
    cashTarget: 0n,
    assets: [asset(A, aValue, WAD / 2n), asset(B, bValue, WAD / 2n)]
  };
}

const constraints = { maxTradeFraction: WAD / 10n, slippageTolerance: WAD / 50n };

test("detects overweight and underweight assets", () => {
  assert.deepEqual(allocationDeltas(state()).map(({ direction }) => direction), ["overweight", "underweight"]);
});

test("caps every static leg at maxTradeFraction of NAV", () => {
  const plan = buildStaticBaseline(state(), BASE, constraints);
  const cap = 10n * WAD;
  assert.ok(plan.length > 2);
  for (const trade of plan) assert.ok(tradeNotional(trade, state(), BASE) <= cap);
});

test("calculates the vault-consistent minimum output", () => {
  assert.equal(minimumOutput(100n * WAD, WAD / 50n), 98n * WAD);
});

test("emits every sell before every buy", () => {
  const plan = buildStaticBaseline(state(), BASE, constraints);
  const firstBuy = plan.findIndex(({ tokenIn }) => tokenIn === BASE);
  assert.ok(firstBuy > 0);
  assert.ok(plan.slice(0, firstBuy).every(({ tokenOut }) => tokenOut === BASE));
  assert.ok(plan.slice(firstBuy).every(({ tokenIn }) => tokenIn === BASE));
});

test("is deterministic for identical input", () => {
  assert.deepEqual(buildStaticBaseline(state(), BASE, constraints), buildStaticBaseline(state(), BASE, constraints));
});

test("recomputed state produces a new plan instead of reusing old trades", () => {
  const first = buildStaticBaseline(state(), BASE, constraints);
  const confirmedNextState = state(55n * WAD, 45n * WAD);
  const second = buildStaticBaseline(confirmedNextState, BASE, constraints);
  assert.notDeepEqual(second, first);
  assert.ok(second.length < first.length);
});

test("classifies vault and adapter revert reasons", () => {
  assert.equal(classifyRevert("Error: StalePrice(address token)"), "STALE_ORACLE");
  assert.equal(classifyRevert("Error: TradeTooLarge()"), "TRADE_TOO_LARGE");
  assert.equal(classifyRevert("Error: InsufficientOutput()"), "INSUFFICIENT_OUTPUT");
  assert.equal(classifyRevert("Error: ERC20InsufficientBalance(address,uint256,uint256)"), "INSUFFICIENT_BALANCE");
  assert.equal(classifyRevert("execution reverted"), "UNKNOWN_REVERT");
});

test("detects prices older than the configured cutoff", () => {
  const stale = staleTokens([
    { token: A, updatedAt: 100n },
    { token: B, updatedAt: 950n }
  ], 1_000n, 100n);
  assert.deepEqual(stale, [A]);
});
