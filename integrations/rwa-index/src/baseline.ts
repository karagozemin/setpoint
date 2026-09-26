import type { Address } from "viem";
import { WAD, type AssetState, type PortfolioState, type Trade } from "./math.js";

export interface BaselineConstraints {
  maxTradeFraction: bigint;
  slippageTolerance: bigint;
}

export interface AllocationDelta {
  asset: AssetState;
  targetValue: bigint;
  deltaValue: bigint;
  direction: "overweight" | "underweight" | "at-target";
}

export interface PriceAge {
  token: Address;
  updatedAt: bigint;
}

export type RevertClass =
  | "STALE_ORACLE"
  | "TRADE_TOO_LARGE"
  | "SLIPPAGE_TOO_LOOSE"
  | "INSUFFICIENT_OUTPUT"
  | "INSUFFICIENT_BALANCE"
  | "DRIFT_NOT_IMPROVED"
  | "EXCESSIVE_VALUE_LOSS"
  | "UNAUTHORIZED"
  | "INVALID_ASSET"
  | "UNKNOWN_REVERT";

export function allocationDeltas(state: PortfolioState): AllocationDelta[] {
  return state.assets.map((asset) => {
    const targetValue = (state.nav * asset.targetWeight) / WAD;
    const deltaValue = asset.value - targetValue;
    return {
      asset,
      targetValue,
      deltaValue,
      direction: deltaValue > 0n ? "overweight" : deltaValue < 0n ? "underweight" : "at-target"
    };
  });
}

function chunks(total: bigint, cap: bigint): bigint[] {
  if (total <= 0n || cap <= 0n) return [];
  const result: bigint[] = [];
  let remaining = total;
  while (remaining > 0n) {
    const next = remaining > cap ? cap : remaining;
    result.push(next);
    remaining -= next;
  }
  return result;
}

/**
 * Truthful RWA Index-style static baseline.
 *
 * It sizes every desired leg only from the oracle-valued delta and the global
 * per-leg NAV cap. It deliberately does not inspect pool depth, quote impact,
 * or adapter output. Sells are emitted before buys, matching the upstream
 * planner and the PRD baseline definition.
 */
export function buildStaticBaseline(
  state: PortfolioState,
  baseAsset: Address,
  constraints: BaselineConstraints
): Trade[] {
  const maxTradeValue = (state.nav * constraints.maxTradeFraction) / WAD;
  if (maxTradeValue === 0n) return [];
  const sells: Trade[] = [];
  const buys: Trade[] = [];

  for (const delta of allocationDeltas(state)) {
    const { asset, deltaValue, direction } = delta;
    if (asset.price === 0n) continue;

    if (direction === "overweight") {
      for (const legValue of chunks(deltaValue, maxTradeValue)) {
        const amountIn = (legValue * WAD) / asset.price;
        if (amountIn === 0n) continue;
        const oracleOut = (amountIn * asset.price) / WAD;
        sells.push({
          tokenIn: asset.address,
          tokenOut: baseAsset,
          amountIn,
          minAmountOut: minimumOutput(oracleOut, constraints.slippageTolerance)
        });
      }
    }

    if (direction === "underweight") {
      for (const legValue of chunks(-deltaValue, maxTradeValue)) {
        const oracleOut = (legValue * WAD) / asset.price;
        buys.push({
          tokenIn: baseAsset,
          tokenOut: asset.address,
          amountIn: legValue,
          minAmountOut: minimumOutput(oracleOut, constraints.slippageTolerance)
        });
      }
    }
  }

  return [...sells, ...buys];
}

export function minimumOutput(oracleOutput: bigint, slippageTolerance: bigint): bigint {
  return (oracleOutput * (WAD - slippageTolerance)) / WAD;
}

export function tradeNotional(trade: Trade, state: PortfolioState, baseAsset: Address): bigint {
  if (trade.tokenIn.toLowerCase() === baseAsset.toLowerCase()) return trade.amountIn;
  const asset = state.assets.find(({ address }) => address.toLowerCase() === trade.tokenIn.toLowerCase());
  if (!asset) throw new Error(`unknown trade tokenIn ${trade.tokenIn}`);
  return (trade.amountIn * asset.price) / WAD;
}

export function grossTurnover(trades: readonly Trade[], state: PortfolioState, baseAsset: Address): bigint {
  return trades.reduce((total, trade) => total + tradeNotional(trade, state, baseAsset), 0n);
}

export function staleTokens(prices: readonly PriceAge[], now: bigint, maxAge: bigint): Address[] {
  return prices
    .filter(({ updatedAt }) => now > updatedAt && now - updatedAt > maxAge)
    .map(({ token }) => token);
}

export function classifyRevert(message: string): RevertClass {
  const matches: Array<[string, RevertClass]> = [
    ["StalePrice", "STALE_ORACLE"],
    ["TradeTooLarge", "TRADE_TOO_LARGE"],
    ["SlippageTooLoose", "SLIPPAGE_TOO_LOOSE"],
    ["InsufficientOutput", "INSUFFICIENT_OUTPUT"],
    ["ERC20InsufficientBalance", "INSUFFICIENT_BALANCE"],
    ["exceeds balance", "INSUFFICIENT_BALANCE"],
    ["DriftNotImproved", "DRIFT_NOT_IMPROVED"],
    ["ExcessiveValueLoss", "EXCESSIVE_VALUE_LOSS"],
    ["NotAuthorized", "UNAUTHORIZED"],
    ["NotAnAsset", "INVALID_ASSET"]
  ];
  return matches.find(([needle]) => message.includes(needle))?.[1] ?? "UNKNOWN_REVERT";
}
