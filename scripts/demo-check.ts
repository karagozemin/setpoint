import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

const outputDirectory = "dist/operator-console";
const expectedM2Sha = "dcd079ed25ff6fd7683c947fbf46748abd70862fe2a85a368c919b26fe7cee92";
const evidencePairs: Array<[string, string]> = [
  ["artifacts/m4-2-summary.json", `${outputDirectory}/evidence/m4-2-summary.json`],
  ["artifacts/hybrid/moderate-drift-deep-toy.json", `${outputDirectory}/evidence/moderate-drift-deep-toy.json`],
  ["artifacts/hybrid/large-target-change.json", `${outputDirectory}/evidence/large-target-change.json`],
  ["artifacts/hybrid/stale-oracle.json", `${outputDirectory}/evidence/stale-oracle.json`],
  ["artifacts/security/malicious-target.json", `${outputDirectory}/evidence/security/malicious-target.json`],
  ["artifacts/security/stale-oracle.json", `${outputDirectory}/evidence/security/stale-oracle.json`],
  ["artifacts/security/unknown-revert.json", `${outputDirectory}/evidence/security/unknown-revert.json`],
  ["artifacts/security/unsafe-liquidity.json", `${outputDirectory}/evidence/security/unsafe-liquidity.json`],
  ["artifacts/security/unsupported-route.json", `${outputDirectory}/evidence/security/unsupported-route.json`],
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function scanFiles(paths: string[], rules: Array<[RegExp, string]>): void {
  for (const path of paths) {
    const extension = extname(path);
    if (![".html", ".js", ".css", ".json", ".md", ".ts", ".tsx", ".mts"].includes(extension)) continue;
    const source = readFileSync(path, "utf8");
    for (const [pattern, label] of rules) {
      assert(!pattern.test(source), `${label} found in ${relative(".", path)}`);
    }
  }
}

function validateEvidenceExports(): void {
  for (const [source, emitted] of evidencePairs) {
    assert(existsSync(source), `Missing source evidence: ${source}`);
    assert(existsSync(emitted), `Missing emitted evidence: ${emitted}`);
    assert(readFileSync(source).equals(readFileSync(emitted)), `Emitted evidence differs from source: ${emitted}`);
  }
}

function validateSourceIntegrity(): void {
  assert(sha256("integrations/rwa-index/src/baseline.ts") === expectedM2Sha, "M2 planner hash changed");

  const securitySummary = JSON.parse(readFileSync("artifacts/security/security-summary.json", "utf8")) as {
    invariants: Array<{ held: boolean }>;
    allInvariantsHeld: boolean;
  };
  assert(securitySummary.invariants.length === 11, "Security invariant count changed");
  assert(securitySummary.allInvariantsHeld, "Security summary reports a failed invariant");
  assert(securitySummary.invariants.every((invariant) => invariant.held), "Security invariant failed");

  const large = JSON.parse(readFileSync("artifacts/hybrid/large-target-change.json", "utf8")) as {
    setpoint: {
      initialState: { driftFormatted: string };
      finalState: { driftFormatted: string };
      cycles: Array<{ result: { fastPath?: { trades: unknown[]; simulation?: { failureCode?: string } }; trades?: unknown[] } }>;
    };
  };
  assert(large.setpoint.initialState.driftFormatted === "31.025554%", "Large-target initial drift changed");
  assert(large.setpoint.finalState.driftFormatted === "19.113279%", "Large-target final drift changed");
  assert(large.setpoint.cycles[0]?.result.fastPath?.trades.length === 10, "Large-target fast-path leg count changed");
  assert(large.setpoint.cycles[0]?.result.fastPath?.simulation?.failureCode === "INSUFFICIENT_OUTPUT", "Large-target failure changed");
  assert(large.setpoint.cycles[0]?.result.trades?.length === 3, "Large-target safe-subset leg count changed");
}

function validatePublicSurface(): void {
  const outputFiles = filesUnder(outputDirectory);
  scanFiles(outputFiles, [
    [/\/Users\//, "Local macOS path"],
    [/file:\/\//i, "Local file URL"],
    [/\b(?:localhost|127\.0\.0\.1)\b/i, "Localhost reference"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "Private key material"],
    [/\b(?:AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{20,})\b/, "Secret-looking credential"],
  ]);

  const evidenceBrowserSources = ["web/App.tsx", ...filesUnder("web/components"), ...filesUnder("web/data")].filter((path) => !path.endsWith(".test.ts"));
  scanFiles(evidenceBrowserSources, [
    [/from\s+["']node:/, "Node-only browser import"],
    [/\b(?:child_process|eth_sendTransaction|walletClient|anvil_|\/api\/(?:execute|rebalance|mutate))\b/i, "Writable execution surface"],
    [/\/Users\//, "Local macOS path"],
    [/file:\/\//i, "Local file URL"],
  ]);

  scanFiles(["README.md", "docs/SECURITY.md", "index.html", "vite.config.mts"], [
    [/\/Users\//, "Local macOS path"],
  ]);

  const index = readFileSync(`${outputDirectory}/index.html`, "utf8");
  assert(index.includes("Setpoint — Vault Rebalance Orchestration"), "Production metadata title missing");
  assert(index.includes("Safety and execution orchestration for onchain vault rebalances"), "Production metadata description missing");
  assert(!existsSync(`${outputDirectory}/api`), "Unexpected API directory in static output");
  assert(!outputFiles.some((path) => path.endsWith(".map")), "Production source map should not be public");
  const javascriptBytes = outputFiles
    .filter((path) => path.endsWith(".js"))
    .reduce((total, path) => total + readFileSync(path).byteLength, 0);
  assert(javascriptBytes < 700_000, `Code-split JavaScript exceeds product budget: ${javascriptBytes} bytes`);
  assert(readFileSync(".gitignore", "utf8").split(/\r?\n/).includes(".env"), ".env is not ignored");

  const deployment = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    buildCommand?: string;
    outputDirectory?: string;
    headers?: unknown[];
    rewrites?: unknown[];
  };
  assert(deployment.buildCommand === "pnpm build", "Unexpected deployment build command");
  assert(deployment.outputDirectory === outputDirectory, "Unexpected deployment output directory");
  assert((deployment.headers?.length ?? 0) >= 2, "Deployment security/evidence headers missing");
  assert((deployment.rewrites?.length ?? 0) >= 3, "Direct product-route rewrites missing");
}

function validateScenarioManifest(): void {
  const source = readFileSync("web/data/scenarios.ts", "utf8");
  const requiredIds = [
    "large-target-change",
    "moderate-drift-deep-toy",
    "stale-oracle",
    "security-malicious-target",
    "security-unsupported-route",
    "security-unsafe-liquidity",
    "security-unknown-revert",
  ];
  assert(source.includes('DEFAULT_SCENARIO_ID = "large-target-change"'), "Large Target is not the default scenario");
  assert(!source.includes('from "../../artifacts/'), "Scenario artifacts are eagerly bundled");
  for (const id of requiredIds) assert(source.includes(`id: "${id}"`), `Missing public scenario mapping: ${id}`);
}

validateEvidenceExports();
validateSourceIntegrity();
validatePublicSurface();
validateScenarioManifest();

const liveSource = [readFileSync("web/live/LiveApp.tsx", "utf8"), readFileSync("src/live/rwa-index-live-adapter.ts", "utf8")].join("\n");
assert(!/artifacts\/|data\/scenarios|loadOperatorScenario/.test(liveSource), "Live app depends on historical evidence");
assert(liveSource.includes("analyzeRebalance") && liveSource.includes("simulateContract"), "Live analysis/simulation path missing");
assert(readFileSync("web/Router.tsx", "utf8").includes('path === "/evidence"'), "Evidence route missing");

console.log(`M6 product bundle: ${outputDirectory}`);
console.log(`Evidence exports: ${evidencePairs.length}/${evidencePairs.length} byte-identical`);
console.log("Security invariants: 11/11 held");
console.log(`M2 planner SHA-256: ${expectedM2Sha}`);
console.log("Public-surface scan: no local paths, localhost URLs, or credential signatures; evidence remains read-only");
console.log("Routes: / landing, /app live RPC, /evidence historical artifacts");
