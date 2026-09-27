import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface BroadcastTransaction {
  hash?: string;
  transactionType?: string;
  contractName?: string;
  contractAddress?: string;
  transaction?: { from?: string };
}
interface BroadcastReceipt { blockNumber?: string; transactionHash?: string }
interface Broadcast { transactions: BroadcastTransaction[]; receipts?: BroadcastReceipt[]; timestamp?: number }

const root = resolve(process.cwd());
const broadcastPath = resolve(root, "contracts/broadcast/DeploySandbox.s.sol/46630/run-latest.json");
const outputPath = resolve(root, "deployments/setpoint-sandbox-rh-testnet.json");
const broadcast = JSON.parse(readFileSync(broadcastPath, "utf8")) as Broadcast;
const created = broadcast.transactions.filter(({ transactionType, contractAddress }) => transactionType === "CREATE" && contractAddress);
const one = (name: string) => created.find(({ contractName }) => contractName === name)?.contractAddress;
const all = (name: string) => created.filter(({ contractName }) => contractName === name).map(({ contractAddress }) => contractAddress!);
const tokens = all("SetpointSandboxToken");
const pools = all("SetpointSandboxPool");
const factory = one("SetpointSandboxFactory");
const oracle = one("SetpointSandboxOracle");
const swapAdapter = one("SetpointSandboxSwapAdapter");
if (!factory || !oracle || !swapAdapter || tokens.length !== 5 || pools.length !== 4) {
  throw new Error("Broadcast does not contain the expected Setpoint sandbox deployment topology.");
}
const blockNumbers = (broadcast.receipts ?? []).map(({ blockNumber }) => blockNumber ? BigInt(blockNumber) : null).filter((value): value is bigint => value !== null);
const broadcastTimestamp = broadcast.timestamp ?? Date.now();
const deployedAtMs = broadcastTimestamp >= 1_000_000_000_000 ? broadcastTimestamp : broadcastTimestamp * 1000;
const record = {
  schemaVersion: 1,
  status: "DEPLOYED",
  network: "Robinhood Chain Testnet",
  chainId: 46630,
  rpc: "https://rpc.testnet.chain.robinhood.com",
  explorer: "https://explorer.testnet.chain.robinhood.com",
  deployedAt: new Date(deployedAtMs).toISOString(),
  deploymentBlock: blockNumbers.length ? Math.min(...blockNumbers.map(Number)) : null,
  deployer: created[0]?.transaction?.from ?? null,
  contracts: { factory, oracle, swapAdapter, baseAsset: tokens[0], assets: tokens.slice(1), pools },
  deploymentTransactions: created.filter(({ hash }) => hash).map(({ hash, contractName, contractAddress }) => ({ hash, contractName: contractName ?? null, contractAddress: contractAddress ?? null })),
};
writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`);
console.log(`Wrote deployment record: ${outputPath}`);
