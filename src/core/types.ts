export type TokenAddress = `0x${string}`;

export interface TargetRange {
  min: bigint;
  max: bigint;
}

export interface AssetPolicy {
  token: TokenAddress;
  target: TargetRange;
  maxWeight: bigint;
  enabled: boolean;
}

export interface VaultPolicy {
  baseAsset: TokenAddress;
  assets: AssetPolicy[];
  cashTarget: TargetRange;
  driftTrigger: bigint;
  maxLegValue: bigint;
  maxNavLoss: bigint;
  slippageTolerance: bigint;
  maxPriceAge: bigint;
  maxTurnover?: bigint;
  minimumExpectedImprovement?: bigint;
  minimumCashBuffer?: bigint;
  paused: boolean;
}

export interface AssetPosition {
  token: TokenAddress;
  balance: bigint;
  value: bigint;
  weight: bigint;
}

export interface PortfolioState {
  stateId: string;
  blockNumber: bigint;
  blockTimestamp: bigint;
  nav: bigint;
  baseAssetBalance: bigint;
  baseAssetWeight: bigint;
  drift: bigint;
  positions: AssetPosition[];
}

export interface PricePoint {
  token: TokenAddress;
  priceWad: bigint;
  updatedAt: bigint;
  source: string;
}

export interface Trade {
  tokenIn: TokenAddress;
  tokenOut: TokenAddress;
  amountIn: bigint;
  minAmountOut: bigint;
}

export type SimulationFailureCode =
  | "STALE_PRICE"
  | "TRADE_TOO_LARGE"
  | "SLIPPAGE_TOO_LOOSE"
  | "INSUFFICIENT_OUTPUT"
  | "INSUFFICIENT_BALANCE"
  | "DRIFT_NOT_IMPROVED"
  | "EXCESSIVE_VALUE_LOSS"
  | "UNAUTHORIZED"
  | "UNSUPPORTED_ASSET"
  | "UNKNOWN_REVERT";

export interface SimulationResult {
  passed: boolean;
  failureCode?: SimulationFailureCode;
  reason?: string;
}

export interface ExecutionCostEstimate {
  quoteLossValue: bigint;
  estimatedFeeValue: bigint;
  gasCostValue: null;
  model: string;
}

export interface LiquidityDecisionRecord {
  curveId: string;
  sampleIndex: number;
  tokenIn: TokenAddress;
  tokenOut: TokenAddress;
  amountIn: bigint;
  expectedOut: bigint;
  minAmountOut?: bigint;
  oracleOut: bigint;
  safetyMarginOut: bigint;
  safetyMarginWad: bigint;
  priceImpactWad: bigint;
  desiredAmountIn?: bigint;
  maximumSafeAmountIn?: bigint;
  bindingConstraint?: string;
  expectedQuoteLossValue?: bigint;
}

export interface ExcludedLiquidityLeg {
  tokenIn: TokenAddress;
  tokenOut: TokenAddress;
  desiredAmountIn: bigint;
  reason: string;
  curveId?: string;
}

export interface RejectedAlternative {
  candidateId: string;
  reason: string;
  simulation?: SimulationResult;
  trades?: Trade[];
  expectedTurnover?: bigint;
  liquidityDecisions?: LiquidityDecisionRecord[];
  excludedLiquidityLegs?: ExcludedLiquidityLeg[];
}

export interface RebalancePlan {
  kind: "plan";
  vault: TokenAddress;
  stateId: string;
  blockNumber: bigint;
  trades: Trade[];
  expectedDriftBefore: bigint;
  expectedDriftAfter: bigint;
  expectedTurnover: bigint;
  expectedCost: ExecutionCostEstimate | null;
  activeConstraints: string[];
  rejectedAlternatives: RejectedAlternative[];
  simulation: SimulationResult;
  reason: string;
  liquidityDecisions?: LiquidityDecisionRecord[];
  excludedLiquidityLegs?: ExcludedLiquidityLeg[];
}

export type NoTradeReason =
  | "STALE_PRICE"
  | "MISSING_PRICE"
  | "DRIFT_BELOW_TRIGGER"
  | "INVALID_POLICY"
  | "INVALID_NAV"
  | "NO_FEASIBLE_PLAN"
  | "NO_SAFE_LIQUIDITY"
  | "STALE_LIQUIDITY"
  | "INSUFFICIENT_BALANCE"
  | "SIMULATION_REJECTED"
  | "TARGET_REGION_REACHED"
  | "UNSUPPORTED_ASSET"
  | "VAULT_PAUSED";

export interface NoTradeResult {
  kind: "no-trade";
  stateId: string;
  reason: NoTradeReason;
  details: string[];
  rejectedAlternatives: RejectedAlternative[];
  excludedLiquidityLegs?: ExcludedLiquidityLeg[];
}

export type SolveResult = RebalancePlan | NoTradeResult;

export interface SolveInput {
  vault: TokenAddress;
  state: PortfolioState;
  policy: VaultPolicy;
  prices: PricePoint[];
}

export interface SimulationAdapter {
  simulate(trades: readonly Trade[], state: PortfolioState): Promise<SimulationResult>;
}

export type ConfirmedInputReader = () => Promise<SolveInput>;
