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
  type Hash
} from "viem";
import {
  classifyRevert,
  grossTurnover,
  buildStaticBaseline,
  staleTokens,
  type RevertClass
} from "./baseline.js";
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
import { WAD, type PortfolioState, type Trade } from "./math.js";
import { readPortfolio } from "./state.js";

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
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface Guards {
  driftThreshold: bigint;
  maxTradeFraction: bigint;
  slippageTolerance: bigint;
  maxStaleness: bigint;
  maxRebalanceLoss: bigint;
  paused: boolean;
}

interface PoolState {
  asset: Address;
  symbol: string;
  pool: Address;
  fee: number;
  activeLiquidity: bigint;
  stockInventory: bigint;
  stockInventoryOracleValue: bigint;
  baseInventory: bigint;
  inventoryValueProxy: bigint;
  sqrtPriceX96: bigint;
  targetSqrtPriceX96: bigint;
  targetErrorBps: bigint;
}

interface ScenarioDefinition {
  id: string;
  title: string;
  rationale: string;
  weights: bigint[];
  cashTarget: bigint;
  liquidityClass: "relatively-deep-toy" | "thin-toy" | "asymmetric-toy" | "large-change" | "defensive";
  focusAssets: string[];
  maxCycles: number;
}

interface CycleResult {
  cycle: number;
  sourceBlock: bigint;
  guards: Guards;
  stateBefore: ReturnType<typeof summarizeState>;
  proposedTrades: Trade[];
  numberOfLegs: number;
  grossTurnover: bigint;
  grossTurnoverOverNav: bigint;
  simulationPass: boolean;
  revertClass?: RevertClass;
  revertReason?: string;
  executionHash?: Hash;
  stateAfter?: ReturnType<typeof summarizeState>;
  realizedBalanceChanges?: ReturnType<typeof balanceChanges>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jsonValue(value: unknown): Json {
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  return String(value);
}

function units(value: bigint): string {
  return formatUnits(value, 18);
}

function pctWad(value: bigint): string {
  return `${(Number(value) / 1e16).toFixed(6)}%`;
}

function symbolFor(address: Address): string {
  const match = Object.entries(config.symbols).find(([token]) => token.toLowerCase() === address.toLowerCase());
  return match?.[1] ?? address;
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
    cashWeight: state.nav === 0n ? 0n : (state.cash * WAD) / state.nav,
    cashTarget: state.cashTarget,
    assets: state.assets.map((asset) => ({
      symbol: asset.symbol,
      address: asset.address,
      balance: asset.balance,
      oraclePriceWad: asset.price,
      oracleUpdatedAt: asset.updatedAt,
      value: asset.value,
      valueFormatted: units(asset.value),
      currentWeight: asset.weight,
      currentWeightFormatted: pctWad(asset.weight),
      targetRange: { min: asset.targetWeight, max: asset.targetWeight },
      targetWeightFormatted: pctWad(asset.targetWeight)
    }))
  };
}

function balanceChanges(before: PortfolioState, after: PortfolioState) {
  return {
    cash: after.cash - before.cash,
    assets: before.assets.map((asset) => {
      const next = after.assets.find(({ address }) => address.toLowerCase() === asset.address.toLowerCase());
      assert(next, `missing post-cycle asset ${asset.address}`);
      return {
        symbol: asset.symbol,
        address: asset.address,
        balanceDelta: next.balance - asset.balance,
        oracleValueDelta: next.value - asset.value
      };
    })
  };
}

async function prepareAccount(address: Address) {
  await testClient.impersonateAccount({ address });
  await testClient.setBalance({ address, value: 100n * WAD });
  return createWalletClient({ account: address, chain, transport });
}

async function wait(hash: Hash): Promise<void> {
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert(receipt.status === "success", `transaction ${hash} reverted`);
}

async function requireCode(label: string, address: Address): Promise<void> {
  const code = await client.getCode({ address });
  assert(code && code !== "0x", `${label} has no code at ${address}`);
}

async function readGuards(vault: Address): Promise<Guards> {
  const [driftThreshold, maxTradeFraction, slippageTolerance, maxStaleness, maxRebalanceLoss, paused] = await Promise.all([
    client.readContract({ address: vault, abi: vaultAbi, functionName: "driftThreshold" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "maxTradeFraction" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "slippageTolerance" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "maxStaleness" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "maxRebalanceLoss" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "paused" })
  ]);
  return { driftThreshold, maxTradeFraction, slippageTolerance, maxStaleness, maxRebalanceLoss, paused };
}

async function validateDeployment() {
  const { vault, oracle, manager, poolSyncer, syncerOwner } = config.contracts;
  assert(await client.getChainId() === config.chainId, `expected chain ${config.chainId}`);
  await Promise.all([requireCode("vault", vault), requireCode("oracle", oracle), requireCode("pool syncer", poolSyncer)]);
  const [assets, baseAsset, actualOracle, adapter, owner, guards] = await Promise.all([
    client.readContract({ address: vault, abi: vaultAbi, functionName: "assets" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "asset" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "oracle" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "swapAdapter" }),
    client.readContract({ address: poolSyncer, abi: syncerAbi, functionName: "owner" }),
    readGuards(vault)
  ]);
  assert(actualOracle.toLowerCase() === oracle.toLowerCase(), "configured oracle differs from vault oracle");
  assert(owner.toLowerCase() === syncerOwner.toLowerCase(), "configured syncer owner differs from contract owner");
  assert(!guards.paused, "vault is paused");
  await Promise.all([requireCode("base asset", baseAsset), requireCode("swap adapter", adapter)]);
  assert(await client.readContract({ address: baseAsset, abi: erc20Abi, functionName: "decimals" }) === 18, "base asset is not 18 decimals");
  for (const asset of assets) {
    await requireCode("basket asset", asset);
    assert(await client.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }) === 18, `${asset} is not 18 decimals`);
  }
  const [feederRole, managerAuthorized] = await Promise.all([
    client.readContract({ address: oracle, abi: oracleAbi, functionName: "PRICE_FEEDER_ROLE" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "hasRole", args: [keccak256(toBytes("MANAGER_ROLE")), manager] })
  ]);
  const feederAuthorized = await client.readContract({ address: oracle, abi: oracleAbi, functionName: "hasRole", args: [feederRole, syncerOwner] });
  assert(feederAuthorized, "configured feeder lacks PRICE_FEEDER_ROLE");
  assert(managerAuthorized, "configured manager lacks MANAGER_ROLE");
  return { assets, baseAsset, adapter, guards };
}

async function readRawPrices(assets: readonly Address[]) {
  return Promise.all(assets.map(async (token) => {
    const [price, updatedAt] = await client.readContract({ address: config.contracts.oracle, abi: oracleAbi, functionName: "getPrice", args: [token] });
    return { token, price, updatedAt };
  }));
}

async function staleScenario(assets: readonly Address[], guards: Guards, sourceBlock: Awaited<ReturnType<typeof client.getBlock>>) {
  const prices = await readRawPrices(assets);
  const stale = staleTokens(prices, sourceBlock.timestamp, guards.maxStaleness);
  let reason = "";
  try {
    await client.readContract({ address: config.contracts.vault, abi: vaultAbi, functionName: "totalAssets" });
  } catch (error) {
    reason = errorText(error);
  }
  const revertClass = classifyRevert(reason);
  assert(stale.length > 0, "stale scenario has no stale prices");
  assert(revertClass === "STALE_ORACLE", `expected STALE_ORACLE, received ${revertClass}`);
  return {
    schemaVersion: 1,
    benchmark: "truthful-static-baseline",
    scenario: {
      id: "stale-oracle",
      title: "Stale oracle expected no-trade",
      rationale: "Uses the untouched deployed oracle timestamps and requires authoritative NAV ingestion to fail closed."
    },
    fork: { sourceBlockNumber: sourceBlock.number, sourceBlockHash: sourceBlock.hash, sourceTimestamp: sourceBlock.timestamp },
    guards,
    oraclePrices: prices,
    staleTokens: stale,
    attemptedCycleCount: 0,
    successfulCycleCount: 0,
    cumulativeTurnover: 0n,
    stepsToTargetRegion: null,
    targetRegionReached: false,
    outcome: "no-trade",
    noTradeReason: revertClass,
    revertReason: reason,
    cycles: [],
    limitations: ["No current weights or NAV are reported because the authoritative vault reads correctly reject stale inputs."]
  };
}

async function refreshAndSync(assets: readonly Address[], baseAsset: Address, adapter: Address): Promise<PoolState[]> {
  const { oracle, poolSyncer, syncerOwner } = config.contracts;
  const prices = await readRawPrices(assets);
  assert(prices.every(({ price }) => price > 0n), "cannot refresh a zero oracle value");
  const operator = await prepareAccount(syncerOwner);
  const refresh = await client.simulateContract({
    account: syncerOwner,
    address: oracle,
    abi: oracleAbi,
    functionName: "setPrices",
    args: [assets, prices.map(({ price }) => price)]
  });
  await wait(await operator.writeContract(refresh.request));

  const [factory, fee] = await Promise.all([
    client.readContract({ address: adapter, abi: swapAdapterAbi, functionName: "factory" }),
    client.readContract({ address: adapter, abi: swapAdapterAbi, functionName: "defaultFee" })
  ]);
  await requireCode("Synthra factory", factory);
  const pools: PoolState[] = [];
  for (const item of prices) {
    const pool = await client.readContract({ address: factory, abi: factoryAbi, functionName: "getPool", args: [item.token, baseAsset, fee] });
    assert(pool !== ZERO_ADDRESS, `missing pool for ${symbolFor(item.token)}`);
    const target = await client.readContract({ address: poolSyncer, abi: syncerAbi, functionName: "previewTargetSqrt", args: [item.token, baseAsset, item.price] });
    const sync = await client.simulateContract({
      account: syncerOwner,
      address: poolSyncer,
      abi: syncerAbi,
      functionName: "syncToPrice",
      args: [pool, item.token, baseAsset, item.price]
    });
    await wait(await operator.writeContract(sync.request));
    const [slot0, activeLiquidity, stockInventory, baseInventory] = await Promise.all([
      client.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }),
      client.readContract({ address: pool, abi: poolAbi, functionName: "liquidity" }),
      client.readContract({ address: item.token, abi: erc20Abi, functionName: "balanceOf", args: [pool] }),
      client.readContract({ address: baseAsset, abi: erc20Abi, functionName: "balanceOf", args: [pool] })
    ]);
    const errorBps = (slot0[0] > target ? slot0[0] - target : target - slot0[0]) * 10_000n / target;
    assert(errorBps <= 50n, `${symbolFor(item.token)} pool remains outside sync tolerance`);
    const stockValue = stockInventory * item.price / WAD;
    pools.push({
      asset: item.token,
      symbol: symbolFor(item.token),
      pool,
      fee,
      activeLiquidity,
      stockInventory,
      stockInventoryOracleValue: stockValue,
      baseInventory,
      inventoryValueProxy: stockValue + baseInventory,
      sqrtPriceX96: slot0[0],
      targetSqrtPriceX96: target,
      targetErrorBps: errorBps
    });
  }
  return pools;
}

async function setStrategy(assets: readonly Address[], weights: readonly bigint[], cashTarget: bigint): Promise<Hash> {
  assert(weights.length === assets.length, "scenario weights do not match basket length");
  assert(weights.reduce((sum, weight) => sum + weight, cashTarget) === WAD, "scenario weights and cash target do not sum to WAD");
  const { manager, vault } = config.contracts;
  const wallet = await prepareAccount(manager);
  const simulation = await client.simulateContract({
    account: manager,
    address: vault,
    abi: vaultAbi,
    functionName: "setStrategy",
    args: [[...assets], [...weights], cashTarget]
  });
  const hash = await wallet.writeContract(simulation.request);
  await wait(hash);
  return hash;
}

async function runScenario(
  definition: ScenarioDefinition,
  assets: readonly Address[],
  baseAsset: Address,
  guards: Guards,
  pools: readonly PoolState[],
  sourceBlock: Awaited<ReturnType<typeof client.getBlock>>
) {
  const setupTransactions = [await setStrategy(assets, definition.weights, definition.cashTarget)];
  const cycles: CycleResult[] = [];
  let attemptedCycleCount = 0;
  let successfulCycleCount = 0;
  let cumulativeTurnover = 0n;
  let targetRegionReached = false;

  for (let cycleNumber = 1; cycleNumber <= definition.maxCycles; cycleNumber++) {
    const before = await readPortfolio(client, config.contracts.vault, config.contracts.oracle, baseAsset, assets, config.symbols);
    if (before.drift <= guards.driftThreshold) {
      targetRegionReached = true;
      break;
    }

    const trades = buildStaticBaseline(before, baseAsset, guards);
    if (trades.length === 0) break;
    attemptedCycleCount += 1;
    const turnover = grossTurnover(trades, before, baseAsset);
    const cycle: CycleResult = {
      cycle: cycleNumber,
      sourceBlock: before.blockNumber,
      guards,
      stateBefore: summarizeState(before),
      proposedTrades: trades,
      numberOfLegs: trades.length,
      grossTurnover: turnover,
      grossTurnoverOverNav: before.nav === 0n ? 0n : turnover * WAD / before.nav,
      simulationPass: false
    };

    try {
      const simulation = await client.simulateContract({
        account: config.contracts.manager,
        address: config.contracts.vault,
        abi: vaultAbi,
        functionName: "rebalance",
        args: [trades]
      });
      cycle.simulationPass = true;
      const managerWallet = await prepareAccount(config.contracts.manager);
      const hash = await managerWallet.writeContract(simulation.request);
      await wait(hash);
      cycle.executionHash = hash;
      const after = await readPortfolio(client, config.contracts.vault, config.contracts.oracle, baseAsset, assets, config.symbols);
      assert(after.drift < before.drift, "successful baseline cycle did not strictly reduce drift");
      assert(after.nav >= before.nav * (WAD - guards.maxRebalanceLoss) / WAD, "successful baseline cycle violated NAV floor");
      cycle.stateAfter = summarizeState(after);
      cycle.realizedBalanceChanges = balanceChanges(before, after);
      successfulCycleCount += 1;
      cumulativeTurnover += turnover;
      cycles.push(cycle);
      if (after.drift <= guards.driftThreshold) {
        targetRegionReached = true;
        break;
      }
    } catch (error) {
      const reason = errorText(error);
      cycle.revertReason = reason;
      cycle.revertClass = classifyRevert(reason);
      cycles.push(cycle);
      break;
    }
  }

  const finalState = await readPortfolio(client, config.contracts.vault, config.contracts.oracle, baseAsset, assets, config.symbols);
  if (finalState.drift <= guards.driftThreshold) targetRegionReached = true;
  return {
    schemaVersion: 1,
    benchmark: "truthful-static-baseline",
    algorithm: {
      sizing: "oracle-valued target delta chunked by the deployed maxTradeFraction",
      sequencing: "all overweight sells to base asset, then all underweight buys from base asset",
      minAmountOut: "oracle-implied output multiplied by (1 - deployed slippageTolerance)",
      depthAwareness: false,
      failedSimulationPolicy: "stop without resizing; no Setpoint-style liquidity backoff",
      targetRegion: "totalDrift <= deployed driftThreshold"
    },
    scenario: definition,
    fork: { sourceBlockNumber: sourceBlock.number, sourceBlockHash: sourceBlock.hash, sourceTimestamp: sourceBlock.timestamp },
    setupTransactions,
    poolContext: pools.filter(({ symbol }) => definition.focusAssets.includes(symbol)),
    guards,
    attemptedCycleCount,
    successfulCycleCount,
    stepsToTargetRegion: targetRegionReached ? successfulCycleCount : null,
    cumulativeTurnover,
    cumulativeTurnoverOverInitialNav: cycles[0] ? cumulativeTurnover * WAD / BigInt(cycles[0].stateBefore.nav) : 0n,
    targetRegionReached,
    outcome: targetRegionReached ? "target-region-reached" : cycles.at(-1)?.simulationPass === false ? "simulation-failed" : "max-cycles-or-no-plan",
    cycles,
    finalState: summarizeState(finalState),
    limitations: [
      "Liquidity labels are relative descriptions of the deployed toy pools, not production market classifications.",
      "Pool inventory is recorded as context only; the static planner does not consume depth or quotes.",
      "Exact onchain target weights are represented as zero-width target ranges for baseline reporting."
    ]
  };
}

function definitions(): ScenarioDefinition[] {
  const p = (percent: number) => BigInt(percent) * WAD / 100n;
  const bps = (basisPoints: number) => BigInt(basisPoints) * WAD / 10_000n;
  return [
    {
      id: "moderate-drift-deep-toy",
      title: "Moderate drift against relatively deep toy liquidity",
      rationale: "Moves approximately 10% target weight from AMD to TSLA while declaring a 2% operational cash target. TSLA and AMD have the largest oracle-valued pool inventory proxies in this deployment.",
      weights: [bps(2940), bps(1960), bps(1960), bps(1960), bps(980)],
      cashTarget: p(2),
      liquidityClass: "relatively-deep-toy",
      focusAssets: ["TSLA", "AMD"],
      maxCycles: 8
    },
    {
      id: "moderate-drift-thin-toy",
      title: "Moderate drift against thin toy liquidity",
      rationale: "Moves approximately 10% target weight from AMD to NFLX with the same 2% operational cash target. NFLX has the smallest oracle-valued pool inventory proxy in this deployment.",
      weights: [bps(1960), bps(1960), bps(1960), bps(2940), bps(980)],
      cashTarget: p(2),
      liquidityClass: "thin-toy",
      focusAssets: ["NFLX", "AMD"],
      maxCycles: 8
    },
    {
      id: "asymmetric-liquidity",
      title: "Asymmetric liquidity across desired buys",
      rationale: "Moves approximately 10% target weight out of AMD and splits it between relatively deeper TSLA and thinner NFLX, with the same 2% operational cash target.",
      weights: [bps(2450), bps(1960), bps(1960), bps(2450), bps(980)],
      cashTarget: p(2),
      liquidityClass: "asymmetric-toy",
      focusAssets: ["TSLA", "NFLX", "AMD"],
      maxCycles: 8
    },
    {
      id: "large-target-change",
      title: "Target change too large for one safe static batch",
      rationale: "Raises NFLX to 49%, reduces TSLA, AMZN, and PLTR to 9.8% each, keeps AMD near 20%, and declares the same 2% cash target. Static 10%-NAV chunks are submitted without depth-aware resizing.",
      weights: [bps(980), bps(980), bps(980), bps(4900), bps(1960)],
      cashTarget: p(2),
      liquidityClass: "large-change",
      focusAssets: ["NFLX"],
      maxCycles: 8
    },
    {
      id: "defensive-cash-target",
      title: "Defensive cash-target increase",
      rationale: "Changes the mandate from fully invested to 20% cash and 16% per stock, requiring sells only.",
      weights: [p(16), p(16), p(16), p(16), p(16)],
      cashTarget: p(20),
      liquidityClass: "defensive",
      focusAssets: ["TSLA", "AMZN", "PLTR", "NFLX", "AMD"],
      maxCycles: 8
    }
  ];
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const sourceBlock = await client.getBlock();
  const { assets, baseAsset, adapter, guards } = await validateDeployment();
  const outputDirectory = resolve(process.cwd(), "artifacts/baseline");
  mkdirSync(outputDirectory, { recursive: true });

  const stale = await staleScenario(assets, guards, sourceBlock);
  writeFileSync(resolve(outputDirectory, "stale-oracle.json"), `${JSON.stringify(jsonValue(stale), null, 2)}\n`);
  console.log("[scenario:stale-oracle] no-trade STALE_ORACLE (expected)");

  const pools = await refreshAndSync(assets, baseAsset, adapter);
  console.log(`[prepare] refreshed oracle timestamps and synchronized ${pools.length} deployed pools`);
  let readySnapshot = await testClient.snapshot();
  const results = [];
  const scenarioDefinitions = definitions();
  for (let index = 0; index < scenarioDefinitions.length; index++) {
    if (index > 0) {
      await testClient.revert({ id: readySnapshot });
      readySnapshot = await testClient.snapshot();
    }
    const definition = scenarioDefinitions[index];
    assert(definition, `missing scenario ${index}`);
    const result = await runScenario(definition, assets, baseAsset, guards, pools, sourceBlock);
    results.push(result);
    writeFileSync(resolve(outputDirectory, `${definition.id}.json`), `${JSON.stringify(jsonValue(result), null, 2)}\n`);
    const lastCycle = result.cycles.at(-1);
    const suffix = lastCycle?.revertClass ? ` ${lastCycle.revertClass}` : "";
    console.log(`[scenario:${definition.id}] ${result.outcome}; attempts=${result.attemptedCycleCount}; successes=${result.successfulCycleCount}; finalDrift=${result.finalState.driftFormatted}${suffix}`);
  }

  const allResults = [stale, ...results];
  const summary = {
    schemaVersion: 1,
    benchmark: "truthful-static-baseline",
    startedAt,
    completedAt: new Date().toISOString(),
    upstream: config.upstream,
    network: { name: config.network, chainId: config.chainId },
    fork: { sourceBlockNumber: sourceBlock.number, sourceBlockHash: sourceBlock.hash, sourceTimestamp: sourceBlock.timestamp },
    contracts: { ...config.contracts, baseAsset, swapAdapter: adapter },
    guards,
    poolContext: pools,
    scenarioCount: allResults.length,
    results: allResults.map((result) => ({
      id: result.scenario.id,
      outcome: result.outcome,
      attemptedCycleCount: result.attemptedCycleCount,
      successfulCycleCount: result.successfulCycleCount,
      stepsToTargetRegion: result.stepsToTargetRegion,
      cumulativeTurnover: result.cumulativeTurnover,
      cumulativeTurnoverOverInitialNav: "cumulativeTurnoverOverInitialNav" in result
        ? result.cumulativeTurnoverOverInitialNav
        : 0n,
      targetRegionReached: result.targetRegionReached,
      initialDrift: "cycles" in result && result.cycles[0] ? result.cycles[0].stateBefore.drift : null,
      finalDrift: "finalState" in result ? result.finalState.drift : null,
      failureClass: "noTradeReason" in result ? result.noTradeReason : result.cycles.at(-1)?.revertClass ?? null
    })),
    claims: {
      performanceComparisonMade: false,
      adaptiveSolverIncluded: false,
      note: "M2 records the control group only. No Setpoint performance claim is made."
    }
  };
  const summaryPath = resolve(process.cwd(), "artifacts/baseline-summary.json");
  writeFileSync(summaryPath, `${JSON.stringify(jsonValue(summary), null, 2)}\n`);
  console.log(`[summary] ${summaryPath}`);
}

main().catch((error) => {
  console.error(errorText(error));
  process.exitCode = 1;
});
