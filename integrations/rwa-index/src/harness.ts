import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  formatUnits,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hash,
  type TransactionReceipt
} from "viem";
import {
  erc20Abi,
  factoryAbi,
  oracleAbi,
  poolAbi,
  swapAdapterAbi,
  syncerAbi,
  vaultAbi
} from "./abi.js";
import { loadConfig } from "./config.js";
import { absDiff, buildCorrectivePair, WAD, type PortfolioState, type Trade } from "./math.js";
import { readPortfolio } from "./state.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const config = loadConfig();
const rpcUrl = process.env.RWA_FORK_RPC_URL ?? "http://127.0.0.1:8545";
const chain = defineChain({
  id: config.chainId,
  name: config.network,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } }
});
const transport = http(rpcUrl);
const client = createPublicClient({ chain, transport });
const testClient = createTestClient({ chain, mode: "anvil", transport });

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function jsonValue(value: unknown): Json {
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  }
  return String(value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pctWad(value: bigint): string {
  return `${(Number(value) / 1e16).toFixed(6)}%`;
}

function units(value: bigint): string {
  return formatUnits(value, 18);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function prepareImpersonated(address: Address) {
  await testClient.impersonateAccount({ address });
  await testClient.setBalance({ address, value: 100n * WAD });
  return createWalletClient({ account: address, chain, transport });
}

async function wait(hash: Hash): Promise<TransactionReceipt> {
  return client.waitForTransactionReceipt({ hash });
}

async function requireCode(label: string, address: Address): Promise<void> {
  const code = await client.getCode({ address });
  assert(code && code !== "0x", `${label} has no code at ${address}`);
}

function summarizeState(state: PortfolioState) {
  return {
    blockNumber: state.blockNumber,
    nav: state.nav,
    navFormatted: units(state.nav),
    drift: state.drift,
    driftFormatted: pctWad(state.drift),
    cash: state.cash,
    cashFormatted: units(state.cash),
    cashTarget: state.cashTarget,
    cashTargetFormatted: pctWad(state.cashTarget),
    assets: state.assets.map((asset) => ({
      symbol: asset.symbol,
      address: asset.address,
      balance: asset.balance,
      priceWad: asset.price,
      value: asset.value,
      valueFormatted: units(asset.value),
      weight: asset.weight,
      weightFormatted: pctWad(asset.weight),
      targetWeight: asset.targetWeight,
      targetWeightFormatted: pctWad(asset.targetWeight),
      updatedAt: asset.updatedAt
    }))
  };
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const { vault, oracle, manager, poolSyncer, syncerOwner } = config.contracts;

  const actualChainId = await client.getChainId();
  assert(actualChainId === config.chainId, `wrong chain: expected ${config.chainId}, received ${actualChainId}`);
  await Promise.all([
    requireCode("vault", vault),
    requireCode("oracle", oracle),
    requireCode("pool syncer", poolSyncer)
  ]);

  const sourceBlock = await client.getBlock();
  const [assets, baseAsset, actualOracle, swapAdapter, actualSyncerOwner] = await Promise.all([
    client.readContract({ address: vault, abi: vaultAbi, functionName: "assets" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "asset" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "oracle" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "swapAdapter" }),
    client.readContract({ address: poolSyncer, abi: syncerAbi, functionName: "owner" })
  ]);
  assert(actualOracle.toLowerCase() === oracle.toLowerCase(), `vault oracle mismatch: ${actualOracle}`);
  assert(actualSyncerOwner.toLowerCase() === syncerOwner.toLowerCase(), `syncer owner mismatch: ${actualSyncerOwner}`);
  assert(assets.length > 0, "vault returned no basket assets");

  await Promise.all([requireCode("base asset", baseAsset), requireCode("swap adapter", swapAdapter)]);
  for (const asset of assets) {
    await requireCode("basket asset", asset);
    const decimals = await client.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" });
    assert(decimals === 18, `M1 assumes deployed 18-decimal basket assets; ${asset} returned ${decimals}`);
  }

  const [baseDecimals, baseSymbol, feederRole, managerRole, maxStaleness] = await Promise.all([
    client.readContract({ address: baseAsset, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: baseAsset, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: oracle, abi: oracleAbi, functionName: "PRICE_FEEDER_ROLE" }),
    Promise.resolve(keccak256(toBytes("MANAGER_ROLE"))),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "maxStaleness" })
  ]);
  assert(baseDecimals === 18, `M1 assumes the deployed 18-decimal mock USDC; received ${baseDecimals}`);
  const [feederAuthorized, managerAuthorized] = await Promise.all([
    client.readContract({ address: oracle, abi: oracleAbi, functionName: "hasRole", args: [feederRole, syncerOwner] }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "hasRole", args: [managerRole, manager] })
  ]);
  assert(feederAuthorized, `${syncerOwner} does not hold PRICE_FEEDER_ROLE`);
  assert(managerAuthorized, `${manager} does not hold MANAGER_ROLE`);

  const stalePrices = await Promise.all(assets.map(async (asset) => {
    const [price, updatedAt] = await client.readContract({ address: oracle, abi: oracleAbi, functionName: "getPrice", args: [asset] });
    assert(price > 0n, `oracle price is zero for ${asset}`);
    const age = sourceBlock.timestamp > updatedAt ? sourceBlock.timestamp - updatedAt : 0n;
    return { asset, price, updatedAt, age, stale: age > maxStaleness };
  }));

  let staleReadError: string | undefined;
  try {
    await client.readContract({ address: vault, abi: vaultAbi, functionName: "totalAssets" });
  } catch (error) {
    staleReadError = errorText(error);
  }
  const staleConditionObserved = stalePrices.some(({ stale }) => stale)
    && staleReadError?.includes("StalePrice") === true;
  assert(staleConditionObserved, "expected totalAssets to fail specifically with StalePrice on deployed stale data");
  console.log(`[stale] observed: oldest price age ${stalePrices.reduce((max, item) => item.age > max ? item.age : max, 0n)}s; authoritative NAV read reverted`);

  const operatorWallet = await prepareImpersonated(syncerOwner);
  const refreshSimulation = await client.simulateContract({
    account: syncerOwner,
    address: oracle,
    abi: oracleAbi,
    functionName: "setPrices",
    args: [assets, stalePrices.map(({ price }) => price)]
  });
  const refreshHash = await operatorWallet.writeContract(refreshSimulation.request);
  const refreshReceipt = await wait(refreshHash);
  assert(refreshReceipt.status === "success", "oracle refresh transaction failed");
  console.log(`[oracle] refreshed ${assets.length} deployed prices on fork via authorized feeder ${syncerOwner}`);

  const [factory, defaultFee] = await Promise.all([
    client.readContract({ address: swapAdapter, abi: swapAdapterAbi, functionName: "factory" }),
    client.readContract({ address: swapAdapter, abi: swapAdapterAbi, functionName: "defaultFee" })
  ]);
  await requireCode("Synthra factory", factory);

  const poolSyncResults = [];
  for (const stalePrice of stalePrices) {
    const pool = await client.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: "getPool",
      args: [stalePrice.asset, baseAsset, defaultFee]
    });
    assert(pool !== ZERO_ADDRESS, `no fee-${defaultFee} pool for ${stalePrice.asset}/${baseAsset}`);
    await requireCode("Synthra pool", pool);
    const [beforeSlot0, targetSqrt, liquidity] = await Promise.all([
      client.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }),
      client.readContract({ address: poolSyncer, abi: syncerAbi, functionName: "previewTargetSqrt", args: [stalePrice.asset, baseAsset, stalePrice.price] }),
      client.readContract({ address: pool, abi: poolAbi, functionName: "liquidity" })
    ]);
    assert(liquidity > 0n, `pool ${pool} has zero active liquidity`);

    let syncHash: Hash;
    try {
      const simulation = await client.simulateContract({
        account: syncerOwner,
        address: poolSyncer,
        abi: syncerAbi,
        functionName: "syncToPrice",
        args: [pool, stalePrice.asset, baseAsset, stalePrice.price]
      });
      syncHash = await operatorWallet.writeContract(simulation.request);
      const receipt = await wait(syncHash);
      assert(receipt.status === "success", `pool sync transaction failed for ${stalePrice.asset}`);
    } catch (error) {
      throw new Error(`pool sync failed for ${stalePrice.asset} at ${pool}: ${errorText(error)}`);
    }

    const afterSlot0 = await client.readContract({ address: pool, abi: poolAbi, functionName: "slot0" });
    const errorBps = targetSqrt === 0n ? 0n : (absDiff(afterSlot0[0], targetSqrt) * 10_000n) / targetSqrt;
    assert(errorBps <= 50n, `pool ${pool} remains ${errorBps} sqrt-price bps from target after sync`);
    poolSyncResults.push({
      asset: stalePrice.asset,
      pool,
      fee: defaultFee,
      liquidity,
      targetSqrtPriceX96: targetSqrt,
      beforeSqrtPriceX96: beforeSlot0[0],
      afterSqrtPriceX96: afterSlot0[0],
      afterErrorBps: errorBps,
      transactionHash: syncHash
    });
  }
  console.log(`[pools] verified ${poolSyncResults.length} real Synthra pools at <= 50 sqrt-price bps from the refreshed oracle values`);

  const [driftThreshold, maxTradeFraction, slippageTolerance, maxRebalanceLoss, paused] = await Promise.all([
    client.readContract({ address: vault, abi: vaultAbi, functionName: "driftThreshold" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "maxTradeFraction" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "slippageTolerance" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "maxRebalanceLoss" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "paused" })
  ]);
  assert(!paused, "vault is paused");

  const before = await readPortfolio(client, vault, oracle, baseAsset, assets, config.symbols);
  console.log(`[state] NAV ${units(before.nav)} ${baseSymbol}; drift ${pctWad(before.drift)}; cash ${units(before.cash)} ${baseSymbol}`);

  const attempts = [];
  let selectedTrades: Trade[] | undefined;
  const candidateFractions = [2n, 4n, 8n, 16n, 32n, 64n];
  for (const denominator of candidateFractions) {
    const trades = buildCorrectivePair(before, baseAsset, slippageTolerance, 1n, denominator);
    if (trades.length === 0) {
      attempts.push({ fraction: `1/${denominator}`, ok: false, reason: "no corrective overweight/underweight pair" });
      continue;
    }
    try {
      const simulation = await client.simulateContract({
        account: manager,
        address: vault,
        abi: vaultAbi,
        functionName: "rebalance",
        args: [trades]
      });
      attempts.push({ fraction: `1/${denominator}`, ok: true, trades });
      selectedTrades = trades;
      break;
    } catch (error) {
      attempts.push({ fraction: `1/${denominator}`, ok: false, trades, reason: errorText(error) });
    }
  }
  assert(selectedTrades, `no valid corrective Trade[] found: ${JSON.stringify(jsonValue(attempts))}`);

  const maxTradeValue = (before.nav * maxTradeFraction) / WAD;
  for (const trade of selectedTrades) {
    let valueIn: bigint;
    if (trade.tokenIn.toLowerCase() === baseAsset.toLowerCase()) {
      valueIn = trade.amountIn;
    } else {
      const token = before.assets.find((asset) => asset.address.toLowerCase() === trade.tokenIn.toLowerCase());
      assert(token, `candidate has unknown tokenIn ${trade.tokenIn}`);
      valueIn = (trade.amountIn * token.price) / WAD;
    }
    assert(valueIn <= maxTradeValue, `candidate leg exceeds the deployed maxTradeFraction`);
  }
  console.log(`[simulate] rebalance(Trade[${selectedTrades.length}]) passed eth_call from the real manager address`);

  const managerWallet = await prepareImpersonated(manager);
  const executionSimulation = await client.simulateContract({
    account: manager,
    address: vault,
    abi: vaultAbi,
    functionName: "rebalance",
    args: [selectedTrades]
  });
  const executionHash = await managerWallet.writeContract(executionSimulation.request);
  const executionReceipt = await wait(executionHash);
  assert(executionReceipt.status === "success", "fork rebalance transaction reverted");
  const after = await readPortfolio(client, vault, oracle, baseAsset, assets, config.symbols);
  assert(after.drift < before.drift, `drift did not strictly decrease: ${before.drift} -> ${after.drift}`);
  assert(after.nav >= (before.nav * (WAD - maxRebalanceLoss)) / WAD, `NAV breached maxRebalanceLoss: ${before.nav} -> ${after.nav}`);
  console.log(`[execute] fork tx ${executionHash}`);
  console.log(`[result] drift ${pctWad(before.drift)} -> ${pctWad(after.drift)}; NAV ${units(before.nav)} -> ${units(after.nav)} ${baseSymbol}`);

  const output = {
    schemaVersion: 1,
    milestone: "M1",
    startedAt,
    completedAt: new Date().toISOString(),
    upstream: config.upstream,
    network: { name: config.network, chainId: config.chainId, forkRpc: rpcUrl },
    sourceFork: { blockNumber: sourceBlock.number, blockHash: sourceBlock.hash, timestamp: sourceBlock.timestamp },
    contracts: { ...config.contracts, baseAsset, swapAdapter, factory },
    authorization: { feederRole, feeder: syncerOwner, feederAuthorized, managerRole, manager, managerAuthorized },
    staleOracle: {
      observed: staleConditionObserved,
      maxStaleness,
      pricesBeforeRefresh: stalePrices,
      readFailure: staleReadError,
      refreshTransactionHash: refreshHash
    },
    constraints: { driftThreshold, maxTradeFraction, slippageTolerance, maxStaleness, maxRebalanceLoss, paused },
    pools: poolSyncResults,
    stateBefore: summarizeState(before),
    candidateAttempts: attempts,
    selectedTrades,
    simulation: { ok: true, caller: manager },
    execution: { transactionHash: executionHash, blockNumber: executionReceipt.blockNumber, gasUsed: executionReceipt.gasUsed },
    stateAfter: summarizeState(after),
    checks: {
      staleOracleRejectedBeforeRefresh: true,
      authorizedOracleRefreshSucceeded: true,
      realPoolsResolvedAndSynchronized: true,
      authoritativeStateReadSucceeded: true,
      rebalanceEthCallSucceeded: true,
      rebalanceForkTransactionSucceeded: true,
      driftStrictlyDecreased: after.drift < before.drift,
      navFloorHeld: after.nav >= (before.nav * (WAD - maxRebalanceLoss)) / WAD
    },
    caveats: [
      "Fork-only impersonation funded the existing feeder/syncer owner and manager with native gas; no private keys were used.",
      "Existing stale onchain oracle values were re-timestamped, not replaced with claims of current market prices.",
      "The deployed pools are toy testnet liquidity and are not evidence of production Robinhood Stock Token liquidity.",
      "All writes occurred only on the disposable local Anvil fork."
    ]
  };
  const artifactDirectory = resolve(process.cwd(), "artifacts");
  mkdirSync(artifactDirectory, { recursive: true });
  const artifactPath = resolve(artifactDirectory, "rwa-index-m1-latest.json");
  writeFileSync(artifactPath, `${JSON.stringify(jsonValue(output), null, 2)}\n`);
  console.log(`[artifact] ${artifactPath}`);
}

main().catch((error) => {
  console.error(errorText(error));
  process.exitCode = 1;
});
