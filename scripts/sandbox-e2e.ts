import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  getAddress,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ROBINHOOD_RPC_URL, robinhoodTestnet } from "../src/live/config.js";
import { sandboxFactoryAbi, sandboxVaultAbi } from "../src/sandbox/abi.js";
import { sandboxDeployment } from "../src/sandbox/config.js";
import { SetpointSandboxLiveAdapter } from "../src/sandbox/setpoint-sandbox-live-adapter.js";

const WAD = 10n ** 18n;
const desiredCashTarget = 20n * WAD / 100n;
const desiredWeights = [15n, 25n, 20n, 20n].map((weight) => weight * WAD / 100n);

function deployerKey(): Hex {
  const raw = process.env.SETPOINT_SANDBOX_DEPLOYER_KEY ?? process.env.PRIVATE_KEY;
  if (!raw) throw new Error("Missing SETPOINT_SANDBOX_DEPLOYER_KEY or PRIVATE_KEY; no transaction was attempted.");
  const normalized = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) throw new Error("Sandbox E2E key must be a 32-byte hex value.");
  return normalized as Hex;
}

async function main(): Promise<void> {
  if (sandboxDeployment.status !== "DEPLOYED" || !sandboxDeployment.factory) {
    throw new Error("Setpoint Sandbox deployment record is not live.");
  }
  const account = privateKeyToAccount(deployerKey());
  const rpc = process.env.RH_TESTNET_RPC ?? ROBINHOOD_RPC_URL;
  const publicClient = createPublicClient({ chain: robinhoodTestnet, transport: http(rpc) });
  const walletClient = createWalletClient({ account, chain: robinhoodTestnet, transport: http(rpc) });
  const adapter = new SetpointSandboxLiveAdapter(publicClient);
  if (await publicClient.getChainId() !== sandboxDeployment.chainId) throw new Error("RPC chain mismatch; no transaction was attempted.");

  let vault = await adapter.vaultFor(account.address);
  let createHash: Hex | null = null;
  if (!vault) {
    const simulation = await publicClient.simulateContract({
      account,
      address: sandboxDeployment.factory,
      abi: sandboxFactoryAbi,
      functionName: "createVault",
    });
    createHash = await walletClient.writeContract(simulation.request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
    if (receipt.status !== "success") throw new Error("Vault creation reverted.");
    vault = await adapter.vaultFor(account.address);
    if (!vault) throw new Error("Vault creation confirmed but factory registration is missing.");
  }

  const initial = await adapter.readState(account.address, vault);
  let targetHash: Hex | null = null;
  const targetsDiffer = initial.cashTarget !== desiredCashTarget
    || initial.assets.some((asset, index) => asset.targetWeight !== desiredWeights[index]);
  if (targetsDiffer) {
    const simulation = await publicClient.simulateContract({
      account,
      address: vault,
      abi: sandboxVaultAbi,
      functionName: "setTargets",
      args: [desiredWeights, desiredCashTarget],
    });
    targetHash = await walletClient.writeContract(simulation.request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: targetHash });
    if (receipt.status !== "success") throw new Error("Target update reverted.");
  }

  const analysis = await adapter.analyze(account.address);
  if (analysis.result.kind !== "plan" || !analysis.simulationPassed || analysis.trades.length === 0) {
    if (analysis.state.drift <= analysis.state.policy.driftTrigger) {
      console.log(JSON.stringify({ status: "ALREADY_BALANCED", vault, drift: analysis.state.drift.toString() }, null, 2));
      return;
    }
    throw new Error(`Live analysis did not produce an executable plan: ${analysis.mode}`);
  }

  const before = await adapter.readState(account.address, vault);
  if (before.stateId !== analysis.state.stateId) throw new Error("Execution-relevant state changed after analysis; no rebalance was sent.");
  const finalSimulation = await publicClient.simulateContract({
    account,
    address: vault,
    abi: sandboxVaultAbi,
    functionName: "rebalance",
    args: [[...analysis.trades]],
  });
  const rebalanceHash = await walletClient.writeContract(finalSimulation.request);
  const rebalanceReceipt = await publicClient.waitForTransactionReceipt({ hash: rebalanceHash });
  if (rebalanceReceipt.status !== "success") throw new Error("Rebalance transaction reverted.");
  const after = await adapter.readState(account.address, vault);
  if (after.drift >= before.drift) throw new Error("Confirmed post-state did not improve drift.");

  const percent = (value: bigint) => `${Number(formatUnits(value * 100n, 18)).toFixed(4)}%`;
  console.log(JSON.stringify({
    status: "PASS",
    owner: getAddress(account.address),
    vault: getAddress(vault as Address),
    createHash,
    targetHash,
    rebalanceHash,
    blockNumber: rebalanceReceipt.blockNumber.toString(),
    mode: analysis.mode,
    legs: analysis.trades.length,
    navBefore: formatUnits(before.nav, 18),
    navAfter: formatUnits(after.nav, 18),
    driftBefore: percent(before.drift),
    driftAfter: percent(after.drift),
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
