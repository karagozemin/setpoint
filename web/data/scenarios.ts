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
import type { OperatorScenarioViewModel } from "./types";

const summary = summaryArtifact as unknown as RawSummaryArtifact;

const presentations: Record<string, ScenarioPresentation> = {
  "moderate-drift-deep-toy": {
    shortLabel: "Normal / Fast Path",
    subtitle: "A coherent six-leg batch passes preflight and real vault simulation without adaptive planning.",
    artifactPath: "artifacts/hybrid/moderate-drift-deep-toy.json",
    evidenceHref: "/evidence/moderate-drift-deep-toy.json",
  },
  "large-target-change": {
    shortLabel: "Large Target / Fallback",
    subtitle: "The complete batch fails; a simulation-approved safe subset executes before liquidity forces a stop.",
    artifactPath: "artifacts/hybrid/large-target-change.json",
    evidenceHref: "/evidence/large-target-change.json",
  },
  "stale-oracle": {
    shortLabel: "Stale Oracle / No Trade",
    subtitle: "Stale accounting is rejected before planning, simulation, fallback, or execution.",
    artifactPath: "artifacts/hybrid/stale-oracle.json",
    evidenceHref: "/evidence/stale-oracle.json",
  },
};

function buildScenario(raw: unknown, id: keyof typeof presentations): OperatorScenarioViewModel {
  return mapScenarioArtifact(
    raw as RawScenarioArtifact,
    summary,
    presentations[id] as ScenarioPresentation,
  );
}

export const operatorScenarios: OperatorScenarioViewModel[] = [
  buildScenario(normalArtifact, "moderate-drift-deep-toy"),
  buildScenario(largeTargetArtifact, "large-target-change"),
  buildScenario(staleOracleArtifact, "stale-oracle"),
];

export function getOperatorScenario(id: string): OperatorScenarioViewModel {
  return operatorScenarios.find((scenario) => scenario.id === id) ?? operatorScenarios[0]!;
}
