import { liveIntegrations } from "../src/live/integration-catalog.js";
import { readIntegrationPreview, readIntegrationSnapshot } from "../src/live/integration-read-adapters.js";

async function main(): Promise<void> {
  const results = [];
  for (const integration of liveIntegrations) {
    const preview = await readIntegrationPreview(integration.id);
    const snapshot = integration.id === "rwa-index" ? null : await readIntegrationSnapshot(integration.id);
    if (preview.blockNumber <= 0n) throw new Error(`${integration.name}: invalid block provenance.`);
    if (snapshot && snapshot.checks.some((check) => check.label === "Verified contract surface" && check.status !== "PASS")) {
      throw new Error(`${integration.name}: contract-surface check did not pass.`);
    }
    results.push({
      id: integration.id,
      chainId: integration.chainId,
      vault: integration.vault,
      blockNumber: preview.blockNumber.toString(),
      status: preview.status,
      label: preview.statusLabel,
      primaryMetric: preview.primaryMetric,
      capability: integration.capability,
    });
  }
  process.stdout.write(`${JSON.stringify({ checkedAt: new Date().toISOString(), integrations: results }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
