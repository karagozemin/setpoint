import { getAddress, type Address } from "viem";
import {
  chainId,
  contracts,
  deploymentBlock,
  network,
  status,
} from "../../deployments/setpoint-sandbox-rh-testnet.json";

interface DeployedContracts {
  factory: string;
  oracle: string;
  swapAdapter: string;
  baseAsset: string;
  assets: string[];
  pools: string[];
}

export interface SandboxDeployment {
  status: "UNDEPLOYED" | "DEPLOYED";
  chainId: number;
  network: string;
  factory: Address | null;
  oracle: Address | null;
  swapAdapter: Address | null;
  baseAsset: Address | null;
  assets: Address[];
  pools: Address[];
  deploymentBlock: bigint | null;
}

const deployedContracts = contracts as DeployedContracts | null;

export const sandboxDeployment: SandboxDeployment = {
  status: status === "DEPLOYED" && deployedContracts !== null ? "DEPLOYED" : "UNDEPLOYED",
  chainId,
  network,
  factory: deployedContracts ? getAddress(deployedContracts.factory) : null,
  oracle: deployedContracts ? getAddress(deployedContracts.oracle) : null,
  swapAdapter: deployedContracts ? getAddress(deployedContracts.swapAdapter) : null,
  baseAsset: deployedContracts ? getAddress(deployedContracts.baseAsset) : null,
  assets: deployedContracts ? deployedContracts.assets.map((address) => getAddress(address)) : [],
  pools: deployedContracts ? deployedContracts.pools.map((address) => getAddress(address)) : [],
  deploymentBlock: deploymentBlock === null ? null : BigInt(deploymentBlock),
};

export const sandboxSymbols = ["sALPHA", "sBETA", "sGAMMA", "sDELTA"] as const;
