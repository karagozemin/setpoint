import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
import { operatorScenarios } from "./scenarios";

const fastPath = operatorScenarios.find((scenario) => scenario.id === "moderate-drift-deep-toy")!;
const fallback = operatorScenarios.find((scenario) => scenario.id === "large-target-change")!;
const stale = operatorScenarios.find((scenario) => scenario.id === "stale-oracle")!;

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
  for (const scenario of operatorScenarios) {
    assert.equal(scenario.source.network, "Robinhood Chain testnet");
    assert.equal(scenario.source.label, "Fork-backed historical evidence");
  }
});

test("raw evidence export resolves to the versioned source artifact", () => {
  for (const scenario of operatorScenarios) {
    assert.ok(scenario.source.evidenceHref.endsWith(".json"));
    assert.ok(existsSync(scenario.source.artifactPath));
  }
});

test("view-model mapping is deterministic", () => {
  const presentation: ScenarioPresentation = {
    shortLabel: "Large Target / Fallback",
    subtitle: "Determinism fixture",
    artifactPath: "artifacts/hybrid/large-target-change.json",
    evidenceHref: "/evidence/large-target-change.json",
  };
  const first = mapScenarioArtifact(
    largeTargetArtifact as unknown as RawScenarioArtifact,
    summaryArtifact as unknown as RawSummaryArtifact,
    presentation,
  );
  const second = mapScenarioArtifact(
    largeTargetArtifact as unknown as RawScenarioArtifact,
    summaryArtifact as unknown as RawSummaryArtifact,
    presentation,
  );
  assert.deepEqual(first, second);
});
