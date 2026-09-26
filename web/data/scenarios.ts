import {
  mapScenarioArtifact,
  type RawScenarioArtifact,
  type RawSummaryArtifact,
  type ScenarioPresentation,
} from "./adapter";
import { mapSecurityArtifact, type RawSecurityArtifact } from "./security-adapter";
import type { ExecutionMode, OperatorScenarioViewModel } from "./types";

export interface ScenarioDefinition {
  id: string;
  shortLabel: string;
  subtitle: string;
  group: "core" | "security";
  expectedMode: ExecutionMode;
  artifactPath: string;
  evidenceHref: string;
}

interface EvidenceResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type EvidenceFetcher = (input: string) => Promise<EvidenceResponse>;

export const DEFAULT_SCENARIO_ID = "large-target-change";
const SUMMARY_HREF = "/evidence/m4-2-summary.json";

export const coreScenarioDefinitions: ScenarioDefinition[] = [
  {
    id: "large-target-change",
    shortLabel: "Large Target / Adaptive Fallback",
    subtitle: "The complete batch fails; a simulation-approved safe subset executes before liquidity forces a stop.",
    group: "core",
    expectedMode: "ADAPTIVE_FALLBACK",
    artifactPath: "artifacts/hybrid/large-target-change.json",
    evidenceHref: "/evidence/large-target-change.json",
  },
  {
    id: "moderate-drift-deep-toy",
    shortLabel: "Normal / Fast Path",
    subtitle: "A coherent six-leg batch passes preflight and real vault simulation without adaptive planning.",
    group: "core",
    expectedMode: "FAST_PATH",
    artifactPath: "artifacts/hybrid/moderate-drift-deep-toy.json",
    evidenceHref: "/evidence/moderate-drift-deep-toy.json",
  },
  {
    id: "stale-oracle",
    shortLabel: "Stale Oracle / No Trade",
    subtitle: "Stale accounting is rejected before planning, simulation, fallback, or execution.",
    group: "core",
    expectedMode: "NO_TRADE",
    artifactPath: "artifacts/hybrid/stale-oracle.json",
    evidenceHref: "/evidence/stale-oracle.json",
  },
];

export const securityScenarioDefinitions: ScenarioDefinition[] = [
  {
    id: "security-malicious-target",
    shortLabel: "Policy Rejected",
    subtitle: "A policy-breaking target is rejected before simulation, fallback, or execution.",
    group: "security",
    expectedMode: "NO_TRADE",
    artifactPath: "artifacts/security/malicious-target.json",
    evidenceHref: "/evidence/security/malicious-target.json",
  },
  {
    id: "security-unsupported-route",
    shortLabel: "Unsupported Route",
    subtitle: "An unsupported direct asset route remains visible and is refused before simulation.",
    group: "security",
    expectedMode: "NO_TRADE",
    artifactPath: "artifacts/security/unsupported-route.json",
    evidenceHref: "/evidence/security/unsupported-route.json",
  },
  {
    id: "security-unsafe-liquidity",
    shortLabel: "Unsafe Liquidity",
    subtitle: "A safe subset executes while the remaining route is refused at the oracle-derived output floor.",
    group: "security",
    expectedMode: "ADAPTIVE_FALLBACK",
    artifactPath: "artifacts/security/unsafe-liquidity.json",
    evidenceHref: "/evidence/security/unsafe-liquidity.json",
  },
  {
    id: "security-unknown-revert",
    shortLabel: "Unknown Failure",
    subtitle: "An unclassified simulation failure stops without activating adaptive execution.",
    group: "security",
    expectedMode: "NO_TRADE",
    artifactPath: "artifacts/security/unknown-revert.json",
    evidenceHref: "/evidence/security/unknown-revert.json",
  },
];

export const scenarioDefinitions = [...coreScenarioDefinitions, ...securityScenarioDefinitions];

export class EvidenceLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceLoadError";
  }
}

function definitionFor(id: string): ScenarioDefinition {
  const definition = scenarioDefinitions.find((candidate) => candidate.id === id);
  if (definition === undefined) throw new EvidenceLoadError(`Unknown evidence scenario: ${id}`);
  return definition;
}

async function fetchJson(fetcher: EvidenceFetcher, path: string): Promise<unknown> {
  const response = await fetcher(path);
  if (!response.ok) throw new EvidenceLoadError(`Evidence request failed (${response.status}): ${path}`);
  try {
    return await response.json();
  } catch {
    throw new EvidenceLoadError(`Malformed evidence JSON: ${path}`);
  }
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EvidenceLoadError(`${label} is not a JSON object`);
  }
}

function validateMappedScenario(scenario: OperatorScenarioViewModel, definition: ScenarioDefinition): void {
  if (scenario.id !== definition.id || scenario.mode !== definition.expectedMode) {
    throw new EvidenceLoadError(`Evidence identity or mode mismatch: ${definition.id}`);
  }
}

export async function loadOperatorScenario(
  id: string,
  fetcher: EvidenceFetcher = (input) => fetch(input),
): Promise<OperatorScenarioViewModel> {
  const definition = definitionFor(id);
  const raw = await fetchJson(fetcher, definition.evidenceHref);
  assertObject(raw, "Scenario evidence");

  let mapped: OperatorScenarioViewModel;
  if (definition.group === "security") {
    mapped = mapSecurityArtifact(
      raw as unknown as RawSecurityArtifact,
      definition.artifactPath,
      definition.evidenceHref,
    );
  } else {
    const rawSummary = await fetchJson(fetcher, SUMMARY_HREF);
    assertObject(rawSummary, "M4.2 summary evidence");
    const presentation: ScenarioPresentation = {
      shortLabel: definition.shortLabel,
      subtitle: definition.subtitle,
      artifactPath: definition.artifactPath,
      evidenceHref: definition.evidenceHref,
    };
    mapped = mapScenarioArtifact(
      raw as unknown as RawScenarioArtifact,
      rawSummary as unknown as RawSummaryArtifact,
      presentation,
    );
  }

  validateMappedScenario(mapped, definition);
  return mapped;
}
