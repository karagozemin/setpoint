import type { TokenAddress } from "./types.js";

export interface QuoteValidity {
  valid: boolean;
  stateId: string;
  blockNumber: bigint;
  observedAt: bigint;
  expiresAt: bigint;
  reason?: string;
}

export interface LiquiditySample {
  sampleIndex: number;
  amountIn: bigint;
  expectedOut: bigint;
  oracleOut: bigint;
  inputValue: bigint;
  outputValue: bigint;
  effectiveValueRateWad: bigint;
  priceImpactWad: bigint;
  feeRateWad: bigint;
  estimatedFeeValue: bigint;
  quoteLossValue: bigint;
  minOutCompatible: boolean;
  validity: QuoteValidity;
}

export interface LiquidityCurve {
  id: string;
  venue: string;
  pool: TokenAddress;
  tokenIn: TokenAddress;
  tokenOut: TokenAddress;
  fee: number;
  stateId: string;
  blockNumber: bigint;
  observedAt: bigint;
  maximumTestedAmountIn: bigint;
  maximumExecutableAmountIn: bigint;
  samples: LiquiditySample[];
}

export interface LiquiditySnapshot {
  stateId: string;
  blockNumber: bigint;
  observedAt: bigint;
  curves: LiquidityCurve[];
}

export interface AdaptivePolicy {
  maxQuoteAge: bigint;
  maxSimulationAttempts: number;
  maxPriceImpact?: bigint;
}

export function curveFor(
  snapshot: LiquiditySnapshot,
  tokenIn: TokenAddress,
  tokenOut: TokenAddress
): LiquidityCurve | undefined {
  return snapshot.curves.find((curve) =>
    curve.tokenIn.toLowerCase() === tokenIn.toLowerCase()
    && curve.tokenOut.toLowerCase() === tokenOut.toLowerCase()
  );
}

export function quoteIsCurrent(
  sample: LiquiditySample,
  stateId: string,
  now: bigint,
  maxQuoteAge: bigint
): boolean {
  if (!sample.validity.valid || sample.validity.stateId !== stateId) return false;
  if (now > sample.validity.expiresAt) return false;
  return now <= sample.validity.observedAt || now - sample.validity.observedAt <= maxQuoteAge;
}
