import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, getAddress, http, type Address } from "viem";
import { sandboxOracleAbi, sandboxTokenAbi } from "../src/sandbox/abi.js";
import { robinhoodTestnet } from "../src/live/config.js";

interface RecordFile { status: string; contracts: null | { oracle: string; baseAsset: string; assets: string[] } }
async function main(): Promise<void> {
  const deployment = JSON.parse(readFileSync(resolve("deployments/setpoint-sandbox-rh-testnet.json"), "utf8")) as RecordFile;
  if (deployment.status !== "DEPLOYED" || !deployment.contracts) throw new Error("Sandbox deployment record is not live.");
  const rpc = process.env.RH_TESTNET_RPC ?? "https://rpc.testnet.chain.robinhood.com";
  const client = createPublicClient({ chain: robinhoodTestnet, transport: http(rpc) });
  const block = await client.getBlock();
  console.log(`Robinhood Chain Testnet block #${block.number}`);
  console.log("Updater model: immutable reference prices; permissionless timestamp heartbeat");
  for (const token of [deployment.contracts.baseAsset, ...deployment.contracts.assets].map((address) => getAddress(address))) {
    const [symbol, price, referencePrice] = await Promise.all([
      client.readContract({ address: token, abi: sandboxTokenAbi, functionName: "symbol" }),
      client.readContract({ address: getAddress(deployment.contracts.oracle), abi: sandboxOracleAbi, functionName: "getPrice", args: [token] }),
      client.readContract({ address: getAddress(deployment.contracts.oracle), abi: sandboxOracleAbi, functionName: "referencePrice", args: [token] }),
    ]);
    if (price[0] !== referencePrice) throw new Error(`Mutable or mismatched reference price for ${symbol}.`);
    const age = block.timestamp > price[1] ? block.timestamp - price[1] : 0n;
    console.log(`${symbol}: price=${price[0]} updatedAt=${price[1]} age=${age}s ${age <= 86_400n ? "FRESH" : "STALE"}`);
  }
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
