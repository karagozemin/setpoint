import type { Address } from "viem";
import type { LiquidityCurve, LiquiditySample, LiquiditySnapshot } from "../../../src/core/liquidity.js";
import { WAD } from "../../../src/core/policy.js";
import type { SolveInput, TokenAddress } from "../../../src/core/types.js";
import { factoryAbi } from "./abi.js";
import { RwaIndexSetpointAdapter, type RwaDeployment } from "./setpoint-adapter.js";

const SAMPLE_FRACTIONS: ReadonlyArray<readonly [bigint, bigint]> = [
  [1n, 256n], [1n, 128n], [1n, 64n], [1n, 32n], [1n, 16n], [1n, 8n],
  [1n, 4n], [3n, 8n], [1n, 2n], [5n, 8n], [3n, 4n], [7n, 8n], [1n, 1n]
];

export interface SamplerOptions {
  quoteMaxAge: bigint;
  convergenceTarget?: "band-edge" | "midpoint";
  additionalAmounts?: ReadonlyArray<{ tokenIn: TokenAddress; tokenOut: TokenAddress; amountIn: bigint }>;
}

export async function sampleRwaLiquidity(
  adapter: RwaIndexSetpointAdapter,
  deployment: RwaDeployment,
  input: SolveInput,
  options: SamplerOptions
): Promise<LiquiditySnapshot> {
  const curves: LiquidityCurve[] = [];
  const cashMin = input.state.nav * input.policy.cashTarget.min / WAD;
  const cashMax = input.state.nav * input.policy.cashTarget.max / WAD;
  const cashMid = input.state.nav * midpoint(input.policy.cashTarget.min, input.policy.cashTarget.max) / WAD;
  const cashDeficit = input.state.baseAssetBalance < cashMin
    ? (options.convergenceTarget === "midpoint" ? cashMid : cashMin) - input.state.baseAssetBalance
    : 0n;
  const excessCash = input.state.baseAssetBalance > cashMax
    ? input.state.baseAssetBalance - (options.convergenceTarget === "midpoint" ? cashMid : cashMax)
    : 0n;
  const hasOverweight = input.policy.assets.filter(({ enabled }) => enabled).some((asset) => {
    const position = input.state.positions.find(({ token }) => token.toLowerCase() === asset.token.toLowerCase());
    return position !== undefined && position.value > input.state.nav * asset.target.max / WAD;
  });
  const hasUnderweight = input.policy.assets.filter(({ enabled }) => enabled).some((asset) => {
    const position = input.state.positions.find(({ token }) => token.toLowerCase() === asset.token.toLowerCase());
    return position !== undefined && position.value < input.state.nav * asset.target.min / WAD;
  });
  for (const assetPolicy of input.policy.assets.filter(({ enabled }) => enabled)) {
    const position = input.state.positions.find(({ token }) => token.toLowerCase() === assetPolicy.token.toLowerCase());
    const price = input.prices.find(({ token }) => token.toLowerCase() === assetPolicy.token.toLowerCase());
    if (!position || !price || price.priceWad === 0n) continue;
    const minValue = input.state.nav * assetPolicy.target.min / WAD;
    const maxValue = input.state.nav * assetPolicy.target.max / WAD;
    const targetValue = input.state.nav * midpoint(assetPolicy.target.min, assetPolicy.target.max) / WAD;
    const sellDestination = options.convergenceTarget === "midpoint" ? targetValue : minValue;
    const buyDestination = options.convergenceTarget === "midpoint" ? targetValue : maxValue;
    const directionalSellValue = position.value > maxValue
      ? position.value - (options.convergenceTarget === "midpoint" ? targetValue : maxValue)
      : hasUnderweight && !hasOverweight && position.value > sellDestination
        ? position.value - sellDestination
      : cashDeficit > 0n && position.value > sellDestination
        ? position.value - sellDestination
        : 0n;
    if (directionalSellValue > 0n && position.balance > 0n) {
      const maximumValue = min(directionalSellValue, input.policy.maxLegValue, position.value);
      const maximumAmount = min(position.balance, maximumValue * WAD / price.priceWad);
      if (maximumAmount > 0n) {
        const grossCashDeficit = cashDeficit === 0n
          ? 0n
          : ceilDiv(cashDeficit * WAD, WAD - input.policy.slippageTolerance) * WAD / price.priceWad;
        curves.push(await sampleCurve(
          adapter,
          deployment,
          input,
          assetPolicy.token,
          input.policy.baseAsset,
          maximumAmount,
          [grossCashDeficit, ...additionalAmounts(options, assetPolicy.token, input.policy.baseAsset)],
          options
        ));
      }
    }
    const directionalBuyValue = position.value < minValue
      ? (options.convergenceTarget === "midpoint" ? targetValue : minValue) - position.value
      : hasOverweight && !hasUnderweight && position.value < buyDestination
        ? buyDestination - position.value
      : excessCash > 0n && position.value < buyDestination
        ? buyDestination - position.value
        : 0n;
    if (directionalBuyValue > 0n) {
      const maximumAmount = min(directionalBuyValue, input.policy.maxLegValue);
      if (maximumAmount > 0n) {
        curves.push(await sampleCurve(
          adapter,
          deployment,
          input,
          input.policy.baseAsset,
          assetPolicy.token,
          maximumAmount,
          [excessCash, ...additionalAmounts(options, input.policy.baseAsset, assetPolicy.token)],
          options
        ));
      }
    }
  }
  return {
    stateId: input.state.stateId,
    blockNumber: input.state.blockNumber,
    observedAt: input.state.blockTimestamp,
    curves
  };
}

function additionalAmounts(options: SamplerOptions, tokenIn: TokenAddress, tokenOut: TokenAddress): bigint[] {
  return (options.additionalAmounts ?? [])
    .filter((item) => item.tokenIn.toLowerCase() === tokenIn.toLowerCase() && item.tokenOut.toLowerCase() === tokenOut.toLowerCase())
    .map(({ amountIn }) => amountIn);
}

async function sampleCurve(
  adapter: RwaIndexSetpointAdapter,
  deployment: RwaDeployment,
  input: SolveInput,
  tokenIn: TokenAddress,
  tokenOut: TokenAddress,
  maximumAmount: bigint,
  criticalAmounts: readonly bigint[],
  options: SamplerOptions
): Promise<LiquidityCurve> {
  const amounts = curveAmounts(maximumAmount, criticalAmounts);
  const pool = await adapter.client.readContract({
    address: deployment.factory,
    abi: factoryAbi,
    functionName: "getPool",
    args: [tokenIn as Address, tokenOut as Address, deployment.fee]
  });
  const probes = await adapter.sampleExecutableSwaps(tokenIn as Address, tokenOut as Address, amounts);
  const samples: LiquiditySample[] = probes.map((probe, sampleIndex) => {
    const oracleOut = oracleOutput(input, tokenIn, tokenOut, probe.amountIn);
    const inputValue = valueOf(input, tokenIn, probe.amountIn);
    const outputValue = probe.expectedOut === undefined ? 0n : valueOf(input, tokenOut, probe.expectedOut);
    const expectedOut = probe.expectedOut ?? 0n;
    const priceImpactWad = oracleOut > expectedOut && oracleOut > 0n ? (oracleOut - expectedOut) * WAD / oracleOut : 0n;
    const feeRateWad = BigInt(deployment.fee) * WAD / 1_000_000n;
    const minOut = oracleOut * (WAD - input.policy.slippageTolerance) / WAD;
    const valid = probe.expectedOut !== undefined && expectedOut > 0n;
    return {
      sampleIndex,
      amountIn: probe.amountIn,
      expectedOut,
      oracleOut,
      inputValue,
      outputValue,
      effectiveValueRateWad: inputValue === 0n ? 0n : outputValue * WAD / inputValue,
      priceImpactWad,
      feeRateWad,
      estimatedFeeValue: inputValue * BigInt(deployment.fee) / 1_000_000n,
      quoteLossValue: inputValue > outputValue ? inputValue - outputValue : 0n,
      minOutCompatible: valid && expectedOut >= minOut,
      validity: {
        valid,
        stateId: input.state.stateId,
        blockNumber: input.state.blockNumber,
        observedAt: input.state.blockTimestamp,
        expiresAt: input.state.blockTimestamp + options.quoteMaxAge,
        ...(probe.failureReason ? { reason: probe.failureReason } : {})
      }
    };
  });
  const executable = samples.filter(({ minOutCompatible, validity }) => minOutCompatible && validity.valid);
  return {
    id: `${deployment.factory}:${pool}:${tokenIn}:${tokenOut}:${input.state.stateId}`,
    venue: "Synthra V3 via deployed SynthraSwapAdapter.swap eth_call",
    pool: pool as TokenAddress,
    tokenIn,
    tokenOut,
    fee: deployment.fee,
    stateId: input.state.stateId,
    blockNumber: input.state.blockNumber,
    observedAt: input.state.blockTimestamp,
    maximumTestedAmountIn: amounts.at(-1) ?? 0n,
    maximumExecutableAmountIn: executable.at(-1)?.amountIn ?? 0n,
    samples
  };
}

function curveAmounts(maximum: bigint, criticalAmounts: readonly bigint[]): bigint[] {
  const values = new Set<bigint>();
  for (const [numerator, denominator] of SAMPLE_FRACTIONS) {
    const amount = maximum * numerator / denominator;
    if (amount > 0n) values.add(amount);
  }
  for (const critical of criticalAmounts) {
    if (critical > 0n && critical <= maximum) values.add(critical);
  }
  return [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

function oracleOutput(input: SolveInput, tokenIn: TokenAddress, tokenOut: TokenAddress, amountIn: bigint): bigint {
  if (tokenIn.toLowerCase() === input.policy.baseAsset.toLowerCase()) {
    const price = input.prices.find(({ token }) => token.toLowerCase() === tokenOut.toLowerCase());
    return price ? amountIn * WAD / price.priceWad : 0n;
  }
  const price = input.prices.find(({ token }) => token.toLowerCase() === tokenIn.toLowerCase());
  return price ? amountIn * price.priceWad / WAD : 0n;
}

function valueOf(input: SolveInput, token: TokenAddress, amount: bigint): bigint {
  if (token.toLowerCase() === input.policy.baseAsset.toLowerCase()) return amount;
  const price = input.prices.find((point) => point.token.toLowerCase() === token.toLowerCase());
  return price ? amount * price.priceWad / WAD : 0n;
}

function min(...values: bigint[]): bigint {
  const first = values[0];
  if (first === undefined) throw new Error("min requires values");
  return values.reduce((smallest, value) => value < smallest ? value : smallest, first);
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return numerator === 0n ? 0n : (numerator - 1n) / denominator + 1n;
}

function midpoint(minimum: bigint, maximum: bigint): bigint {
  return minimum + (maximum - minimum) / 2n;
}
