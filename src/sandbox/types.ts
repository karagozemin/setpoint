import type { Address, Hash } from "viem";
import type { HybridMode, HybridSolveResult } from "../core/hybrid-solver.js";
import type { LiquiditySnapshot } from "../core/liquidity.js";
import type { PortfolioState, PricePoint, Trade, VaultPolicy } from "../core/types.js";

export interface SandboxAssetState {
  address: Address;
  pool: Address;
  symbol: string;
  balance: bigint;
  value: bigint;
  weight: bigint;
  targetWeight: bigint;
  priceWad: bigint;
  updatedAt: bigint;
  priceAge: bigint;
  reserveBase: bigint;
  reserveAsset: bigint;
  feeBps: number;
}

export interface SandboxVaultState {
  provenance: "LIVE_RPC";
  chainId: number;
  blockNumber: bigint;
  blockHash: Hash;
  blockTimestamp: bigint;
  stateId: string;
  readAt: number;
  owner: Address;
  vault: Address;
  factory: Address;
  baseAsset: Address;
  oracle: Address;
  oracleUpdater: Address;
  swapAdapter: Address;
  baseBalance: bigint;
  baseWeight: bigint;
  nav: bigint;
  drift: bigint;
  cashTarget: bigint;
  assets: SandboxAssetState[];
  prices: PricePoint[];
  policy: VaultPolicy;
  portfolio: PortfolioState;
  oracleFresh: boolean;
}

export interface SandboxAnalysis {
  mode: HybridMode;
  result: HybridSolveResult;
  state: SandboxVaultState;
  liquidity: LiquiditySnapshot;
  trades: Trade[];
  simulationPassed: boolean;
  calldata: `0x${string}` | null;
}

export interface SandboxExecution {
  hash: Hash;
  blockNumber: bigint;
  before: SandboxVaultState;
  after: SandboxVaultState;
}

export interface SandboxActivity {
  kind: "CREATED" | "TARGETS_UPDATED" | "REBALANCED";
  transactionHash: Hash;
  blockNumber: bigint;
}
