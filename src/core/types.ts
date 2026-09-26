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

export interface RejectedAlternative {
  candidateId: string;
  reason: string;
  simulation?: SimulationResult;
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
  expectedCost: null;
  activeConstraints: string[];
  rejectedAlternatives: RejectedAlternative[];
  simulation: SimulationResult;
  reason: string;
}

export type NoTradeReason =
  | "STALE_PRICE"
  | "MISSING_PRICE"
  | "DRIFT_BELOW_TRIGGER"
  | "INVALID_POLICY"
  | "INVALID_NAV"
  | "NO_FEASIBLE_PLAN"
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
