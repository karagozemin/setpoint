import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import largeTargetArtifact from "../../artifacts/hybrid/large-target-change.json";
import normalArtifact from "../../artifacts/hybrid/moderate-drift-deep-toy.json";
import staleOracleArtifact from "../../artifacts/hybrid/stale-oracle.json";
import summaryArtifact from "../../artifacts/m4-2-summary.json";
import {
  mapScenarioArtifact,
  type RawScenarioArtifact,
  type RawSummaryArtifact,
  type ScenarioPresentation,
} from "./adapter";
import {
  coreScenarioDefinitions,
  DEFAULT_SCENARIO_ID,
  EvidenceLoadError,
  loadOperatorScenario,
  scenarioDefinitions,
  securityScenarioDefinitions,
  type EvidenceFetcher,
} from "./scenarios";

const summary = summaryArtifact as unknown as RawSummaryArtifact;

function mapCore(raw: unknown, id: string) {
  const definition = coreScenarioDefinitions.find((candidate) => candidate.id === id)!;
  return mapScenarioArtifact(raw as RawScenarioArtifact, summary, {
    shortLabel: definition.shortLabel,
    subtitle: definition.subtitle,
    artifactPath: definition.artifactPath,
    evidenceHref: definition.evidenceHref,
  });
}

const fastPath = mapCore(normalArtifact, "moderate-drift-deep-toy");
const fallback = mapCore(largeTargetArtifact, "large-target-change");
const stale = mapCore(staleOracleArtifact, "stale-oracle");

const fileFetcher: EvidenceFetcher = async (input) => {
  const relative = input === "/evidence/m4-2-summary.json"
    ? "artifacts/m4-2-summary.json"
    : input.startsWith("/evidence/security/")
      ? `artifacts/security/${input.slice("/evidence/security/".length)}`
      : `artifacts/hybrid/${input.slice("/evidence/".length)}`;
  if (!existsSync(relative)) return { ok: false, status: 404, async json() { return {}; } };
  return { ok: true, status: 200, async json() { return JSON.parse(readFileSync(relative, "utf8")); } };
};

test("large target is the default and core scenarios remain primary", () => {
  assert.equal(DEFAULT_SCENARIO_ID, "large-target-change");
  assert.deepEqual(
    coreScenarioDefinitions.map((scenario) => scenario.id),
    ["large-target-change", "moderate-drift-deep-toy", "stale-oracle"],
  );
});

test("FAST_PATH artifact maps to the fast-path operator state", () => {
  assert.equal(fastPath.mode, "FAST_PATH");
  assert.equal(fastPath.fallbackInvoked, false);
  assert.equal(fastPath.adaptiveNotRequired, true);
  assert.equal(fastPath.simulation.fastPathStatus, "PASSED");
  assert.equal(fastPath.selectedPlan.length, 6);
  assert.equal(fastPath.targetBandsReached, true);
});

test("ADAPTIVE_FALLBACK preserves the original real-vault failure", () => {
  assert.equal(fallback.mode, "ADAPTIVE_FALLBACK");
  assert.equal(fallback.fallbackInvoked, true);
  assert.equal(fallback.originalPlan.length, 10);
  assert.equal(fallback.simulation.fastPathStatus, "FAILED");
  assert.equal(fallback.simulation.fastPathFailure, "INSUFFICIENT_OUTPUT");
  assert.equal(fallback.simulation.selectedPlanStatus, "PASSED");
  assert.equal(fallback.selectedPlan.length, 3);
  assert.equal(fallback.attemptedTurnover, "60.051107%");
  assert.equal(fallback.executedTurnover, "22.500000%");
  assert.equal(fallback.before?.drift, "31.025554%");
  assert.equal(fallback.after?.drift, "19.113279%");
  assert.equal(fallback.terminalReason, "NO_SAFE_LIQUIDITY");
});

test("stale oracle is a typed no-trade without fallback or execution", () => {
  assert.equal(stale.mode, "NO_TRADE");
  assert.equal(stale.terminalReason, "STALE_PRICE");
  assert.equal(stale.fallbackInvoked, false);
  assert.equal(stale.simulation.fastPathStatus, "NOT_RUN");
  assert.equal(stale.simulation.selectedPlanStatus, "NOT_RUN");
  assert.equal(stale.selectedPlan.length, 0);
  assert.equal(stale.simulation.executionHash, null);
});

test("selected trade-leg order is unchanged from the artifact", () => {
  const rawTrades = largeTargetArtifact.setpoint.cycles[0]!.result.trades!;
  assert.deepEqual(
    fallback.selectedPlan.map((leg) => [leg.tokenInAddress, leg.tokenOutAddress]),
    rawTrades.map((leg) => [leg.tokenIn, leg.tokenOut]),
  );
});

test("before and after drift values come directly from artifact state", () => {
  assert.equal(fallback.before?.drift, largeTargetArtifact.setpoint.initialState.driftFormatted);
  assert.equal(fallback.after?.drift, largeTargetArtifact.setpoint.finalState.driftFormatted);
  assert.equal(fastPath.before?.drift, normalArtifact.setpoint.initialState.driftFormatted);
  assert.equal(fastPath.after?.drift, normalArtifact.setpoint.finalState.driftFormatted);
});

test("unavailable stale-state values remain unavailable", () => {
  assert.equal(stale.before, null);
  assert.equal(stale.after, null);
  assert.equal(stale.oracleAge, null);
  assert.equal(stale.originalPlan.length, 0);
  assert.equal(staleOracleArtifact.setpoint.initialAuthoritativeDrift, null);
});

test("fork and testnet labeling is explicit", () => {
  for (const scenario of [fastPath, fallback, stale]) {
    assert.equal(scenario.source.network, "Robinhood Chain testnet");
    assert.equal(scenario.source.label, "Fork-backed historical evidence");
  }
});

test("every mapped public artifact exists and uses a relative evidence path", () => {
  for (const scenario of scenarioDefinitions) {
    assert.ok(scenario.evidenceHref.startsWith("/evidence/"));
    assert.ok(scenario.evidenceHref.endsWith(".json"));
    assert.ok(existsSync(scenario.artifactPath));
  }
});

test("public loader maps every core and safety scenario from source evidence", async () => {
  const loaded = await Promise.all(scenarioDefinitions.map((scenario) => loadOperatorScenario(scenario.id, fileFetcher)));
  assert.equal(loaded.length, 7);
  assert.deepEqual(loaded.map((scenario) => scenario.id), scenarioDefinitions.map((scenario) => scenario.id));

  const policy = loaded.find((scenario) => scenario.id === "security-malicious-target")!;
  const unsupported = loaded.find((scenario) => scenario.id === "security-unsupported-route")!;
  const unknown = loaded.find((scenario) => scenario.id === "security-unknown-revert")!;
  const unsafe = loaded.find((scenario) => scenario.id === "security-unsafe-liquidity")!;
  assert.equal(policy.terminalReason, "INVALID_POLICY");
  assert.equal(unsupported.simulation.fastPathStatus, "NOT_RUN");
  assert.equal(unsupported.terminalReason, "UNSUPPORTED_ASSET");
  assert.equal(unknown.simulation.fastPathFailure, "UNKNOWN_REVERT");
  assert.equal(unknown.fallbackInvoked, false);
  assert.equal(unsafe.mode, "ADAPTIVE_FALLBACK");
  assert.equal(unsafe.simulation.selectedPlanStatus, "PASSED");
  assert.equal(unsafe.terminalReason, "NO_SAFE_LIQUIDITY");
});

test("security view-models do not fabricate portfolio state", async () => {
  for (const definition of securityScenarioDefinitions) {
    const scenario = await loadOperatorScenario(definition.id, fileFetcher);
    assert.equal(scenario.scenarioGroup, "security");
    assert.equal(scenario.before, null);
    assert.equal(scenario.after, null);
    assert.equal(scenario.originalPlan.length, 0);
  }
});

test("unknown, missing, and malformed evidence are application errors", async () => {
  await assert.rejects(() => loadOperatorScenario("does-not-exist", fileFetcher), EvidenceLoadError);
  await assert.rejects(
    () => loadOperatorScenario(DEFAULT_SCENARIO_ID, async () => ({ ok: false, status: 404, async json() { return {}; } })),
    /Evidence request failed/,
  );
  await assert.rejects(
    () => loadOperatorScenario(DEFAULT_SCENARIO_ID, async () => ({ ok: true, status: 200, async json() { throw new Error("bad json"); } })),
    /Malformed evidence JSON/,
  );
});

test("view-model mapping is deterministic", () => {
  const presentation: ScenarioPresentation = {
    shortLabel: "Large Target / Adaptive Fallback",
    subtitle: "Determinism fixture",
    artifactPath: "artifacts/hybrid/large-target-change.json",
    evidenceHref: "/evidence/large-target-change.json",
  };
  const first = mapScenarioArtifact(largeTargetArtifact as unknown as RawScenarioArtifact, summary, presentation);
  const second = mapScenarioArtifact(largeTargetArtifact as unknown as RawScenarioArtifact, summary, presentation);
  assert.deepEqual(first, second);
});
