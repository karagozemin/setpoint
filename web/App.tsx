import { useEffect, useState } from "react";
import { DecisionPanel } from "./components/DecisionPanel";
import { EvidencePanel } from "./components/EvidencePanel";
import { PortfolioTable } from "./components/PortfolioTable";
import { StatusBadge } from "./components/StatusBadge";
import { TradePlan } from "./components/TradePlan";
import {
  coreScenarioDefinitions,
  DEFAULT_SCENARIO_ID,
  loadOperatorScenario,
  securityScenarioDefinitions,
  type ScenarioDefinition,
} from "./data/scenarios";
import type { GuardViewModel, OperatorScenarioViewModel } from "./data/types";

function compact(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function ScenarioSwitcher({
  activeId,
  onChange,
}: {
  activeId: string;
  onChange: (id: string) => void;
}) {
  return (
    <nav className="scenario-switcher" aria-label="Evidence scenario">
      <span className="scenario-label">Evidence scenario</span>
      <div className="scenario-options">
        {coreScenarioDefinitions.map((scenario) => (
          <button
            aria-current={scenario.id === activeId ? "page" : undefined}
            className={scenario.id === activeId ? "scenario-active" : ""}
            key={scenario.id}
            onClick={() => onChange(scenario.id)}
            type="button"
          >
            <span>{scenario.shortLabel}</span>
            <StatusBadge compact mode={scenario.expectedMode} />
          </button>
        ))}
      </div>
      <label className="safety-picker">
        <span>Safety cases</span>
        <select
          aria-label="Safety failure demonstration"
          onChange={(event) => event.target.value !== "" && onChange(event.target.value)}
          value={securityScenarioDefinitions.some((scenario) => scenario.id === activeId) ? activeId : ""}
        >
          <option value="">Select evidence</option>
          {securityScenarioDefinitions.map((scenario) => (
            <option key={scenario.id} value={scenario.id}>{scenario.shortLabel}</option>
          ))}
        </select>
      </label>
    </nav>
  );
}

function ProductContext() {
  return (
    <section className="product-context" aria-labelledby="product-purpose">
      <div>
        <p className="eyebrow">Setpoint / operator console</p>
        <h1 id="product-purpose">Safety and execution orchestration for onchain vault rebalances.</h1>
        <p>Preflight simple rebalances. Adapt only when liquidity or vault constraints make them unsafe.</p>
      </div>
      <dl>
        <div><dt>Network</dt><dd>Robinhood Chain testnet</dd></div>
        <div><dt>Evidence</dt><dd>Historical fork + deterministic integration tests</dd></div>
        <div><dt>Compatibility target</dt><dd>External integration: RWA Index</dd></div>
      </dl>
    </section>
  );
}

function SummaryStrip({ scenario }: { scenario: OperatorScenarioViewModel }) {
  return (
    <section className="summary-strip" aria-label="Portfolio summary">
      <div className="summary-intro">
        <p className="eyebrow">{scenario.scenarioGroup === "security" ? "Security evidence / fail-closed controls" : "RWA Index / rebalance control"}</p>
        <h1>{scenario.shortLabel}</h1>
        <p>{scenario.subtitle}</p>
      </div>
      <dl className="summary-metrics">
        <div>
          <dt>Initial drift</dt>
          <dd>{scenario.before?.drift ?? "Not available"}</dd>
          <span>{scenario.before === null ? "no portfolio snapshot asserted" : "confirmed fork state"}</span>
        </div>
        <div>
          <dt>Simple batch</dt>
          <dd>{scenario.originalPlan.length === 0 ? "No candidate" : `${scenario.originalPlan.length} legs`}</dd>
          <span>{scenario.attemptedTurnover} NAV attempted</span>
        </div>
        <div>
          <dt>Confirmed drift</dt>
          <dd>{scenario.after?.drift ?? "No execution"}</dd>
          <span>{scenario.executedTurnover} NAV executed</span>
        </div>
        <div>
          <dt>Current decision</dt>
          <dd><StatusBadge mode={scenario.mode} compact /></dd>
          <span>{scenario.simulation.fastPathFailure ?? scenario.terminalReason} → {scenario.terminalReason}</span>
        </div>
      </dl>
    </section>
  );
}

function EvidenceFailure({ message, onReset }: { message: string; onReset: () => void }) {
  return (
    <section className="panel load-failure" role="alert" aria-labelledby="load-failure-title">
      <p className="eyebrow">Application / evidence error</p>
      <h2 id="load-failure-title">Evidence could not be loaded.</h2>
      <p>{message}</p>
      <p>This is a delivery error, not a Setpoint <code>NO_TRADE</code> safety decision.</p>
      <button onClick={onReset} type="button">Return to Large Target evidence</button>
    </section>
  );
}

function initialScenarioId(): string {
  return new URL(window.location.href).searchParams.get("scenario") ?? DEFAULT_SCENARIO_ID;
}

function GuardRail({ guards, scenario }: { guards: GuardViewModel[]; scenario: OperatorScenarioViewModel }) {
  return (
    <section className="panel guard-panel" aria-labelledby="guard-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Policy / hard guards</p>
          <h2 id="guard-title">Execution envelope</h2>
        </div>
        <span className="policy-version">M4.2 policy</span>
      </div>
      <ul className="guard-list">
        {guards.map((guard) => (
          <li key={guard.label}>
            <span className={`guard-dot guard-${guard.state}`} aria-hidden="true" />
            <span>
              <strong>{guard.label}</strong>
              <small>{guard.detail}</small>
            </span>
            <b>{guard.value}</b>
          </li>
        ))}
      </ul>
      <div className="guard-footer">
        <span>{scenario.scenarioGroup === "security" ? "Evidence" : "Quotes"}</span>
        <strong>{scenario.scenarioGroup === "security" ? scenario.source.label : "State-bound · 60s max age"}</strong>
      </div>
    </section>
  );
}

function BeforeAfter({ scenario }: { scenario: OperatorScenarioViewModel }) {
  return (
    <section className="panel comparison-panel" aria-labelledby="comparison-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Confirmed-state reconciliation</p>
          <h2 id="comparison-title">Before → after</h2>
        </div>
        <span className={scenario.targetBandsReached ? "data-state data-state-clear" : "data-state data-state-blocked"}>
          {scenario.targetBandsReached ? "Bands reached" : scenario.mode === "NO_TRADE" ? "No execution" : "Partial progress"}
        </span>
      </div>

      {scenario.before === null ? (
        <div className="empty-state compact-empty">
          <span className="empty-code">NO STATE COMPARISON</span>
          <p>{scenario.stateEvidenceNote}</p>
        </div>
      ) : (
        <div className="state-comparison">
          <div className="state-card">
            <span>Before execution</span>
            <strong>{scenario.before.drift}</strong>
            <dl>
              <div><dt>NAV</dt><dd>{scenario.before.nav}</dd></div>
              <div><dt>Cash</dt><dd>{scenario.before.cashWeight}</dd></div>
              <div><dt>Status</dt><dd>{scenario.before.targetStatus}</dd></div>
            </dl>
          </div>
          <span className="state-arrow" aria-label="to">→</span>
          <div className="state-card state-card-after">
            <span>Confirmed after</span>
            <strong>{scenario.after?.drift ?? "No execution"}</strong>
            <dl>
              <div><dt>NAV</dt><dd>{scenario.after?.nav ?? scenario.before.nav}</dd></div>
              <div><dt>Cash</dt><dd>{scenario.after?.cashWeight ?? scenario.before.cashWeight}</dd></div>
              <div><dt>Status</dt><dd>{scenario.after?.targetStatus ?? "State unchanged"}</dd></div>
            </dl>
          </div>
        </div>
      )}
      <p className="comparison-note">{scenario.terminalExplanation}</p>
    </section>
  );
}

export default function EvidenceApp() {
  const [scenarioId, setScenarioId] = useState(initialScenarioId);
  const [scenario, setScenario] = useState<OperatorScenarioViewModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setScenario(null);
    setLoadError(null);
    void loadOperatorScenario(scenarioId)
      .then((loaded) => {
        if (current) setScenario(loaded);
      })
      .catch((error: unknown) => {
        if (current) setLoadError(error instanceof Error ? error.message : "Unknown evidence loading failure");
      });
    return () => { current = false; };
  }, [scenarioId]);

  function selectScenario(id: string): void {
    const url = new URL(window.location.href);
    if (id === DEFAULT_SCENARIO_ID) url.searchParams.delete("scenario");
    else url.searchParams.set("scenario", id);
    window.history.replaceState(null, "", url);
    setScenarioId(id);
  }

  function resetScenario(): void {
    selectScenario(DEFAULT_SCENARIO_ID);
  }

  const selectedDefinition: ScenarioDefinition | undefined = [...coreScenarioDefinitions, ...securityScenarioDefinitions]
    .find((definition) => definition.id === scenarioId);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="/evidence" aria-label="Setpoint evidence console home">
          <img alt="" className="brand-mark" height={28} src="/brand/setpoint.png" width={28} />
          <span className="wordmark-name">SETPOINT</span>
          <span className="wordmark-section">/ OPERATOR CONSOLE</span>
        </a>
        <div className="topbar-context">
          <span><i className="context-dot" />{scenario?.source.network ?? "Robinhood Chain testnet"}</span>
          {scenario !== null && scenario.source.vault !== "Not applicable" && <span>Vault <code title={scenario.source.vault}>{compact(scenario.source.vault)}</code></span>}
          {scenario !== null && scenario.source.forkBlock !== "not applicable" && <span>Fork <strong>#{scenario.source.forkBlock}</strong></span>}
          <span className="topbar-fork">Public demo · no live funds</span>
        </div>
      </header>

      <main id="top">
        <ProductContext />
        <ScenarioSwitcher activeId={scenarioId} onChange={selectScenario} />

        {loadError !== null ? (
          <EvidenceFailure message={loadError} onReset={resetScenario} />
        ) : scenario === null ? (
          <section className="panel load-state" role="status">
            <p className="eyebrow">Loading checked-in evidence</p>
            <h2>{selectedDefinition?.shortLabel ?? "Unknown scenario"}</h2>
          </section>
        ) : <>
          <SummaryStrip scenario={scenario} />

          <div className="primary-grid">
            <DecisionPanel scenario={scenario} />
            <GuardRail guards={scenario.guards} scenario={scenario} />
          </div>

          <PortfolioTable scenario={scenario} />
          <TradePlan key={scenario.id} scenario={scenario} />

          <div className="evidence-grid">
            <BeforeAfter scenario={scenario} />
            <EvidencePanel scenario={scenario} />
          </div>
        </>}
      </main>

      <footer>
        <div>
          <span className="footer-brand"><img alt="" className="brand-mark brand-mark-sm" height={18} src="/brand/setpoint.png" width={18} />SETPOINT · EVIDENCE CONSOLE</span>
          <span>External integration: RWA Index</span>
          <span>Historical, fork-backed Robinhood Chain testnet evidence. No live funds or production execution.</span>
        </div>
        <nav aria-label="Project resources">
          <a className="social-link" href="https://x.com/setpointxyz" target="_blank" rel="noreferrer">X / @setpointxyz</a>
          <a href="https://github.com/karagozemin/setpoint" target="_blank" rel="noreferrer">GitHub</a>
          <a href="https://github.com/karagozemin/setpoint/blob/main/Setpoint_PRD_v1_2.md" target="_blank" rel="noreferrer">PRD v1.2</a>
          <a href="https://github.com/karagozemin/setpoint/blob/main/docs/SECURITY.md" target="_blank" rel="noreferrer">Security model</a>
          <a href="https://github.com/karagozemin/setpoint#reproduce" target="_blank" rel="noreferrer">Reproduce</a>
        </nav>
      </footer>
    </div>
  );
}
