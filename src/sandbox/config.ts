import { getAddress, type Address } from "viem";
import deployment from "../../deployments/setpoint-sandbox-rh-testnet.json";

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

const contracts = deployment.contracts as DeployedContracts | null;

export const sandboxDeployment: SandboxDeployment = {
  status: deployment.status === "DEPLOYED" && contracts !== null ? "DEPLOYED" : "UNDEPLOYED",
  chainId: deployment.chainId,
  network: deployment.network,
  factory: contracts ? getAddress(contracts.factory) : null,
  oracle: contracts ? getAddress(contracts.oracle) : null,
  swapAdapter: contracts ? getAddress(contracts.swapAdapter) : null,
  baseAsset: contracts ? getAddress(contracts.baseAsset) : null,
  assets: contracts ? contracts.assets.map((address) => getAddress(address)) : [],
  pools: contracts ? contracts.pools.map((address) => getAddress(address)) : [],
  deploymentBlock: deployment.deploymentBlock === null ? null : BigInt(deployment.deploymentBlock),
};

export const sandboxSymbols = ["sALPHA", "sBETA", "sGAMMA", "sDELTA"] as const;
