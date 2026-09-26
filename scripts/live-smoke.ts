import { createPublicClient, encodeFunctionData, getAddress, http } from "viem";
import { vaultAbi } from "../integrations/rwa-index/src/abi.js";
import { ROBINHOOD_RPC_URL, robinhoodTestnet, rwaIndexLiveConfig } from "../src/live/config.js";
import { RWAIndexLiveAdapter } from "../src/live/rwa-index-live-adapter.js";

const client = createPublicClient({ chain: robinhoodTestnet, transport: http(ROBINHOOD_RPC_URL, { timeout: 30_000 }) });
const adapter = new RWAIndexLiveAdapter(client);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const chainId = await client.getChainId();
  assert(chainId === rwaIndexLiveConfig.chainId, `chain ID mismatch: ${chainId}`);
  const block = await client.getBlock({ blockTag: "latest" });
  const addresses = [rwaIndexLiveConfig.vault, rwaIndexLiveConfig.oracle, rwaIndexLiveConfig.swapAdapter, rwaIndexLiveConfig.baseAsset];
  const code = await Promise.all(addresses.map((address) => client.getCode({ address })));
  code.forEach((bytecode, index) => assert(bytecode !== undefined && bytecode !== "0x", `no bytecode at ${addresses[index]}`));

  const state = await adapter.readVaultState();
  assert(getAddress(state.vault) === getAddress(rwaIndexLiveConfig.vault), "vault mismatch");
  assert(state.blockNumber > 0n && state.blockHash.length === 66, "invalid live block identity");
  assert(state.assets.length === 5, `expected five assets, found ${state.assets.length}`);
  assert(state.assets.every(({ priceWad, priceUpdatedAt }) => priceWad > 0n && priceUpdatedAt > 0n), "oracle read failed");
  assert(state.guards.maxStaleness > 0n && state.guards.maxTradeFraction > 0n, "guard read failed");

  let simulationCapability = "success";
  try {
    await client.call({
      account: state.configuredManager,
      to: state.vault,
      data: encodeFunctionData({ abi: vaultAbi, functionName: "rebalance", args: [[]] }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(!/fetch failed|timeout|network/i.test(message), `simulation RPC failed: ${message}`);
    simulationCapability = "eth_call returned a contract revert (capability confirmed)";
  }

  console.log(`Robinhood Chain testnet: chainId ${chainId}`);
  console.log(`Live block: ${state.blockNumber} ${state.blockHash}`);
  console.log(`Configured bytecode: ${code.length}/${code.length} contracts present`);
  console.log(`RWA Index state: ${state.assets.length} assets, ${state.staleAssets.length} stale oracle prices`);
  console.log(`Authoritative NAV: ${state.nav === null ? "unavailable (stale-price guard)" : state.nav}`);
  console.log(`Exact vault simulation: ${simulationCapability}`);
  console.log("Setpoint deployment: none configured; no vanity contract is claimed");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
