import type { OperatorScenarioViewModel } from "../data/types";

interface EvidencePanelProps {
  scenario: OperatorScenarioViewModel;
}

function AddressValue({ value }: { value: string }) {
  if (value === "Not applicable") return <span>Not applicable</span>;
  return <code title={value}>{`${value.slice(0, 8)}…${value.slice(-6)}`}</code>;
}

export function EvidencePanel({ scenario }: EvidencePanelProps) {
  const { source, simulation } = scenario;

  return (
    <section className="panel evidence-panel" aria-labelledby="evidence-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Simulation evidence</p>
          <h2 id="evidence-title">Evidence provenance</h2>
        </div>
        <span className="fork-label">{source.label}</span>
      </div>
      <dl className="evidence-list">
        <div><dt>Source network</dt><dd>{source.network}{source.chainId === null ? "" : ` · ${source.chainId}`}</dd></div>
        <div><dt>Target vault</dt><dd><AddressValue value={simulation.exactVault} /></dd></div>
        <div><dt>Intended caller</dt><dd><AddressValue value={simulation.caller} /></dd></div>
        <div><dt>Source fork</dt><dd>{source.forkBlock === "not applicable" ? "Not applicable" : <>#{source.forkBlock}{source.forkHash !== null && <> · <AddressValue value={source.forkHash} /></>}</>}</dd></div>
        <div><dt>State identity</dt><dd>{source.stateBlock === null ? "Not recorded" : `#${source.stateBlock}`} {source.stateId !== null && <AddressValue value={source.stateId} />}</dd></div>
        <div><dt>Simple simulation</dt><dd className={simulation.fastPathStatus === "FAILED" ? "evidence-failed" : ""}>{simulation.fastPathStatus}{simulation.fastPathFailure !== null && ` · ${simulation.fastPathFailure}`}</dd></div>
        <div><dt>Selected simulation</dt><dd>{simulation.selectedPlanStatus}</dd></div>
        <div><dt>Fork transaction</dt><dd>{simulation.executionHash === null ? "No execution hash" : <AddressValue value={simulation.executionHash} />}</dd></div>
        <div><dt>Evidence class</dt><dd>{source.label}</dd></div>
      </dl>
      <div className="evidence-actions">
        <a href={source.evidenceHref} target="_blank" rel="noreferrer">View raw evidence</a>
        <a href={source.evidenceHref} download>Download JSON</a>
      </div>
      <p className="artifact-reference">Source: <code>{source.artifactPath}</code></p>
    </section>
  );
}
