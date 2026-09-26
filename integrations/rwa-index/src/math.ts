import type { Address } from "viem";

export const WAD = 10n ** 18n;

export interface AssetState {
  address: Address;
  symbol: string;
  balance: bigint;
  price: bigint;
  updatedAt: bigint;
  value: bigint;
  weight: bigint;
  targetWeight: bigint;
}

export interface PortfolioState {
  blockNumber: bigint;
  nav: bigint;
  drift: bigint;
  cash: bigint;
  cashTarget: bigint;
  assets: AssetState[];
}

export interface Trade {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minAmountOut: bigint;
}

export function absDiff(a: bigint, b: bigint): bigint {
  return a > b ? a - b : b - a;
}

export function buildCorrectivePair(
  state: PortfolioState,
  baseAsset: Address,
  slippageTolerance: bigint,
  fractionNumerator: bigint,
  fractionDenominator: bigint
): Trade[] {
  const ranked = state.assets.map((asset) => {
    const targetValue = (state.nav * asset.targetWeight) / WAD;
    return { asset, delta: asset.value - targetValue };
  });
  const overweight = ranked.filter(({ delta }) => delta > 0n).sort((a, b) => a.delta > b.delta ? -1 : 1)[0];
  const underweight = ranked.filter(({ delta }) => delta < 0n).sort((a, b) => a.delta < b.delta ? -1 : 1)[0];
  if (!overweight || !underweight) return [];

  const transferable = overweight.delta < -underweight.delta ? overweight.delta : -underweight.delta;
  const requestedValue = (transferable * fractionNumerator) / fractionDenominator;
  const sellAmount = (requestedValue * WAD) / overweight.asset.price;
  if (sellAmount === 0n) return [];

  const oracleSellOut = (sellAmount * overweight.asset.price) / WAD;
  const guaranteedSellOut = (oracleSellOut * (WAD - slippageTolerance)) / WAD;
  if (guaranteedSellOut === 0n) return [];
  const oracleBuyOut = (guaranteedSellOut * WAD) / underweight.asset.price;
  const minBuyOut = (oracleBuyOut * (WAD - slippageTolerance)) / WAD;

  return [
    {
      tokenIn: overweight.asset.address,
      tokenOut: baseAsset,
      amountIn: sellAmount,
      minAmountOut: guaranteedSellOut
    },
    {
      tokenIn: baseAsset,
      tokenOut: underweight.asset.address,
      amountIn: guaranteedSellOut,
      minAmountOut: minBuyOut
    }
  ];
}
