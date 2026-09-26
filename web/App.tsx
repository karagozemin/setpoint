import { useMemo, useState } from "react";
import { DecisionPanel } from "./components/DecisionPanel";
import { EvidencePanel } from "./components/EvidencePanel";
import { PortfolioTable } from "./components/PortfolioTable";
import { StatusBadge } from "./components/StatusBadge";
import { TradePlan } from "./components/TradePlan";
import { getOperatorScenario, operatorScenarios } from "./data/scenarios";
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
        {operatorScenarios.map((scenario) => (
          <button
            aria-current={scenario.id === activeId ? "page" : undefined}
            className={scenario.id === activeId ? "scenario-active" : ""}
            key={scenario.id}
            onClick={() => onChange(scenario.id)}
            type="button"
          >
            <span>{scenario.shortLabel}</span>
            <StatusBadge compact mode={scenario.mode} />
          </button>
        ))}
      </div>
    </nav>
  );
}

function SummaryStrip({ scenario }: { scenario: OperatorScenarioViewModel }) {
  return (
    <section className="summary-strip" aria-label="Portfolio summary">
      <div className="summary-intro">
        <p className="eyebrow">RWA Index / rebalance control</p>
        <h1>{scenario.shortLabel}</h1>
        <p>{scenario.subtitle}</p>
      </div>
      <dl className="summary-metrics">
        <div>
          <dt>Vault NAV</dt>
          <dd>{scenario.after?.nav ?? scenario.before?.nav ?? "Not available"}</dd>
          <span>mock USDC · confirmed</span>
        </div>
        <div>
          <dt>Authoritative drift</dt>
          <dd>{scenario.after?.drift ?? scenario.before?.drift ?? "Not available"}</dd>
          <span>{scenario.before !== null && scenario.after !== null ? `from ${scenario.before.drift}` : "freshness blocked"}</span>
        </div>
        <div>
          <dt>Cash / base weight</dt>
          <dd>{scenario.after?.cashWeight ?? scenario.before?.cashWeight ?? "Not available"}</dd>
          <span>{scenario.after?.targetStatus ?? scenario.before?.targetStatus ?? "no portfolio snapshot"}</span>
        </div>
        <div>
          <dt>Current decision</dt>
          <dd><StatusBadge mode={scenario.mode} compact /></dd>
          <span>{scenario.terminalReason}</span>
        </div>
      </dl>
    </section>
  );
}

function GuardRail({ guards }: { guards: GuardViewModel[] }) {
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
        <span>Quotes</span>
        <strong>State-bound · 60s max age</strong>
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
          <p>The stale-oracle artifact stopped before a valid planning snapshot was accepted.</p>
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

export default function App() {
  const [scenarioId, setScenarioId] = useState("large-target-change");
  const scenario = useMemo(() => getOperatorScenario(scenarioId), [scenarioId]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="Setpoint operator console home">
          <span className="wordmark-name">SETPOINT</span>
          <span className="wordmark-section">/ OPERATOR CONSOLE</span>
        </a>
        <div className="topbar-context">
          <span><i className="context-dot" />Robinhood Chain testnet</span>
          <span>Vault <code title={scenario.source.vault}>{compact(scenario.source.vault)}</code></span>
          <span>Fork <strong>#{scenario.source.forkBlock}</strong></span>
          <span className="topbar-fork">Fork-backed evidence</span>
        </div>
      </header>

      <main id="top">
        <ScenarioSwitcher activeId={scenario.id} onChange={setScenarioId} />
        <SummaryStrip scenario={scenario} />

        <div className="primary-grid">
          <DecisionPanel scenario={scenario} />
          <GuardRail guards={scenario.guards} />
        </div>

        <PortfolioTable scenario={scenario} />
        <TradePlan key={scenario.id} scenario={scenario} />

        <div className="evidence-grid">
          <BeforeAfter scenario={scenario} />
          <EvidencePanel scenario={scenario} />
        </div>
      </main>

      <footer>
        <span>SETPOINT · M5 OPERATOR CONSOLE</span>
        <span>External integration: RWA Index</span>
        <span>Historical testnet evidence · no live funds</span>
      </footer>
    </div>
  );
}
