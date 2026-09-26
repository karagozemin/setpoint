import { useState } from "react";
import type { OperatorScenarioViewModel, TradeLegViewModel } from "../data/types";

type PlanView = "selected" | "original" | "blocked";

interface TradePlanProps {
  scenario: OperatorScenarioViewModel;
}

function TradeTable({ legs }: { legs: TradeLegViewModel[] }) {
  if (legs.length === 0) {
    return <p className="table-empty">No trade legs exist for this view.</p>;
  }

  return (
    <div className="table-scroll trade-scroll">
      <table className="trade-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Route</th>
            <th>amountIn</th>
            <th>minAmountOut</th>
            <th>Expected output</th>
            <th>Impact</th>
            <th>Safety margin</th>
            <th>Constraint / sample</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {legs.map((leg) => (
            <tr key={`${leg.index}-${leg.tokenInAddress}-${leg.tokenOutAddress}-${leg.amountIn}`}>
              <td className="leg-index">{String(leg.index).padStart(2, "0")}</td>
              <td>
                <strong className="trade-route">{leg.tokenIn} <span aria-label="to">→</span> {leg.tokenOut}</strong>
                <span className="table-secondary" title={`${leg.tokenInAddress} → ${leg.tokenOutAddress}`}>
                  {leg.tokenInAddress.slice(0, 6)}…{leg.tokenInAddress.slice(-4)} → {leg.tokenOutAddress.slice(0, 6)}…{leg.tokenOutAddress.slice(-4)}
                </span>
              </td>
              <td className="numeric-cell"><strong>{leg.amountIn}</strong> {leg.tokenIn}</td>
              <td className="numeric-cell">{leg.minAmountOut} {leg.minAmountOut === "Not measured" ? "" : leg.tokenOut}</td>
              <td className="numeric-cell">{leg.expectedOut === null ? "Not measured" : `${leg.expectedOut} ${leg.tokenOut}`}</td>
              <td className="numeric-cell">{leg.quoteImpact ?? "Not measured"}</td>
              <td className="numeric-cell">{leg.safetyMargin ?? "Not measured"}</td>
              <td>
                <span className="table-primary">{leg.bindingConstraint?.replaceAll("_", " ") ?? leg.reason?.replaceAll("_", " ") ?? "Not measured"}</span>
                {leg.sampleIndex !== null && <span className="table-secondary">Liquidity sample {leg.sampleIndex}</span>}
              </td>
              <td><span className={`leg-status leg-${leg.status}`}>{leg.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TradePlan({ scenario }: TradePlanProps) {
  const [view, setView] = useState<PlanView>(scenario.mode === "ADAPTIVE_FALLBACK" ? "selected" : "original");
  const isFallback = scenario.mode === "ADAPTIVE_FALLBACK";
  const legs = view === "selected" ? scenario.selectedPlan : view === "blocked" ? scenario.blockedLegs : scenario.originalPlan;
  const heading = view === "selected" ? "Simulation-approved safe subset" : view === "blocked" ? "Removed and blocked legs" : isFallback ? "Original simple batch" : "Executed simple batch";
  const detail = view === "selected"
    ? "Ordered legs selected by the existing adaptive planner."
    : view === "blocked"
      ? "Legs the artifact records as excluded from safe portfolio progress."
      : isFallback
        ? "The honest simple plan preserved with its real simulation failure."
        : "Sell-before-buy ordering executed unchanged after simulation approval.";

  return (
    <section className="panel trade-panel" aria-labelledby="trade-plan-title">
      <div className="panel-heading trade-heading">
        <div>
          <p className="eyebrow">Exact Trade[]</p>
          <h2 id="trade-plan-title">{heading}</h2>
          <p className="panel-subtitle">{detail}</p>
        </div>
        {scenario.mode !== "NO_TRADE" && (
          <div className="segmented-control" aria-label="Trade plan view">
            {isFallback && (
              <button aria-pressed={view === "selected"} onClick={() => setView("selected")} type="button">
                Safe subset <span>{scenario.selectedPlan.length}</span>
              </button>
            )}
            <button aria-pressed={view === "original"} onClick={() => setView("original")} type="button">
              {isFallback ? "Original batch" : "Executed batch"} <span>{scenario.originalPlan.length}</span>
            </button>
            {isFallback && (
              <button aria-pressed={view === "blocked"} onClick={() => setView("blocked")} type="button">
                Blocked / removed <span>{scenario.blockedLegs.length}</span>
              </button>
            )}
          </div>
        )}
      </div>
      <TradeTable legs={legs} />
    </section>
  );
}
