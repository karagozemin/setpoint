export type ExecutionMode = "FAST_PATH" | "ADAPTIVE_FALLBACK" | "NO_TRADE" | "ERROR";

export type StepTone = "neutral" | "passed" | "intervention" | "blocked" | "confirmed";

export interface EvidenceSourceViewModel {
  network: string;
  chainId: number;
  vault: string;
  caller: string;
  forkBlock: string;
  forkHash: string;
  stateBlock: string | null;
  stateId: string | null;
  label: "Fork-backed historical evidence";
  artifactPath: string;
  evidenceHref: string;
}

export interface GuardViewModel {
  label: string;
  value: string;
  state: "active" | "clear" | "failed" | "not-recorded";
  detail: string;
}

export interface PortfolioAssetViewModel {
  symbol: string;
  token: string;
  weightBefore: number;
  weightAfter: number | null;
  targetMin: number;
  targetMax: number;
  targetLabel: string;
  statusBefore: string;
  statusAfter: string | null;
  balanceBefore: string;
  balanceAfter: string | null;
  valueBefore: string;
  valueAfter: string | null;
  liquidityStatus: "Executable sample" | "Route constrained" | "Not sampled";
}

export interface PortfolioStateViewModel {
  nav: string;
  drift: string;
  cashWeight: string;
  targetStatus: string;
  assets: PortfolioAssetViewModel[];
}

export interface TradeLegViewModel {
  index: number;
  tokenIn: string;
  tokenOut: string;
  tokenInAddress: string;
  tokenOutAddress: string;
  amountIn: string;
  minAmountOut: string;
  expectedOut: string | null;
  quoteImpact: string | null;
  safetyMargin: string | null;
  bindingConstraint: string | null;
  sampleIndex: number | null;
  status: "accepted" | "resized" | "removed" | "blocked";
  reason: string | null;
}

export interface PipelineStepViewModel {
  label: string;
  value: string;
  tone: StepTone;
}

export interface SimulationViewModel {
  fastPathStatus: "PASSED" | "FAILED" | "NOT_RUN";
  fastPathFailure: string | null;
  selectedPlanStatus: "PASSED" | "NOT_RUN";
  executionHash: string | null;
  exactVault: string;
  caller: string;
}

export interface OperatorScenarioViewModel {
  id: string;
  shortLabel: string;
  title: string;
  subtitle: string;
  mode: ExecutionMode;
  modeReason: string;
  decisionSummary: string;
  terminalReason: string;
  targetBandsReached: boolean;
  fallbackInvoked: boolean;
  adaptiveNotRequired: boolean;
  attemptedTurnover: string;
  executedTurnover: string;
  batchSummary: string;
  before: PortfolioStateViewModel | null;
  after: PortfolioStateViewModel | null;
  originalPlan: TradeLegViewModel[];
  selectedPlan: TradeLegViewModel[];
  blockedLegs: TradeLegViewModel[];
  guards: GuardViewModel[];
  pipeline: PipelineStepViewModel[];
  simulation: SimulationViewModel;
  source: EvidenceSourceViewModel;
  oracleAge: string | null;
  terminalExplanation: string;
}
