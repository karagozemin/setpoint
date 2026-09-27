import assert from "node:assert/strict";
import test from "node:test";
import { integrationForAddress, liveIntegrations } from "./integration-catalog.js";

test("live registry contains four unique exact-address integrations", () => {
  assert.equal(liveIntegrations.length, 4);
  assert.equal(new Set(liveIntegrations.map(({ id }) => id)).size, 4);
  assert.equal(new Set(liveIntegrations.map(({ vault }) => vault.toLowerCase())).size, 4);
  for (const integration of liveIntegrations) {
    assert.equal(integrationForAddress(integration.vault)?.id, integration.id);
    assert.match(integration.sourceCommit, /^[0-9a-f]{40}$/);
  }
});

test("only RWA Index declares planning and simulation capability", () => {
  const planning = liveIntegrations.filter(({ capability }) => capability === "PLANNING_AND_SIMULATION");
  assert.deepEqual(planning.map(({ id }) => id), ["rwa-index"]);
  assert.equal(planning[0]?.chainId, 46_630);
  assert.ok(liveIntegrations.filter(({ chainId }) => chainId === 4_663).every(({ capability }) => capability === "LIVE_COMPATIBILITY"));
});

test("arbitrary ERC-4626 addresses are not treated as supported", () => {
  assert.equal(integrationForAddress("0x0000000000000000000000000000000000000001"), null);
  assert.equal(integrationForAddress("not-an-address"), null);
});
