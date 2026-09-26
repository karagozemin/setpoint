import assert from "node:assert/strict";
import test from "node:test";
import { RWAIndexLiveAdapter } from "./rwa-index-live-adapter.js";
import { rwaIndexLiveConfig } from "./config.js";
import type { LiveVaultState } from "./types.js";

const adapter = new RWAIndexLiveAdapter({} as never);
const asset = "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E" as const;
const state = {
  assets: [{ address: asset, symbol: "TSLA" }],
} as unknown as LiveVaultState;

test("live adapter detects only its registered vault", () => {
  assert.equal(adapter.supportsVault(rwaIndexLiveConfig.vault), true);
  assert.equal(adapter.supportsVault("0x0000000000000000000000000000000000000001"), false);
  assert.equal(adapter.supportsVault("not-an-address"), false);
});

test("allocation validation requires exactly 100%", () => {
  const result = adapter.validateAllocation(state, {
    cashWeight: 10n * 10n ** 16n,
    assetWeights: { [asset.toLowerCase()]: 80n * 10n ** 16n },
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /100%/);
});

test("allocation validation rejects unsupported and over-cap assets", () => {
  const result = adapter.validateAllocation(state, {
    cashWeight: 0n,
    assetWeights: {
      [asset.toLowerCase()]: 90n * 10n ** 16n,
      "0x0000000000000000000000000000000000000001": 10n * 10n ** 16n,
    },
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /80%/);
  assert.match(result.errors.join(" "), /Unsupported asset/);
});

test("allocation validation accepts bounded supported weights", () => {
  const result = adapter.validateAllocation(state, {
    cashWeight: 20n * 10n ** 16n,
    assetWeights: { [asset.toLowerCase()]: 80n * 10n ** 16n },
  });
  assert.deepEqual(result, { valid: true, errors: [] });
});
