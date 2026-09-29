import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const historyDirectory = resolve(root, "deployments/history");
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
const sourceCommit = process.env.SETPOINT_SANDBOX_SOURCE_COMMIT;
if (!sourceCommit || !/^[0-9a-f]{40}$/i.test(sourceCommit)) throw new Error("SETPOINT_SANDBOX_SOURCE_COMMIT must identify the deployed source commit.");
const receiptBlocks = new Map(
  (broadcast.receipts ?? [])
    .filter(({ transactionHash, blockNumber }) => transactionHash && blockNumber)
    .map(({ transactionHash, blockNumber }) => [transactionHash!.toLowerCase(), Number(BigInt(blockNumber!))]),
);
if (existsSync(outputPath)) {
  const previous = JSON.parse(readFileSync(outputPath, "utf8")) as { status?: string; contracts?: { factory?: string } };
  if (previous.status === "DEPLOYED" && previous.contracts?.factory) {
    mkdirSync(historyDirectory, { recursive: true });
    const suffix = previous.contracts.factory.toLowerCase().slice(2, 10);
    const historyPath = resolve(historyDirectory, `setpoint-sandbox-rh-testnet-${suffix}.json`);
    if (!existsSync(historyPath)) writeFileSync(historyPath, readFileSync(outputPath));
  }
}
const record = {
  schemaVersion: 2,
  status: "DEPLOYED",
  network: "Robinhood Chain Testnet",
  chainId: 46630,
  rpc: "https://rpc.testnet.chain.robinhood.com",
  explorer: "https://explorer.testnet.chain.robinhood.com",
  deployedAt: new Date(deployedAtMs).toISOString(),
  deploymentBlock: blockNumbers.length ? Math.min(...blockNumbers.map(Number)) : null,
  deployer: created[0]?.transaction?.from ?? null,
  sourceCommit,
  availability: {
    model: "GLOBAL_SEED_BUDGET_AND_DEEP_SHARED_POOLS",
    maxSeededVaults: 32,
    initialNavPerVault: "10000000000000000000000",
    maxSeededNav: "320000000000000000000000",
    baseDepthPerPool: "50000000000000000000000000",
  },
  oracleModel: {
    heartbeatSeconds: 86400,
    automationIntervalHours: 6,
    priceValues: "IMMUTABLE_AFTER_INITIALIZATION",
    timestampRefresh: "PERMISSIONLESS",
  },
  contracts: { factory, oracle, swapAdapter, baseAsset: tokens[0], assets: tokens.slice(1), pools },
  deploymentTransactions: created.filter(({ hash }) => hash).map(({ hash, contractName, contractAddress }) => ({
    hash,
    blockNumber: receiptBlocks.get(hash!.toLowerCase()) ?? null,
    contractName: contractName ?? null,
    contractAddress: contractAddress ?? null,
  })),
};
writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`);
console.log(`Wrote deployment record: ${outputPath}`);
