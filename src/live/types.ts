import type { Address, Hash } from "viem";
import type { SimulationFailureCode, Trade } from "../core/types.js";

export type LiveAnalysisMode = "FAST_PATH" | "ADAPTIVE_FALLBACK" | "NO_TRADE";

export interface LiveAssetState {
  address: Address;
  symbol: string;
  decimals: number;
  balance: bigint;
  priceWad: bigint;
  priceUpdatedAt: bigint;
  priceAge: bigint;
  priceStatus: "CURRENT" | "STALE";
  value: bigint | null;
  weight: bigint | null;
  targetWeight: bigint;
}

export interface LiveVaultState {
  provenance: "LIVE_RPC";
  integration: "RWA_INDEX";
  network: string;
  chainId: number;
  blockNumber: bigint;
  blockHash: Hash;
  blockTimestamp: bigint;
  readAt: number;
  vault: Address;
  oracle: Address;
  swapAdapter: Address;
  baseAsset: Address;
  baseSymbol: string;
  cashBalance: bigint;
  cashTarget: bigint;
  nav: bigint | null;
  drift: bigint | null;
  assets: LiveAssetState[];
  staleAssets: Address[];
  guards: {
    paused: boolean;
    driftThreshold: bigint;
    maxTradeFraction: bigint;
    slippageTolerance: bigint;
    maxStaleness: bigint;
    maxRebalanceLoss: bigint;
  };
  configuredManager: Address;
  authorization: {
    account: Address | null;
    managerRole: boolean;
    agentSession: boolean;
    canExecute: boolean;
  };
}

export interface ProposedAllocation {
  assetWeights: Record<string, bigint>;
  cashWeight: bigint;
}

export interface LiveAnalysisResult {
  mode: LiveAnalysisMode;
  title: "REBALANCE READY" | "INTERVENTION REQUIRED" | "EXECUTION REFUSED";
  summary: string;
  reason: string;
  details: string[];
  state: LiveVaultState;
  trades: Trade[];
  simulation: {
    attempted: boolean;
    passed: boolean;
    caller: Address;
    failureCode?: SimulationFailureCode;
    reason?: string;
  };
  calldata: `0x${string}` | null;
  canExecute: boolean;
  adaptiveFallbackAvailable: false;
}

export interface ExecutionResult {
  hash: Hash;
  blockNumber: bigint;
  before: LiveVaultState;
  after: LiveVaultState;
}
