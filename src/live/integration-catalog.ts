import { getAddress, type Address } from "viem";
import {
  ROBINHOOD_EXPLORER_URL,
  ROBINHOOD_MAINNET_EXPLORER_URL,
  rwaIndexLiveConfig,
} from "./config.js";

export type IntegrationId = "vimen-agentic-mag7" | "hiss-v2" | "fides-frontier" | "rwa-index" | "mag7-index" | "wield-rwa";
export type IntegrationCapability = "PLANNING_AND_SIMULATION" | "LIVE_COMPATIBILITY";
export type IntegrationRegistryTier = "PRIMARY" | "SECONDARY";
export type IntegrationSourceKind = "GIT_COMMIT" | "RUNTIME_BYTECODE";

export interface LiveIntegrationDefinition {
  id: IntegrationId;
  name: string;
  shortName: string;
  description: string;
  why: string;
  network: string;
  chainId: number;
  vault: Address;
  explorerUrl: string;
  capability: IntegrationCapability;
  registryTier: IntegrationRegistryTier;
  sourceRepository: string;
  sourceCommit: string;
  sourceKind?: IntegrationSourceKind;
  executionBoundary: string;
}

export const liveIntegrations: readonly LiveIntegrationDefinition[] = [
  {
    id: "vimen-agentic-mag7",
    name: "Vimen Agentic MAG7",
    shortName: "VIMEN / VMAG",
    description: "Funded agentic stock basket with a live seven-asset recipe, full-backing proof, oracle-gated NAV, and immutable rebalance caps.",
    why: "Its rotating onchain recipe and hard cooldown, turnover, slippage, registry, and backing constraints closely match Setpoint's rebalance-readiness model.",
    network: "Robinhood Chain",
    chainId: 4_663,
    vault: "0x39b3B771D6fAbF4eFD775Ae090AfDdf14f82520F",
    explorerUrl: ROBINHOOD_MAINNET_EXPLORER_URL,
    capability: "LIVE_COMPATIBILITY",
    registryTier: "PRIMARY",
    sourceRepository: "https://github.com/vimenprotocol/vimen",
    sourceCommit: "e36785cbee3819b5858770de398bbe54e5286d84",
    executionBoundary: "Read-only readiness analysis; execution requires the basket's agent key and a registered maker settlement path.",
  },
  {
    id: "hiss-v2",
    name: "HISS Vault V2",
    shortName: "HISS V2",
    description: "Queue-routed USDG vault with live accounting, holdings, liveness, and execution-capacity evidence.",
    why: "A production-shaped vault surface with explicit lifecycle state and bounded execution lanes.",
    network: "Robinhood Chain",
    chainId: 4_663,
    vault: "0x432e90b1B35995EBE46eD93B4Db369abfc230E69",
    explorerUrl: ROBINHOOD_MAINNET_EXPLORER_URL,
    capability: "LIVE_COMPATIBILITY",
    registryTier: "PRIMARY",
    sourceRepository: "https://github.com/HissFinance/hiss",
    sourceCommit: "d09c2650dffec178cbb2513431195cc6563553ba",
    executionBoundary: "Read-only compatibility analysis; rebalance authority is protocol keeper-controlled and inactive by policy.",
  },
  {
    id: "fides-frontier",
    name: "Fides Frontier",
    shortName: "FIDES",
    description: "Fully-backed stock index with immutable assets and onchain slippage, turnover, cooldown, and oracle guards.",
    why: "Its constrained rebalancer closely matches Setpoint's policy-to-execution safety model.",
    network: "Robinhood Chain",
    chainId: 4_663,
    vault: "0x4504483Ea748e630A9368F44f0Ee5B4350462Db8",
    explorerUrl: ROBINHOOD_MAINNET_EXPLORER_URL,
    capability: "LIVE_COMPATIBILITY",
    registryTier: "PRIMARY",
    sourceRepository: "https://github.com/FidesFi/FidesFi",
    sourceCommit: "29a240d82fbf63bdf88da4ca50a37141f106a2e2",
    executionBoundary: "Read-only compatibility analysis; the external rebalancer role is required for execution.",
  },
  {
    id: "rwa-index",
    name: "RWA Index",
    shortName: "RWA INDEX",
    description: "Target-weight testnet vault with live policy reads and exact rebalance simulation.",
    why: "A real rebalance(Trade[]) interface, hard vault guards, oracle floors, and multi-asset target management.",
    network: "Robinhood Chain testnet",
    chainId: rwaIndexLiveConfig.chainId,
    vault: rwaIndexLiveConfig.vault,
    explorerUrl: ROBINHOOD_EXPLORER_URL,
    capability: "PLANNING_AND_SIMULATION",
    registryTier: "PRIMARY",
    sourceRepository: "https://github.com/RaYYeR220/rwa-index",
    sourceCommit: "b2456ca5400ba9ec36d81691554b889fb9250513",
    executionBoundary: "Exact simulation and authorized submission are supported; adaptive sizing remains unavailable without live quotes.",
  },
  {
    id: "mag7-index",
    name: "MAG7 Index Vault",
    shortName: "MAG7 / SEVEN",
    description: "Equal-weight seven-stock index contract with vault-native NAV, feed freshness, drift-band, per-leg cap, and cooldown reads.",
    why: "The contract exposes exactly the accounting and bounded-rebalance signals Setpoint needs, but the current deployment is kept secondary until it has issued supply and non-zero holdings.",
    network: "Robinhood Chain",
    chainId: 4_663,
    vault: "0xc6ff4bc6E90a624a20D5c06679965A951a5Ba2F4",
    explorerUrl: ROBINHOOD_MAINNET_EXPLORER_URL,
    capability: "LIVE_COMPATIBILITY",
    registryTier: "SECONDARY",
    sourceRepository: "https://www.mag7.foundation/docs",
    sourceCommit: "780d018903d5bf239d9e6d57d8efc28f78a727ec6c9646e330a84d69f2d13e4d",
    sourceKind: "RUNTIME_BYTECODE",
    executionBoundary: "Read-only readiness analysis; the deployment currently has no issued shares or funded inventory, and rebalance authority remains protocol-controlled.",
  },
  {
    id: "wield-rwa",
    name: "Wield RWA Vault",
    shortName: "WIELD",
    description: "ERC-4626 USDG vault with signed allocation intents, concentration caps, slippage limits, and oracle guards.",
    why: "Its intent-based control plane is a strong adapter target for pre-signature policy and readiness checks, but the flagship deployment currently has no portfolio.",
    network: "Robinhood Chain",
    chainId: 4_663,
    vault: "0x7769526f55cd6B0B8a9E0Bf9e124618A0fe084de",
    explorerUrl: ROBINHOOD_MAINNET_EXPLORER_URL,
    capability: "LIVE_COMPATIBILITY",
    registryTier: "SECONDARY",
    sourceRepository: "https://github.com/useWield/wield-contracts",
    sourceCommit: "7dbc99e80ebf88051f2b20131abbb05c002fe35c",
    executionBoundary: "Read-only compatibility analysis; execution requires a valid agent-signed allocation intent.",
  },
] as const;

export function integrationForAddress(address: string): LiveIntegrationDefinition | null {
  try {
    const normalized = getAddress(address);
    return liveIntegrations.find((integration) => integration.vault === normalized) ?? null;
  } catch {
    return null;
  }
}

export function integrationById(id: IntegrationId): LiveIntegrationDefinition {
  const integration = liveIntegrations.find((candidate) => candidate.id === id);
  if (!integration) throw new Error(`Unknown live integration: ${id}`);
  return integration;
}

export function integrationExplorerAddress(integration: LiveIntegrationDefinition): string {
  return `${integration.explorerUrl}/address/${integration.vault}`;
}
