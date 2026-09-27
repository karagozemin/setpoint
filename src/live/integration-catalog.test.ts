import assert from "node:assert/strict";
import test from "node:test";
import { integrationForAddress, liveIntegrations } from "./integration-catalog.js";

test("live registry contains six unique exact-address integrations", () => {
  assert.equal(liveIntegrations.length, 6);
  assert.equal(new Set(liveIntegrations.map(({ id }) => id)).size, 6);
  assert.equal(new Set(liveIntegrations.map(({ vault }) => vault.toLowerCase())).size, 6);
  for (const integration of liveIntegrations) {
    assert.equal(integrationForAddress(integration.vault)?.id, integration.id);
    assert.match(integration.sourceCommit, /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
  }
});

test("only RWA Index declares planning and simulation capability", () => {
  const planning = liveIntegrations.filter(({ capability }) => capability === "PLANNING_AND_SIMULATION");
  assert.deepEqual(planning.map(({ id }) => id), ["rwa-index"]);
  assert.equal(planning[0]?.chainId, 46_630);
  assert.ok(liveIntegrations.filter(({ chainId }) => chainId === 4_663).every(({ capability }) => capability === "LIVE_COMPATIBILITY"));
});

test("funded priority candidates remain separate from empty watchlist deployments", () => {
  assert.equal(liveIntegrations.find(({ id }) => id === "vimen-agentic-mag7")?.registryTier, "PRIMARY");
  assert.equal(liveIntegrations.find(({ id }) => id === "mag7-index")?.registryTier, "SECONDARY");
  assert.equal(liveIntegrations.find(({ id }) => id === "wield-rwa")?.registryTier, "SECONDARY");
});

test("arbitrary ERC-4626 addresses are not treated as supported", () => {
  assert.equal(integrationForAddress("0x0000000000000000000000000000000000000001"), null);
  assert.equal(integrationForAddress("not-an-address"), null);
});
