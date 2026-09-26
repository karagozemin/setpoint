import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import largeTargetArtifact from "../artifacts/hybrid/large-target-change.json";
import normalArtifact from "../artifacts/hybrid/moderate-drift-deep-toy.json";
import { isRecoverableSimulationFailure, solveHybrid } from "../src/core/hybrid-solver.js";
import type { SimulationFailureCode } from "../src/core/types.js";
import {
  buildSecuritySuite,
  createSecurityFixture,
  securityFallbackPlan,
  validateSecuritySuite,
} from "./evidence.js";

const M2_EXPECTED_SHA = "dcd079ed25ff6fd7683c947fbf46748abd70862fe2a85a368c919b26fe7cee92";
const suitePromise = buildSecuritySuite();

test("stale oracle fails closed before simulation, fallback, or execution", async () => {
  const artifact = (await suitePromise).artifacts["stale-oracle.json"]!;
  assert.equal(artifact.terminal.reason, "STALE_PRICE");
  assert.equal(artifact.fastPath.simulationInvoked, false);
  assert.equal(artifact.fallback.invoked, false);
  assert.equal(artifact.execution.occurred, false);
  assert.equal(artifact.observedMetrics.executedTurnover, "0.000000%");
});

test("invalid target policy is rejected without becoming executable", async () => {
  const artifact = (await suitePromise).artifacts["malicious-target.json"]!;
  assert.equal(artifact.policyValidation.reason, "INVALID_POLICY");
  assert.equal(artifact.fastPath.simulationInvoked, false);
  assert.equal(artifact.fallback.invoked, false);
  assert.equal(artifact.execution.attempted, false);
  assert.match(artifact.scenario.boundary, /actor-level target authorization is not asserted/);
});

test("unsupported route is preserved in evidence and never silently omitted", async () => {
  const artifact = (await suitePromise).artifacts["unsupported-route.json"]!;
  assert.equal(artifact.fastPath.candidateLegs, 1);
  assert.equal(artifact.fastPath.failureCode, "UNSUPPORTED_ROUTE");
  assert.equal(artifact.fastPath.simulationInvoked, false);
  assert.equal(artifact.fallback.invoked, false);
  assert.equal(artifact.execution.occurred, false);
  assert.equal(artifact.observedMetrics.residualRoute, "ASSET_A→ASSET_B");
});

test("unknown simulation failure is non-recoverable by default", async () => {
  const artifact = (await suitePromise).artifacts["unknown-revert.json"]!;
  assert.equal(artifact.terminal.reason, "SIMULATION_REJECTED");
  assert.equal(artifact.fastPath.failureCode, "UNKNOWN_REVERT");
  assert.equal(artifact.fastPath.simulationPassed, false);
  assert.equal(artifact.fallback.invoked, false);
  assert.equal(artifact.execution.occurred, false);
});

test("recoverable simulation failure can activate simulation-gated fallback", async () => {
  const result = await solveHybrid(
    createSecurityFixture(),
    { async simulate() { return { passed: false, failureCode: "INSUFFICIENT_OUTPUT" }; } },
    async (input) => securityFallbackPlan(input),
  );
  assert.equal(result.kind, "plan");
  assert.equal(result.mode, "ADAPTIVE_FALLBACK");
  assert.equal(result.fallbackInvoked, true);
  assert.equal(result.simulation?.passed, true);
});

test("fallback trigger mapping is an explicit default-closed allowlist", () => {
  const recoverable: SimulationFailureCode[] = [
    "INSUFFICIENT_OUTPUT",
    "TRADE_TOO_LARGE",
    "INSUFFICIENT_BALANCE",
    "DRIFT_NOT_IMPROVED",
    "EXCESSIVE_VALUE_LOSS",
  ];
  const nonRecoverable: SimulationFailureCode[] = [
    "STALE_PRICE",
    "SLIPPAGE_TOO_LOOSE",
    "UNAUTHORIZED",
    "UNSUPPORTED_ASSET",
    "UNKNOWN_REVERT",
  ];
  assert.ok(recoverable.every(isRecoverableSimulationFailure));
  assert.ok(nonRecoverable.every((code) => !isRecoverableSimulationFailure(code)));
  assert.equal(isRecoverableSimulationFailure(undefined), false);
});

test("failed complete batch never executes and unsafe residual is refused", async () => {
  const artifact = (await suitePromise).artifacts["unsafe-liquidity.json"]!;
  assert.equal(artifact.fastPath.failureCode, "INSUFFICIENT_OUTPUT");
  assert.equal(artifact.fastPath.failedPlanExecuted, false);
  assert.equal(artifact.fallback.simulationPassed, true);
  assert.equal(artifact.fallback.selectedLegs, 3);
  assert.equal(artifact.execution.confirmedStateReread, true);
  assert.equal(artifact.terminal.reason, "NO_SAFE_LIQUIDITY");
  assert.equal(artifact.observedMetrics.residualRoute, "USDC→NFLX");
});

test("accepted M4.2 normal and large scenario evidence is unchanged", () => {
  assert.equal(normalArtifact.setpoint.cycles[0]!.result.mode, "FAST_PATH");
  assert.equal(normalArtifact.setpoint.cycles[0]!.result.trades?.length, 6);
  assert.equal(normalArtifact.setpoint.finalState.driftFormatted, "0.075394%");
  assert.equal(largeTargetArtifact.setpoint.cycles[0]!.result.fastPath?.trades.length, 10);
  assert.equal(largeTargetArtifact.setpoint.cycles[0]!.result.fastPath?.simulation?.failureCode, "INSUFFICIENT_OUTPUT");
  assert.equal(largeTargetArtifact.setpoint.cycles[0]!.result.trades?.length, 3);
  assert.equal(largeTargetArtifact.setpoint.finalState.driftFormatted, "19.113279%");
});

test("security suite validates, preserves M2, and is deterministic", async () => {
  const first = await suitePromise;
  const second = await buildSecuritySuite();
  validateSecuritySuite(first);
  assert.deepEqual(first, second);
  assert.equal(first.summary.sourceIntegrity.m2PlannerSha256, M2_EXPECTED_SHA);
  assert.equal(first.summary.sourceIntegrity.m2PlannerUnchanged, true);
  assert.equal(first.summary.allInvariantsHeld, true);
});

test("checked-in security artifacts match deterministic generation", async () => {
  const suite = await suitePromise;
  for (const [fileName, artifact] of Object.entries(suite.artifacts)) {
    assert.deepEqual(JSON.parse(readFileSync(`artifacts/security/${fileName}`, "utf8")), artifact);
  }
  assert.deepEqual(
    JSON.parse(readFileSync("artifacts/security/security-summary.json", "utf8")),
    suite.summary,
  );
});
