import type {
  GuardViewModel,
  OperatorScenarioViewModel,
  PipelineStepViewModel,
  StepTone,
} from "./types";

export interface RawSecurityArtifact {
  scenario: {
    id: string;
    title: string;
    shortLabel: string;
    threat: string;
    evidenceLevel: "fork evidence" | "integration test evidence";
    boundary: string;
  };
  source: {
    stateId: string | null;
    network: string;
    chainId: number | null;
    vault: string | null;
    caller: string | null;
    sourceArtifact: string | null;
  };
  policyValidation: {
    invoked: boolean;
    passed: boolean;
    reason: string | null;
  };
  fastPath: {
    candidateLegs: number;
    preflightPassed: boolean;
    simulationInvoked: boolean;
    simulationPassed: boolean | null;
    failureCode: string | null;
    failedPlanExecuted: boolean;
  };
  fallback: {
    invoked: boolean;
    trigger: string | null;
    selectedLegs: number;
    simulationPassed: boolean | null;
  };
  execution: {
    attempted: boolean;
    occurred: boolean;
    executedLegs: number;
    transactionHash: string | null;
    confirmedStateReread: boolean;
  };
  terminal: {
    mode: "NO_TRADE" | "ADAPTIVE_FALLBACK_THEN_NO_TRADE";
    reason: string;
    explanation: string;
  };
  observedMetrics: {
    attemptedTurnover: string | null;
    executedTurnover: string | null;
  };
  relevantEvidence: string[];
  invariant: {
    expected: string;
    held: boolean;
  };
}

function titleCase(value: string): string {
  return value.replace(/^./, (character) => character.toUpperCase());
}

function evidenceValue(artifact: RawSecurityArtifact, key: string): string | null {
  return artifact.relevantEvidence.find((entry) => entry.startsWith(`${key}=`))?.slice(key.length + 1) ?? null;
}

function stepTone(passed: boolean | null, invoked: boolean): StepTone {
  if (!invoked) return "neutral";
  return passed ? "passed" : "blocked";
}

function pipelineFor(artifact: RawSecurityArtifact): PipelineStepViewModel[] {
  const policyValue = artifact.policyValidation.invoked
    ? artifact.policyValidation.passed ? "Passed" : artifact.policyValidation.reason ?? "Rejected"
    : "Not run";
  const simulationValue = artifact.fastPath.simulationInvoked
    ? artifact.fastPath.simulationPassed ? "Passed" : artifact.fastPath.failureCode ?? "Failed"
    : "Not run";
  const fallbackValue = artifact.fallback.invoked
    ? `${artifact.fallback.selectedLegs} safe legs`
    : "Not invoked";
  const executionValue = artifact.execution.occurred
    ? `${artifact.execution.executedLegs} legs confirmed`
    : "No transaction";

  return [
    { label: "Policy validation", value: policyValue, tone: stepTone(artifact.policyValidation.passed, artifact.policyValidation.invoked) },
    { label: "Route preflight", value: artifact.fastPath.preflightPassed ? "Passed" : "Stopped", tone: artifact.fastPath.preflightPassed ? "passed" : "blocked" },
    { label: "Vault simulation", value: simulationValue, tone: stepTone(artifact.fastPath.simulationPassed, artifact.fastPath.simulationInvoked) },
    { label: "Adaptive fallback", value: fallbackValue, tone: artifact.fallback.invoked ? "intervention" : "neutral" },
    { label: "Execution", value: executionValue, tone: artifact.execution.occurred ? "confirmed" : "neutral" },
    {
      label: "Terminal decision",
      value: artifact.terminal.reason,
      tone: artifact.terminal.reason === "NO_SAFE_LIQUIDITY" ? "blocked" : "confirmed",
    },
  ];
}

function guardsFor(artifact: RawSecurityArtifact): GuardViewModel[] {
  return [
    {
      label: "Policy validation",
      value: artifact.policyValidation.passed ? "Passed" : artifact.policyValidation.reason ?? "Stopped",
      state: artifact.policyValidation.passed ? "clear" : "failed",
      detail: artifact.scenario.boundary,
    },
    {
      label: "Route preflight",
      value: artifact.fastPath.preflightPassed ? "Passed" : artifact.fastPath.failureCode ?? "Stopped",
      state: artifact.fastPath.preflightPassed ? "clear" : "failed",
      detail: `${artifact.fastPath.candidateLegs} candidate legs preserved`,
    },
    {
      label: "Simple simulation",
      value: artifact.fastPath.simulationInvoked ? artifact.fastPath.simulationPassed ? "Passed" : "Rejected" : "Not run",
      state: artifact.fastPath.simulationInvoked ? artifact.fastPath.simulationPassed ? "clear" : "failed" : "not-recorded",
      detail: artifact.fastPath.failureCode ?? "Exact-vault gate",
    },
    {
      label: "Adaptive simulation",
      value: artifact.fallback.invoked ? artifact.fallback.simulationPassed ? "Passed" : "Rejected" : "Not invoked",
      state: artifact.fallback.invoked ? artifact.fallback.simulationPassed ? "clear" : "failed" : "not-recorded",
      detail: artifact.fallback.trigger ?? "Default-closed allowlist",
    },
    {
      label: "Failed plan execution",
      value: artifact.fastPath.failedPlanExecuted ? "Violation" : "None",
      state: artifact.fastPath.failedPlanExecuted ? "failed" : "clear",
      detail: "A rejected fast path must never execute",
    },
    {
      label: "Safety invariant",
      value: artifact.invariant.held ? "Held" : "Failed",
      state: artifact.invariant.held ? "clear" : "failed",
      detail: artifact.invariant.expected,
    },
  ];
}

export function mapSecurityArtifact(
  artifact: RawSecurityArtifact,
  artifactPath: string,
  evidenceHref: string,
): OperatorScenarioViewModel {
  const forkBlock = evidenceValue(artifact, "sourceForkBlock") ?? "not applicable";
  const isAdaptive = artifact.terminal.mode === "ADAPTIVE_FALLBACK_THEN_NO_TRADE";
  const evidenceLabel = titleCase(artifact.scenario.evidenceLevel);

  return {
    id: `security-${artifact.scenario.id}`,
    scenarioGroup: "security",
    shortLabel: artifact.scenario.shortLabel,
    title: artifact.scenario.title,
    subtitle: artifact.scenario.threat,
    mode: isAdaptive ? "ADAPTIVE_FALLBACK" : "NO_TRADE",
    modeReason: evidenceValue(artifact, "modeSelectionReason") ?? artifact.terminal.reason,
    decisionSummary: artifact.terminal.explanation,
    terminalReason: artifact.terminal.reason,
    targetBandsReached: false,
    fallbackInvoked: artifact.fallback.invoked,
    adaptiveNotRequired: false,
    attemptedTurnover: artifact.observedMetrics.attemptedTurnover ?? "Not measured",
    executedTurnover: artifact.observedMetrics.executedTurnover ?? "Not measured",
    batchSummary: artifact.execution.occurred
      ? `1 batch · ${artifact.execution.executedLegs} executed legs`
      : "0 batches · no transaction",
    before: null,
    after: null,
    originalPlan: [],
    selectedPlan: [],
    blockedLegs: [],
    guards: guardsFor(artifact),
    pipeline: pipelineFor(artifact),
    simulation: {
      fastPathStatus: !artifact.fastPath.simulationInvoked
        ? "NOT_RUN"
        : artifact.fastPath.simulationPassed ? "PASSED" : "FAILED",
      fastPathFailure: artifact.fastPath.failureCode,
      selectedPlanStatus: artifact.fallback.simulationPassed ? "PASSED" : "NOT_RUN",
      executionHash: artifact.execution.transactionHash,
      exactVault: artifact.source.vault ?? "Not applicable",
      caller: artifact.source.caller ?? "Not applicable",
    },
    source: {
      network: artifact.source.network,
      chainId: artifact.source.chainId,
      vault: artifact.source.vault ?? "Not applicable",
      caller: artifact.source.caller ?? "Not applicable",
      forkBlock,
      forkHash: null,
      stateBlock: null,
      stateId: artifact.source.stateId,
      label: evidenceLabel,
      artifactPath,
      evidenceHref,
    },
    oracleAge: null,
    stateEvidenceNote: "This safety artifact records the control-flow outcome; it does not invent a portfolio snapshot.",
    terminalExplanation: `${artifact.terminal.explanation} Evidence level: ${evidenceLabel}.`,
  };
}
