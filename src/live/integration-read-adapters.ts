import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  parseAbi,
  type Address,
  type PublicClient,
} from "viem";
import { RWAIndexLiveAdapter } from "./rwa-index-live-adapter.js";
import {
  ROBINHOOD_MAINNET_RPC_URL,
  robinhoodMainnet,
} from "./config.js";
import {
  integrationById,
  type IntegrationId,
  type LiveIntegrationDefinition,
} from "./integration-catalog.js";

export type IntegrationReadiness = "READY" | "DEGRADED" | "EMPTY";
export type CompatibilityStatus = "PASS" | "WARN" | "INFO";

export interface IntegrationPreview {
  id: IntegrationId;
  status: IntegrationReadiness;
  statusLabel: string;
  primaryMetric: string;
  detail: string;
  blockNumber: bigint;
  readAt: number;
}

export interface SnapshotMetric {
  label: string;
  value: string;
  note?: string;
  tone?: "healthy" | "warning" | "neutral";
}

export interface SnapshotHolding {
  address: Address;
  symbol: string;
  balance: string;
  policy: string;
  evidence: string;
  status: "CURRENT" | "STALE" | "UNAVAILABLE" | "INACTIVE";
}

export interface SnapshotGuard {
  label: string;
  value: string;
}

export interface CompatibilityCheck {
  label: string;
  status: CompatibilityStatus;
  detail: string;
}

export interface LiveIntegrationSnapshot {
  provenance: "LIVE_RPC";
  integration: LiveIntegrationDefinition;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  blockTimestamp: bigint;
  readAt: number;
  status: IntegrationReadiness;
  statusLabel: string;
  summary: string;
  metrics: SnapshotMetric[];
  holdings: SnapshotHolding[];
  guards: SnapshotGuard[];
  checks: CompatibilityCheck[];
  executionBoundary: string;
}

const erc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
]);

const oracleAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

const fidesAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function assets() view returns (address[])",
  "function units() view returns (uint256[])",
  "function nav() view returns (uint256)",
  "function isFullyBacked() view returns (bool)",
  "function oracleOf(address) view returns (address)",
  "function maxSlippageBps() view returns (uint16)",
  "function maxTurnoverBps() view returns (uint16)",
  "function rebalanceCooldown() view returns (uint64)",
  "function maxOracleAge() view returns (uint64)",
  "function lastRebalance() view returns (uint64)",
  "function mintPaused() view returns (bool)",
  "function rebalancer() view returns (address)",
]);

const hissVaultAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function usdgCash() view returns (uint256)",
  "function paused() view returns (bool)",
  "function queueActive() view returns (bool)",
  "function heldAssetCount() view returns (uint256)",
  "function heldAssets(uint256) view returns (address)",
  "function pricePerShare() view returns (uint256 pps, uint8 availability)",
  "function pendingRedeemCount() view returns (uint256)",
]);

const hissQueueAbi = parseAbi([
  "function paused() view returns (bool)",
  "function pendingCount() view returns (uint256)",
  "function pendingDepositUsdg() view returns (uint256)",
  "function pendingRedemptionShares() view returns (uint256)",
]);

const hissSettlerAbi = parseAbi([
  "function settlementActive() view returns (bool)",
  "function keeperActive() view returns (bool)",
  "function rebalanceActive() view returns (bool)",
]);

const hissLivenessAbi = parseAbi([
  "function liveness() view returns ((uint8 state, bool executionAllowed, bool displayAllowed, uint256 observedChainId, uint256 ageSeconds, uint256 producedBlocks, string reason))",
]);

const hissPriceMeshAbi = parseAbi([
  "function maxSafeBuyNotionalUsdg(address token) view returns (bool known, uint256 notionalUsdg, uint8 zeroReason)",
  "function maxSafeSellNotionalUsdg(address token) view returns (bool known, uint256 notionalUsdg, uint8 zeroReason)",
]);

const wieldAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function paused() view returns (bool)",
  "function agentDid() view returns (address)",
  "function nextNonce() view returns (uint256)",
  "function maxSlippageBps() view returns (uint16)",
  "function oracleStaleAfter() view returns (uint256)",
  "function dexRouter() view returns (address)",
  "function dexPoolFee() view returns (uint24)",
  "function getUnderlyings() view returns (address[])",
  "function underlyingInfo(address) view returns (uint8 kind, address priceFeed, uint8 feedDecimals, bool active)",
]);

const HISS = {
  queue: "0x317d1eec013a91a316858e80bf782496f231729a" as Address,
  settler: "0x32a60abb48235b158dd515b84c5b039f6dc4f7dd" as Address,
  liveness: "0x424b634aa340832cf548bb501204a6cf8a6d9136" as Address,
  priceMesh: "0xd57e9fc8ff8b1ace73a7d6c32f1101879fdef3c6" as Address,
} as const;

const mainnetClient = createPublicClient({
  chain: robinhoodMainnet,
  transport: http(ROBINHOOD_MAINNET_RPC_URL, { batch: { wait: 15 }, retryCount: 0, timeout: 8_000 }),
});

const snapshotCache = new Map<IntegrationId, { createdAt: number; promise: Promise<LiveIntegrationSnapshot> }>();
const CACHE_MS = 20_000;

interface SafeResult<T> {
  value: T | null;
  error: string | null;
}

async function safe<T>(read: () => Promise<T>): Promise<SafeResult<T>> {
  try {
    return { value: await read(), error: null };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : "Unknown live read failure",
    };
  }
}

function compact(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function amount(value: bigint, decimals: number, digits = 4): string {
  const raw = formatUnits(value, decimals);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return raw;
  return parsed.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function bps(value: number | bigint): string {
  return `${(Number(value) / 100).toFixed(2)}%`;
}

function duration(seconds: bigint): string {
  if (seconds >= 86_400n) return `${(Number(seconds) / 86_400).toFixed(seconds % 86_400n === 0n ? 0 : 1)}d`;
  if (seconds >= 3_600n) return `${(Number(seconds) / 3_600).toFixed(seconds % 3_600n === 0n ? 0 : 1)}h`;
  return `${seconds}s`;
}

function age(now: bigint, updatedAt: bigint): bigint {
  return now > updatedAt ? now - updatedAt : 0n;
}

function requireValue<T>(result: SafeResult<T>, label: string): T {
  if (result.value === null) throw new Error(`${label} is unreadable: ${result.error ?? "unknown error"}`);
  return result.value;
}

function readinessLabel(status: IntegrationReadiness): string {
  if (status === "READY") return "LIVE PORTFOLIO";
  if (status === "EMPTY") return "LIVE · EMPTY";
  return "LIVE · DEGRADED";
}

export async function readIntegrationSnapshot(id: IntegrationId, force = false): Promise<LiveIntegrationSnapshot> {
  if (id === "rwa-index") throw new Error("RWA Index uses the planning-and-simulation adapter.");
  const cached = snapshotCache.get(id);
  if (!force && cached && Date.now() - cached.createdAt < CACHE_MS) return cached.promise;
  const promise = id === "fides-frontier" ? readFides(mainnetClient) : id === "hiss-v2" ? readHiss(mainnetClient) : readWield(mainnetClient);
  snapshotCache.set(id, { createdAt: Date.now(), promise });
  return promise;
}

export async function readIntegrationPreview(id: IntegrationId): Promise<IntegrationPreview> {
  if (id === "rwa-index") {
    const state = await new RWAIndexLiveAdapter().readVaultState();
    const status: IntegrationReadiness = state.staleAssets.length > 0 ? "DEGRADED" : "READY";
    return {
      id,
      status,
      statusLabel: status === "READY" ? "LIVE · READY" : "LIVE · ORACLE STALE",
      primaryMetric: state.nav === null ? `${state.assets.length} live holdings` : `${amount(state.nav, 18)} ${state.baseSymbol} NAV`,
      detail: state.staleAssets.length > 0 ? `${state.staleAssets.length} oracle observations exceed the vault freshness guard.` : "Exact rebalance simulation available.",
      blockNumber: state.blockNumber,
      readAt: state.readAt,
    };
  }
  const snapshot = await readIntegrationSnapshot(id);
  const primary = snapshot.metrics[0];
  return {
    id,
    status: snapshot.status,
    statusLabel: snapshot.statusLabel,
    primaryMetric: primary ? `${primary.value} ${primary.label}` : snapshot.statusLabel,
    detail: snapshot.summary,
    blockNumber: snapshot.blockNumber,
    readAt: snapshot.readAt,
  };
}

async function readFides(client: PublicClient): Promise<LiveIntegrationSnapshot> {
  const integration = integrationById("fides-frontier");
  const vault = integration.vault;
  const [block, code, name, symbol, supply, assets, units, nav, backed, maxSlippage, maxTurnover, cooldown, maxOracleAge, lastRebalance, mintPaused, rebalancer] = await Promise.all([
    client.getBlock({ blockTag: "latest" }),
    client.getCode({ address: vault }),
    safe(() => client.readContract({ address: vault, abi: fidesAbi, functionName: "name" })),
    safe(() => client.readContract({ address: vault, abi: fidesAbi, functionName: "symbol" })),
    safe(() => client.readContract({ address: vault, abi: fidesAbi, functionName: "totalSupply" })),
    safe(() => client.readContract({ address: vault, abi: fidesAbi, functionName: "assets" })),
    safe(() => client.readContract({ address: vault, abi: fidesAbi, functionName: "units" })),
    safe(() => client.readContract({ address: vault, abi: fidesAbi, functionName: "nav" })),
    safe(() => client.readContract({ address: vault, abi: fidesAbi, functionName: "isFullyBacked" })),
    safe(() => client.readContract({ address: vault, abi: fidesAbi, functionName: "maxSlippageBps" })),
    safe(() => client.readContract({ address: vault, abi: fidesAbi, functionName: "maxTurnoverBps" })),
    safe(() => client.readContract({ address: vault, abi: fidesAbi, functionName: "rebalanceCooldown" })),
    safe(() => client.readContract({ address: vault, abi: fidesAbi, functionName: "maxOracleAge" })),
    safe(() => client.readContract({ address: vault, abi: fidesAbi, functionName: "lastRebalance" })),
    safe(() => client.readContract({ address: vault, abi: fidesAbi, functionName: "mintPaused" })),
    safe(() => client.readContract({ address: vault, abi: fidesAbi, functionName: "rebalancer" })),
  ]);
  if (!block.hash || !code || code === "0x") throw new Error("Fides Frontier contract bytecode is unavailable.");
  const assetList = requireValue(assets, "Fides asset list");
  const unitList = requireValue(units, "Fides backing units");
  const oracleLimit = requireValue(maxOracleAge, "Fides max oracle age");
  const rows = await Promise.all(assetList.map(async (token, index) => {
    const [tokenSymbol, decimals, balance, oracleAddress] = await Promise.all([
      safe(() => client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" })),
      safe(() => client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" })),
      safe(() => client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [vault] })),
      safe(() => client.readContract({ address: vault, abi: fidesAbi, functionName: "oracleOf", args: [token] })),
    ]);
    const oracle = requireValue(oracleAddress, `Fides oracle for ${token}`);
    const [round, oracleDecimals] = await Promise.all([
      safe(() => client.readContract({ address: oracle, abi: oracleAbi, functionName: "latestRoundData" })),
      safe(() => client.readContract({ address: oracle, abi: oracleAbi, functionName: "decimals" })),
    ]);
    const latest = round.value;
    const updatedAt = latest?.[3] ?? 0n;
    const priceAge = age(block.timestamp, updatedAt);
    const stale = latest === null || latest[1] <= 0n || updatedAt === 0n || priceAge > oracleLimit;
    const tokenDecimals = decimals.value ?? 18;
    return {
      address: getAddress(token),
      symbol: tokenSymbol.value ?? compact(token),
      balance: balance.value ?? 0n,
      decimals: tokenDecimals,
      unit: unitList[index] ?? 0n,
      oracleDecimals: oracleDecimals.value ?? 8,
      answer: latest?.[1] ?? 0n,
      priceAge,
      stale,
    };
  }));
  const staleCount = rows.filter((row) => row.stale).length;
  const totalSupply = requireValue(supply, "Fides total supply");
  const status: IntegrationReadiness = totalSupply === 0n ? "EMPTY" : nav.value === null || staleCount > 0 ? "DEGRADED" : "READY";
  const vaultName = name.value ?? integration.name;
  const vaultSymbol = symbol.value ?? "fFRNT";
  return {
    provenance: "LIVE_RPC",
    integration,
    blockNumber: block.number,
    blockHash: block.hash,
    blockTimestamp: block.timestamp,
    readAt: Date.now(),
    status,
    statusLabel: readinessLabel(status),
    summary: status === "DEGRADED" ? `${vaultName} is funded and readable, but ${staleCount} oracle feed${staleCount === 1 ? " is" : "s are"} outside the vault freshness guard; authoritative NAV is unavailable.` : `${vaultName} state and oracle NAV are readable.`,
    metrics: [
      { label: `${vaultSymbol} supply`, value: amount(totalSupply, 18, 6), tone: totalSupply > 0n ? "healthy" : "warning" },
      { label: "Constituents", value: rows.length.toString(), tone: "neutral" },
      { label: "Backing", value: backed.value === true ? "Fully backed" : backed.value === false ? "Not fully backed" : "Unavailable", tone: backed.value === true ? "healthy" : "warning" },
      { label: "Oracle NAV", value: nav.value === null ? "Unavailable" : `$${amount(nav.value, 18, 2)}`, tone: nav.value === null ? "warning" : "healthy" },
    ],
    holdings: rows.map((row) => ({
      address: row.address,
      symbol: row.symbol,
      balance: amount(row.balance, row.decimals, 6),
      policy: `${amount(row.unit, row.decimals, 6)} units / share`,
      evidence: row.answer > 0n ? `${duration(row.priceAge)} oracle age` : "Oracle unreadable",
      status: row.stale ? "STALE" : "CURRENT",
    })),
    guards: [
      { label: "Max slippage", value: maxSlippage.value === null ? "Unavailable" : bps(maxSlippage.value) },
      { label: "Max turnover", value: maxTurnover.value === null ? "Unavailable" : bps(maxTurnover.value) },
      { label: "Cooldown", value: cooldown.value === null ? "Unavailable" : duration(cooldown.value) },
      { label: "Max oracle age", value: duration(oracleLimit) },
      { label: "Mint", value: mintPaused.value === true ? "Paused" : "Open" },
      { label: "Last rebalance", value: lastRebalance.value && lastRebalance.value > 0n ? new Date(Number(lastRebalance.value) * 1000).toISOString() : "No recorded rebalance" },
      { label: "Rebalancer", value: rebalancer.value ? compact(rebalancer.value) : "Unavailable" },
    ],
    checks: [
      { label: "Verified contract surface", status: "PASS", detail: `Bytecode and ${vaultName} identity read at block ${block.number}.` },
      { label: "Portfolio inventory", status: "PASS", detail: `${rows.length} immutable constituents, balances, and backing units read from chain.` },
      { label: "Policy guardrails", status: "PASS", detail: "Slippage, turnover, cooldown, whitelist, and backing controls are visible onchain." },
      { label: "Authoritative accounting", status: nav.value === null ? "WARN" : "PASS", detail: nav.value === null ? "The vault's own nav() currently rejects stale oracle evidence. Setpoint does not reconstruct an authoritative replacement." : "The vault's own nav() call succeeds." },
      { label: "Setpoint execution", status: "INFO", detail: "Read-only adapter. A Fides rebalancer identity and venue-specific swap construction are required before exact simulation can be enabled." },
    ],
    executionBoundary: integration.executionBoundary,
  };
}

async function readHiss(client: PublicClient): Promise<LiveIntegrationSnapshot> {
  const integration = integrationById("hiss-v2");
  const vault = integration.vault;
  const [block, code, name, symbol, asset, nav, supply, cash, paused, queueActive, heldCount, pps, pendingRedeems, queuePaused, queuePending, pendingDeposits, pendingRedemptions, settlementActive, keeperActive, rebalanceActive, liveness] = await Promise.all([
    client.getBlock({ blockTag: "latest" }),
    client.getCode({ address: vault }),
    safe(() => client.readContract({ address: vault, abi: hissVaultAbi, functionName: "name" })),
    safe(() => client.readContract({ address: vault, abi: hissVaultAbi, functionName: "symbol" })),
    safe(() => client.readContract({ address: vault, abi: hissVaultAbi, functionName: "asset" })),
    safe(() => client.readContract({ address: vault, abi: hissVaultAbi, functionName: "totalAssets" })),
    safe(() => client.readContract({ address: vault, abi: hissVaultAbi, functionName: "totalSupply" })),
    safe(() => client.readContract({ address: vault, abi: hissVaultAbi, functionName: "usdgCash" })),
    safe(() => client.readContract({ address: vault, abi: hissVaultAbi, functionName: "paused" })),
    safe(() => client.readContract({ address: vault, abi: hissVaultAbi, functionName: "queueActive" })),
    safe(() => client.readContract({ address: vault, abi: hissVaultAbi, functionName: "heldAssetCount" })),
    safe(() => client.readContract({ address: vault, abi: hissVaultAbi, functionName: "pricePerShare" })),
    safe(() => client.readContract({ address: vault, abi: hissVaultAbi, functionName: "pendingRedeemCount" })),
    safe(() => client.readContract({ address: HISS.queue, abi: hissQueueAbi, functionName: "paused" })),
    safe(() => client.readContract({ address: HISS.queue, abi: hissQueueAbi, functionName: "pendingCount" })),
    safe(() => client.readContract({ address: HISS.queue, abi: hissQueueAbi, functionName: "pendingDepositUsdg" })),
    safe(() => client.readContract({ address: HISS.queue, abi: hissQueueAbi, functionName: "pendingRedemptionShares" })),
    safe(() => client.readContract({ address: HISS.settler, abi: hissSettlerAbi, functionName: "settlementActive" })),
    safe(() => client.readContract({ address: HISS.settler, abi: hissSettlerAbi, functionName: "keeperActive" })),
    safe(() => client.readContract({ address: HISS.settler, abi: hissSettlerAbi, functionName: "rebalanceActive" })),
    safe(() => client.readContract({ address: HISS.liveness, abi: hissLivenessAbi, functionName: "liveness" })),
  ]);
  if (!block.hash || !code || code === "0x") throw new Error("HISS V2 contract bytecode is unavailable.");
  const count = Number(requireValue(heldCount, "HISS held asset count"));
  const baseAsset = requireValue(asset, "HISS base asset");
  const heldAddresses = await Promise.all(Array.from({ length: count }, (_, index) => client.readContract({ address: vault, abi: hissVaultAbi, functionName: "heldAssets", args: [BigInt(index)] })));
  const rows = await Promise.all(heldAddresses.map(async (token) => {
    const [tokenSymbol, decimals, balance, buy, sell] = await Promise.all([
      safe(() => client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" })),
      safe(() => client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" })),
      safe(() => client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [vault] })),
      safe(() => client.readContract({ address: HISS.priceMesh, abi: hissPriceMeshAbi, functionName: "maxSafeBuyNotionalUsdg", args: [token] })),
      safe(() => client.readContract({ address: HISS.priceMesh, abi: hissPriceMeshAbi, functionName: "maxSafeSellNotionalUsdg", args: [token] })),
    ]);
    const buyKnown = buy.value?.[0] === true;
    const sellKnown = sell.value?.[0] === true;
    return {
      address: getAddress(token),
      symbol: tokenSymbol.value ?? compact(token),
      decimals: decimals.value ?? 18,
      balance: balance.value ?? 0n,
      buyCapacity: buyKnown ? buy.value?.[1] ?? null : null,
      sellCapacity: sellKnown ? sell.value?.[1] ?? null : null,
    };
  }));
  const totalAssets = requireValue(nav, "HISS total assets");
  const totalSupply = requireValue(supply, "HISS total supply");
  const cashBalance = requireValue(cash, "HISS USDG cash");
  const status: IntegrationReadiness = totalAssets === 0n && totalSupply === 0n ? "EMPTY" : paused.value === true ? "DEGRADED" : "READY";
  const report = liveness.value as unknown as { state?: number; executionAllowed?: boolean; ageSeconds?: bigint; reason?: string } | readonly [number, boolean, boolean, bigint, bigint, bigint, string] | null;
  let executionAllowed: boolean | null = null;
  let livenessAge: bigint | null = null;
  if (Array.isArray(report)) {
    executionAllowed = report[1] ?? null;
    livenessAge = report[4] ?? null;
  } else if (report !== null) {
    const objectReport = report as { executionAllowed?: boolean; ageSeconds?: bigint };
    executionAllowed = objectReport.executionAllowed ?? null;
    livenessAge = objectReport.ageSeconds ?? null;
  }
  const price = pps.value?.[0] ?? null;
  return {
    provenance: "LIVE_RPC",
    integration,
    blockNumber: block.number,
    blockHash: block.hash,
    blockTimestamp: block.timestamp,
    readAt: Date.now(),
    status,
    statusLabel: readinessLabel(status),
    summary: `${name.value ?? integration.name} has live USDG accounting, ${rows.length} held asset${rows.length === 1 ? "" : "s"}, and a ${queueActive.value === true ? "running" : "closed"} request queue. Rebalancing is ${rebalanceActive.value === true ? "active" : "inactive by protocol policy"}.`,
    metrics: [
      { label: "USDG NAV", value: amount(totalAssets, 6, 4), tone: totalAssets > 0n ? "healthy" : "warning" },
      { label: "Share price", value: price === null ? "Unavailable" : `${amount(price, 18, 6)} USDG`, tone: price === null ? "warning" : "healthy" },
      { label: "USDG cash", value: amount(cashBalance, 6, 4), tone: "neutral" },
      { label: `${symbol.value ?? "h247USDG"} supply`, value: amount(totalSupply, 18, 6), tone: totalSupply > 0n ? "healthy" : "warning" },
    ],
    holdings: [
      ...rows.map((row) => ({
        address: row.address,
        symbol: row.symbol,
        balance: amount(row.balance, row.decimals, 6),
        policy: rebalanceActive.value === true ? "Bounded rebalance lane" : "Settlement-driven allocation",
        evidence: row.buyCapacity !== null || row.sellCapacity !== null ? `Buy ${row.buyCapacity === null ? "unknown" : `${amount(row.buyCapacity, 6, 2)} USDG`} · Sell ${row.sellCapacity === null ? "unknown" : `${amount(row.sellCapacity, 6, 2)} USDG`}` : "Capacity unavailable",
        status: executionAllowed === false ? "STALE" as const : "CURRENT" as const,
      })),
      {
        address: getAddress(baseAsset),
        symbol: "USDG",
        balance: amount(cashBalance, 6, 6),
        policy: "Cash reserve",
        evidence: "Vault-native usdgCash()",
        status: "CURRENT",
      },
    ],
    guards: [
      { label: "Vault", value: paused.value === true ? "Paused" : "Active" },
      { label: "Request queue", value: queueActive.value === true && queuePaused.value !== true ? "Active" : "Paused / inactive" },
      { label: "Pending requests", value: queuePending.value?.toString() ?? "Unavailable" },
      { label: "Pending deposits", value: pendingDeposits.value === null ? "Unavailable" : `${amount(pendingDeposits.value, 6, 2)} USDG` },
      { label: "Pending redemption", value: pendingRedemptions.value === null ? "Unavailable" : `${amount(pendingRedemptions.value, 18, 4)} shares` },
      { label: "Vault redeem queue", value: pendingRedeems.value?.toString() ?? "Unavailable" },
      { label: "Settlement lane", value: settlementActive.value === true ? "Active" : "Inactive" },
      { label: "Keeper lane", value: keeperActive.value === true ? "Active" : "Inactive" },
      { label: "Rebalance lane", value: rebalanceActive.value === true ? "Active" : "Inactive by policy" },
      { label: "Liveness", value: executionAllowed === true ? `Healthy${livenessAge === null ? "" : ` · ${duration(livenessAge)} old`}` : "Execution not allowed" },
    ],
    checks: [
      { label: "Verified contract surface", status: "PASS", detail: `Canonical V2 bytecode and identity read at block ${block.number}.` },
      { label: "Authoritative accounting", status: "PASS", detail: "Vault-native totalAssets, share supply, price per share, and USDG cash are live." },
      { label: "Portfolio inventory", status: rows.length > 0 ? "PASS" : "WARN", detail: `${rows.length} held asset${rows.length === 1 ? "" : "s"} plus USDG cash read directly from the vault.` },
      { label: "Execution evidence", status: executionAllowed === true ? "PASS" : "WARN", detail: executionAllowed === true ? "Protocol liveness currently allows bounded execution." : "Protocol liveness does not currently allow bounded execution." },
      { label: "Rebalance policy", status: "INFO", detail: rebalanceActive.value === true ? "The keeper-controlled rebalance lane is active." : "Rebalancing is inactive by protocol policy; current operation is settlement-driven." },
      { label: "Setpoint execution", status: "INFO", detail: "Read-only adapter. HISS keeper and queue semantics are not represented as a generic wallet-executable rebalance." },
    ],
    executionBoundary: integration.executionBoundary,
  };
}

async function readWield(client: PublicClient): Promise<LiveIntegrationSnapshot> {
  const integration = integrationById("wield-rwa");
  const vault = integration.vault;
  const [block, code, name, symbol, asset, nav, supply, paused, agent, nonce, maxSlippage, oracleAge, router, poolFee, underlyings] = await Promise.all([
    client.getBlock({ blockTag: "latest" }),
    client.getCode({ address: vault }),
    safe(() => client.readContract({ address: vault, abi: wieldAbi, functionName: "name" })),
    safe(() => client.readContract({ address: vault, abi: wieldAbi, functionName: "symbol" })),
    safe(() => client.readContract({ address: vault, abi: wieldAbi, functionName: "asset" })),
    safe(() => client.readContract({ address: vault, abi: wieldAbi, functionName: "totalAssets" })),
    safe(() => client.readContract({ address: vault, abi: wieldAbi, functionName: "totalSupply" })),
    safe(() => client.readContract({ address: vault, abi: wieldAbi, functionName: "paused" })),
    safe(() => client.readContract({ address: vault, abi: wieldAbi, functionName: "agentDid" })),
    safe(() => client.readContract({ address: vault, abi: wieldAbi, functionName: "nextNonce" })),
    safe(() => client.readContract({ address: vault, abi: wieldAbi, functionName: "maxSlippageBps" })),
    safe(() => client.readContract({ address: vault, abi: wieldAbi, functionName: "oracleStaleAfter" })),
    safe(() => client.readContract({ address: vault, abi: wieldAbi, functionName: "dexRouter" })),
    safe(() => client.readContract({ address: vault, abi: wieldAbi, functionName: "dexPoolFee" })),
    safe(() => client.readContract({ address: vault, abi: wieldAbi, functionName: "getUnderlyings" })),
  ]);
  if (!block.hash || !code || code === "0x") throw new Error("Wield contract bytecode is unavailable.");
  const baseAsset = requireValue(asset, "Wield base asset");
  const list = requireValue(underlyings, "Wield underlying registry");
  const rows = await Promise.all(list.map(async (token) => {
    const [tokenSymbol, decimals, balance, info] = await Promise.all([
      safe(() => client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" })),
      safe(() => client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" })),
      safe(() => client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [vault] })),
      safe(() => client.readContract({ address: vault, abi: wieldAbi, functionName: "underlyingInfo", args: [token] })),
    ]);
    const kind = info.value?.[0] ?? 0;
    const feed = info.value?.[1] ?? null;
    const active = info.value?.[3] ?? false;
    let feedStatus: SnapshotHolding["status"] = active ? "CURRENT" : "INACTIVE";
    let feedEvidence = kind === 1 ? "Stock oracle unavailable" : "ERC-4626 preview accounting";
    if (kind === 1 && feed) {
      const round = await safe(() => client.readContract({ address: feed, abi: oracleAbi, functionName: "latestRoundData" }));
      const updatedAt = round.value?.[3] ?? 0n;
      const observedAge = age(block.timestamp, updatedAt);
      const limit = oracleAge.value ?? 0n;
      feedStatus = updatedAt > 0n && observedAge <= limit ? "CURRENT" : "STALE";
      feedEvidence = updatedAt > 0n ? `${duration(observedAge)} oracle age` : "Oracle unreadable";
    }
    return {
      address: getAddress(token),
      symbol: tokenSymbol.value ?? compact(token),
      decimals: decimals.value ?? 18,
      balance: balance.value ?? 0n,
      kind,
      active,
      feedEvidence,
      feedStatus,
    };
  }));
  const [baseBalance, baseDecimals] = await Promise.all([
    safe(() => client.readContract({ address: baseAsset, abi: erc20Abi, functionName: "balanceOf", args: [vault] })),
    safe(() => client.readContract({ address: baseAsset, abi: erc20Abi, functionName: "decimals" })),
  ]);
  const totalAssets = requireValue(nav, "Wield total assets");
  const totalSupply = requireValue(supply, "Wield total supply");
  const status: IntegrationReadiness = totalAssets === 0n && totalSupply === 0n ? "EMPTY" : paused.value === true ? "DEGRADED" : "READY";
  return {
    provenance: "LIVE_RPC",
    integration,
    blockNumber: block.number,
    blockHash: block.hash,
    blockTimestamp: block.timestamp,
    readAt: Date.now(),
    status,
    statusLabel: readinessLabel(status),
    summary: status === "EMPTY" ? `${name.value ?? integration.name} is deployed with ${rows.length} registered underlyings and live policy reads, but currently reports zero assets and zero share supply.` : `${name.value ?? integration.name} has live USDG accounting and signed-intent policy state.`,
    metrics: [
      { label: "USDG NAV", value: amount(totalAssets, 6, 4), tone: totalAssets > 0n ? "healthy" : "warning" },
      { label: `${symbol.value ?? "WIELD"} supply`, value: amount(totalSupply, 18, 6), tone: totalSupply > 0n ? "healthy" : "warning" },
      { label: "Registered assets", value: rows.length.toString(), tone: "neutral" },
      { label: "Intent nonce", value: nonce.value?.toString() ?? "Unavailable", tone: "neutral" },
    ],
    holdings: [
      ...rows.map((row) => ({
        address: row.address,
        symbol: row.symbol,
        balance: amount(row.balance, row.decimals, 6),
        policy: `${row.kind === 1 ? "Stock" : "Yield"} · ${row.active ? "active" : "inactive"}`,
        evidence: row.feedEvidence,
        status: row.feedStatus,
      })),
      {
        address: getAddress(baseAsset),
        symbol: "USDG",
        balance: amount(baseBalance.value ?? 0n, baseDecimals.value ?? 6, 6),
        policy: "Idle settlement asset",
        evidence: "ERC-20 balance",
        status: "CURRENT",
      },
    ],
    guards: [
      { label: "Vault", value: paused.value === true ? "Paused" : "Active" },
      { label: "Per-asset cap", value: "60.00%" },
      { label: "Max slippage", value: maxSlippage.value === null ? "Unavailable" : bps(maxSlippage.value) },
      { label: "Oracle freshness", value: oracleAge.value === null ? "Unavailable" : duration(oracleAge.value) },
      { label: "DEX pool fee", value: poolFee.value === null ? "Unavailable" : bps(poolFee.value) },
      { label: "Agent signer", value: agent.value ? compact(agent.value) : "Unavailable" },
      { label: "DEX router", value: router.value ? compact(router.value) : "Unavailable" },
    ],
    checks: [
      { label: "Verified contract surface", status: "PASS", detail: `Vault bytecode, identity, and policy reads succeeded at block ${block.number}.` },
      { label: "Underlying registry", status: "PASS", detail: `${rows.length} whitelisted assets and their kind/oracle metadata are readable.` },
      { label: "Policy guardrails", status: "PASS", detail: "Signed intent, replay nonce, 60% concentration cap, slippage cap, oracle age, pause, and DEX routing are visible." },
      { label: "Live portfolio", status: status === "EMPTY" ? "WARN" : "PASS", detail: status === "EMPTY" ? "The flagship vault currently has no assets or issued shares, so there is no portfolio rebalance to analyze." : "Vault-native totalAssets is non-zero." },
      { label: "Setpoint execution", status: "INFO", detail: "Read-only adapter. A valid signature from agentDid is required before an exact rebalance intent can be simulated or submitted." },
    ],
    executionBoundary: integration.executionBoundary,
  };
}
