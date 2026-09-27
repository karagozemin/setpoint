import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const liveApp = readFileSync("web/live/LiveApp.tsx", "utf8");
const liveAdapter = readFileSync("src/live/rwa-index-live-adapter.ts", "utf8");
const integrationCatalog = readFileSync("src/live/integration-catalog.ts", "utf8");
const integrationAdapters = readFileSync("src/live/integration-read-adapters.ts", "utf8");
const liveConfig = readFileSync("src/live/config.ts", "utf8");
const router = readFileSync("web/Router.tsx", "utf8");
const vercelConfig = readFileSync("vercel.json", "utf8");
const viteConfig = readFileSync("vite.config.mts", "utf8");

test("product exposes landing, app and evidence as distinct routes", () => {
  assert.match(router, /path === "\/"/);
  assert.match(router, /path === "\/app"/);
  assert.match(router, /path === "\/evidence"/);
});

test("live product does not import historical scenarios or artifacts", () => {
  assert.doesNotMatch(liveApp, /data\/scenarios|artifacts\/|evidence\//);
  assert.doesNotMatch(liveAdapter, /data\/scenarios|artifacts\/|evidence\//);
});

test("multi-vault registry keeps read compatibility separate from execution", () => {
  assert.match(integrationCatalog, /hiss-v2/);
  assert.match(integrationCatalog, /fides-frontier/);
  assert.match(integrationCatalog, /wield-rwa/);
  assert.match(integrationCatalog, /vimen-agentic-mag7/);
  assert.match(integrationCatalog, /mag7-index/);
  assert.match(integrationCatalog, /PLANNING_AND_SIMULATION/);
  assert.match(integrationCatalog, /LIVE_COMPATIBILITY/);
  assert.match(integrationAdapters, /Setpoint will not fabricate|does not reconstruct an authoritative replacement/);
  assert.match(integrationAdapters, /feedsFresh/);
  assert.match(integrationAdapters, /isFullyBacked/);
  assert.match(liveApp, /Read-only vault report/);
  assert.match(liveApp, /Why is there no rebalance button/);
  assert.match(liveApp, /Open the RWA Index testnet workflow/);
});

test("live analysis invokes the adapter and shows explicit provenance", () => {
  assert.match(liveApp, /adapter\.analyzeRebalance/);
  assert.match(liveApp, /LIVE RPC/);
  assert.match(liveAdapter, /simulateContract/);
  assert.match(liveAdapter, /this\.client\.getBlock\(\{ blockTag: "latest" \}\)/);
});

test("wallet execution is authorization gated and re-simulated", () => {
  assert.match(liveAdapter, /if \(!before\.authorization\.canExecute\)/);
  assert.match(liveAdapter, /await this\.client\.simulateContract/);
  assert.match(liveAdapter, /waitForTransactionReceipt/);
  assert.match(liveAdapter, /const after = await this\.readVaultState/);
});

test("selected vault and proposed allocation survive refresh", () => {
  assert.match(liveApp, /searchParams\.set\("vault"/);
  assert.match(liveApp, /localStorage\.setItem\(`setpoint:allocation:/);
  assert.match(liveApp, /localStorage\.getItem\(`setpoint:allocation:/);
});

test("RPC failures are not represented as NO_TRADE", () => {
  assert.match(liveApp, /context === "read"\) return \{ kind: "RPC_ERROR"/);
  assert.match(liveAdapter, /if \(state\.staleAssets\.length > 0\)/);
  assert.match(liveAdapter, /return noTrade\(state, "STALE_PRICE"/);
});

test("browser RPC reads use fixed same-origin pass-through routes", () => {
  assert.match(liveConfig, /typeof window === "undefined"[^\n]+"\/rpc\/mainnet"/);
  assert.match(liveConfig, /typeof window === "undefined"[^\n]+"\/rpc\/testnet"/);
  assert.match(viteConfig, /"\/rpc\/mainnet"/);
  assert.match(viteConfig, /"\/rpc\/testnet"/);
  assert.match(vercelConfig, /"\/rpc\/mainnet"/);
  assert.match(vercelConfig, /"\/rpc\/testnet"/);
});
