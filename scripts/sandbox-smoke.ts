import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, getAddress, http } from "viem";
import { robinhoodTestnet } from "../src/live/config.js";
import { sandboxAdapterAbi, sandboxFactoryAbi, sandboxOracleAbi, sandboxPoolAbi } from "../src/sandbox/abi.js";

interface Contracts { factory: string; oracle: string; swapAdapter: string; baseAsset: string; assets: string[]; pools: string[] }
interface RecordFile { status: string; chainId: number; contracts: Contracts | null }
async function main(): Promise<void> {
  const deployment = JSON.parse(readFileSync(resolve("deployments/setpoint-sandbox-rh-testnet.json"), "utf8")) as RecordFile;
  if (deployment.status !== "DEPLOYED" || !deployment.contracts) throw new Error("Sandbox is UNDEPLOYED; smoke requires a real deployment record.");
  const contracts = deployment.contracts;
  const rpc = process.env.RH_TESTNET_RPC ?? "https://rpc.testnet.chain.robinhood.com";
  const client = createPublicClient({ chain: robinhoodTestnet, transport: http(rpc) });
  const chainId = await client.getChainId();
  if (chainId !== deployment.chainId) throw new Error(`chain mismatch: ${chainId}`);
  for (const address of [contracts.factory, contracts.oracle, contracts.swapAdapter, contracts.baseAsset, ...contracts.assets, ...contracts.pools]) {
    const code = await client.getCode({ address: getAddress(address) });
    if (!code || code === "0x") throw new Error(`missing bytecode at ${address}`);
  }
  const [base, assets, factoryOracle, factoryAdapter] = await Promise.all([
  client.readContract({ address: getAddress(contracts.factory), abi: sandboxFactoryAbi, functionName: "baseAsset" }),
  client.readContract({ address: getAddress(contracts.factory), abi: sandboxFactoryAbi, functionName: "assets" }),
  client.readContract({ address: getAddress(contracts.factory), abi: sandboxFactoryAbi, functionName: "oracle" }),
  client.readContract({ address: getAddress(contracts.factory), abi: sandboxFactoryAbi, functionName: "swapAdapter" }),
  ]);
  if (getAddress(base) !== getAddress(contracts.baseAsset) || getAddress(factoryOracle) !== getAddress(contracts.oracle) || getAddress(factoryAdapter) !== getAddress(contracts.swapAdapter) || assets.length !== 4) throw new Error("factory topology mismatch");
  for (let index = 0; index < contracts.assets.length; index++) {
    const asset = getAddress(contracts.assets[index]!);
    const pool = getAddress(contracts.pools[index]!);
    const [route, reserves, quote, price] = await Promise.all([
    client.readContract({ address: getAddress(contracts.swapAdapter), abi: sandboxAdapterAbi, functionName: "poolFor", args: [asset] }),
    client.readContract({ address: pool, abi: sandboxPoolAbi, functionName: "reserves" }),
      client.readContract({ address: getAddress(contracts.swapAdapter), abi: sandboxAdapterAbi, functionName: "quote", args: [getAddress(contracts.baseAsset), asset, 100n * 10n ** 18n] }),
    client.readContract({ address: getAddress(contracts.oracle), abi: sandboxOracleAbi, functionName: "getPrice", args: [asset] }),
    ]);
    if (getAddress(route) !== pool || reserves[0] === 0n || reserves[1] === 0n || quote === 0n || price[0] === 0n) throw new Error(`invalid live route ${index}`);
  }
  console.log("Setpoint Sandbox smoke: PASS (bytecode, topology, reserves, quotes, oracle)");
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
