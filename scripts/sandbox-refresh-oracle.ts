import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sandboxOracleAbi } from "../src/sandbox/abi.js";
import { robinhoodTestnet } from "../src/live/config.js";

interface RecordFile { status: string; contracts: null | { oracle: string; baseAsset: string; assets: string[] } }
async function main(): Promise<void> {
  const deployment = JSON.parse(readFileSync(resolve("deployments/setpoint-sandbox-rh-testnet.json"), "utf8")) as RecordFile;
  if (deployment.status !== "DEPLOYED" || !deployment.contracts) throw new Error("Sandbox deployment record is not live.");
  const secret = process.env.SETPOINT_SANDBOX_ORACLE_UPDATER_KEY ?? process.env.SETPOINT_SANDBOX_DEPLOYER_KEY;
  if (!secret) throw new Error("Missing SETPOINT_SANDBOX_ORACLE_UPDATER_KEY (or owner fallback SETPOINT_SANDBOX_DEPLOYER_KEY); oracle update was not attempted.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(secret)) throw new Error("Sandbox oracle updater key has an invalid format.");
  const rpc = process.env.RH_TESTNET_RPC ?? "https://rpc.testnet.chain.robinhood.com";
  const account = privateKeyToAccount(secret as `0x${string}`);
  const publicClient = createPublicClient({ chain: robinhoodTestnet, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: robinhoodTestnet, transport: http(rpc) });
  const tokens = [deployment.contracts.baseAsset, ...deployment.contracts.assets].map((address) => getAddress(address));
  const prices = [1n, 180n, 240n, 420n, 150n].map((value) => value * 10n ** 18n);
  await publicClient.simulateContract({ account, address: getAddress(deployment.contracts.oracle), abi: sandboxOracleAbi, functionName: "setPrices", args: [tokens, prices] });
  const hash = await wallet.writeContract({ account, address: getAddress(deployment.contracts.oracle), abi: sandboxOracleAbi, functionName: "setPrices", args: [tokens, prices], chain: robinhoodTestnet });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Oracle refresh confirmed: ${hash} at block #${receipt.blockNumber}`);
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
