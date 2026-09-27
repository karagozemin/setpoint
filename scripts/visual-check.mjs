import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.SETPOINT_VISUAL_BASE_URL ?? "http://localhost:5173";
const browser = await chromium.launch({ headless: true });
const bypass = process.env.VERCEL_PROTECTION_BYPASS;
const pageOptions = (viewport, extra = {}) => ({
  viewport,
  ...extra,
  extraHTTPHeaders: bypass ? { "x-vercel-protection-bypass": bypass } : undefined,
});

try {
  const desktop = await browser.newPage(pageOptions({ width: 1440, height: 1000 }));
  await desktop.goto(baseUrl, { waitUntil: "networkidle" });
  await desktop.getByRole("heading", { name: /Rebalance the vault/i }).waitFor();
  assert.equal(await desktop.getByRole("link", { name: /Open Setpoint/i }).first().getAttribute("href"), "/app");
  await desktop.screenshot({ path: "docs/images/m6-landing-desktop.png", fullPage: true });

  await desktop.goto(`${baseUrl}/app`, { waitUntil: "networkidle" });
  await desktop.getByRole("heading", { name: /Your vault\. Your targets\. A real rebalance/i }).waitFor();
  assert.equal(await desktop.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth), true, "sandbox home has horizontal overflow");
  await desktop.screenshot({ path: "docs/images/sandbox-execute-desktop.png", fullPage: true });

  await desktop.goto(`${baseUrl}/app/vault/rwa-index`, { waitUntil: "networkidle" });
  await desktop.locator(".operator-grid").waitFor();
  await desktop.getByText("LIVE RPC", { exact: true }).first().waitFor();
  await desktop.getByText("Wallet disconnected", { exact: true }).waitFor();
  await desktop.screenshot({ path: "docs/images/m6-live-vault.png", fullPage: true });
  await desktop.getByRole("button", { name: "Analyze rebalance" }).click();
  await desktop.locator(".analysis-result").waitFor();
  await desktop.getByRole("heading", { name: "NO_TRADE" }).waitFor();
  await desktop.locator(".analysis-result").screenshot({ path: "docs/images/m6-analysis-result.png" });

  await desktop.goto(`${baseUrl}/evidence`, { waitUntil: "networkidle" });
  await desktop.locator(".summary-strip").waitFor();
  await desktop.getByText("Historical fork + deterministic integration tests", { exact: true }).waitFor();
  await desktop.screenshot({ path: "docs/images/m6-evidence.png", fullPage: true });

  const mobile = await browser.newPage(pageOptions({ width: 390, height: 844 }, { isMobile: true }));
  await mobile.goto(baseUrl, { waitUntil: "networkidle" });
  await mobile.getByRole("heading", { name: /Rebalance the vault/i }).waitFor();
  assert.equal(await mobile.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth), true, "landing has horizontal overflow");
  await mobile.screenshot({ path: "docs/images/m6-mobile.png", fullPage: true });

  await mobile.goto(`${baseUrl}/app`, { waitUntil: "networkidle" });
  await mobile.getByRole("heading", { name: /Your vault\. Your targets\. A real rebalance/i }).waitFor();
  assert.equal(await mobile.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth), true, "sandbox mobile has horizontal overflow");
  await mobile.screenshot({ path: "docs/images/sandbox-execute-mobile.png", fullPage: true });

  const failedRpc = await browser.newPage(pageOptions({ width: 1280, height: 800 }));
  await failedRpc.route("**/rpc/testnet", (route) => route.abort("failed"));
  await failedRpc.goto(`${baseUrl}/app/vault/rwa-index`, { waitUntil: "networkidle" });
  await failedRpc.getByText("RPC ERROR", { exact: true }).waitFor();
  assert.equal(await failedRpc.getByText("NO_TRADE", { exact: true }).count(), 0, "RPC error rendered as NO_TRADE");

  console.log(`Visual routes passed at ${baseUrl}`);
  console.log("Screenshots: landing desktop/mobile, sandbox desktop/mobile, live vault, analysis result, evidence");
  console.log("States: wallet disconnected, live stale-oracle NO_TRADE, forced RPC error");
} finally {
  await browser.close();
}
