import { mkdir, writeFile } from "node:fs/promises";
import { buildSecuritySuite, validateSecuritySuite } from "../security/evidence.js";

const outputDirectory = "artifacts/security";

async function main(): Promise<void> {
  const suite = await buildSecuritySuite();
  validateSecuritySuite(suite);

  await mkdir(outputDirectory, { recursive: true });
  for (const [fileName, artifact] of Object.entries(suite.artifacts)) {
    await writeFile(`${outputDirectory}/${fileName}`, `${JSON.stringify(artifact, null, 2)}\n`);
  }
  await writeFile(`${outputDirectory}/security-summary.json`, `${JSON.stringify(suite.summary, null, 2)}\n`);

  console.log(`Security evidence: ${Object.keys(suite.artifacts).length} scenarios`);
  console.log(`Security invariants: ${suite.summary.invariants.length}/${suite.summary.invariants.length} held`);
  console.log(`M2 planner SHA-256: ${suite.summary.sourceIntegrity.m2PlannerSha256}`);
  console.log(`Artifacts: ${outputDirectory}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
