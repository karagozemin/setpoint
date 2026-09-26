import type { OperatorScenarioViewModel } from "../data/types";
import { StatusBadge } from "./StatusBadge";

interface DecisionPanelProps {
  scenario: OperatorScenarioViewModel;
}

export function DecisionPanel({ scenario }: DecisionPanelProps) {
  return (
    <section className={`panel decision-panel decision-${scenario.mode.toLowerCase()}`} aria-labelledby="decision-title">
      <div className="panel-heading decision-heading">
        <div>
          <p className="eyebrow">Orchestration decision</p>
          <h2 id="decision-title">Execution path</h2>
        </div>
        <StatusBadge mode={scenario.mode} />
      </div>

      <div className="decision-copy">
        <p>{scenario.decisionSummary}</p>
        <code>{scenario.modeReason}</code>
      </div>

      <div className="decision-metrics" aria-label="Decision metrics">
        <div>
          <span>Attempted turnover</span>
          <strong>{scenario.attemptedTurnover}</strong>
        </div>
        <div>
          <span>Executed turnover</span>
          <strong>{scenario.executedTurnover}</strong>
        </div>
        <div>
          <span>Confirmed execution</span>
          <strong>{scenario.batchSummary}</strong>
        </div>
        <div>
          <span>Target bands</span>
          <strong>{scenario.targetBandsReached ? "Reached" : "Not reached"}</strong>
        </div>
      </div>

      <ol className="decision-flow" aria-label="Decision path">
        {scenario.pipeline.map((step, index) => (
          <li className={`flow-step flow-${step.tone}`} key={`${step.label}-${index}`}>
            <span className="flow-index" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="flow-copy">
              <span>{step.label}</span>
              <strong>{step.value}</strong>
            </span>
          </li>
        ))}
      </ol>

      <div className="terminal-note">
        <span>Terminal state</span>
        <strong>{scenario.terminalReason}</strong>
        <p>{scenario.terminalExplanation}</p>
      </div>
    </section>
  );
}
