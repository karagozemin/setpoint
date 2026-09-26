import type { OperatorScenarioViewModel, PortfolioAssetViewModel } from "../data/types";

interface PortfolioTableProps {
  scenario: OperatorScenarioViewModel;
}

function AllocationTrack({ asset }: { asset: PortfolioAssetViewModel }) {
  const maximumScale = Math.max(0.35, asset.targetMax + 0.04, asset.weightBefore + 0.04, (asset.weightAfter ?? 0) + 0.04);
  const targetStart = Math.min(100, (asset.targetMin / maximumScale) * 100);
  const targetWidth = Math.max(2, ((asset.targetMax - asset.targetMin) / maximumScale) * 100);
  const before = Math.min(100, (asset.weightBefore / maximumScale) * 100);
  const after = asset.weightAfter === null ? null : Math.min(100, (asset.weightAfter / maximumScale) * 100);

  return (
    <div className="allocation-track" aria-hidden="true">
      <span className="target-zone" style={{ left: `${targetStart}%`, width: `${targetWidth}%` }} />
      <span className="weight-marker marker-before" style={{ left: `${before}%` }} />
      {after !== null && <span className="weight-marker marker-after" style={{ left: `${after}%` }} />}
    </div>
  );
}

export function PortfolioTable({ scenario }: PortfolioTableProps) {
  if (scenario.before === null) {
    return (
      <section className="panel portfolio-panel" aria-labelledby="portfolio-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Authoritative portfolio</p>
            <h2 id="portfolio-title">State unavailable</h2>
          </div>
          <span className="data-state data-state-blocked">Freshness rejected</span>
        </div>
        <div className="empty-state">
          <span className="empty-code">STALE_PRICE</span>
          <p>The artifact intentionally contains no portfolio snapshot. Accounting freshness failed before planning.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel portfolio-panel" aria-labelledby="portfolio-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Authoritative portfolio</p>
          <h2 id="portfolio-title">Weights against policy bands</h2>
        </div>
        <div className="allocation-key" aria-label="Allocation marker legend">
          <span><i className="key-before" />Before</span>
          <span><i className="key-after" />After</span>
          <span><i className="key-range" />Target band</span>
        </div>
      </div>

      <div className="table-scroll">
        <table className="portfolio-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Allocation</th>
              <th>Before → after</th>
              <th>Target range</th>
              <th>Confirmed status</th>
              <th>Balance / value</th>
              <th>Liquidity</th>
            </tr>
          </thead>
          <tbody>
            {scenario.before.assets.map((asset) => (
              <tr key={asset.token}>
                <td>
                  <strong className="asset-symbol">{asset.symbol}</strong>
                  <span className="address-mini" title={asset.token}>{`${asset.token.slice(0, 6)}…${asset.token.slice(-4)}`}</span>
                </td>
                <td className="allocation-cell"><AllocationTrack asset={asset} /></td>
                <td className="numeric-cell">
                  <span>{(asset.weightBefore * 100).toFixed(2)}%</span>
                  <span className="inline-arrow" aria-label="to">→</span>
                  <strong>{asset.weightAfter === null ? "—" : `${(asset.weightAfter * 100).toFixed(2)}%`}</strong>
                </td>
                <td className="numeric-cell">{asset.targetLabel}</td>
                <td>
                  <span className={`range-status ${asset.statusAfter === "In range" ? "range-in" : "range-out"}`}>
                    {asset.statusAfter ?? asset.statusBefore}
                  </span>
                </td>
                <td>
                  <span className="table-primary">{asset.balanceAfter ?? asset.balanceBefore} {asset.symbol}</span>
                  <span className="table-secondary">{asset.valueAfter ?? asset.valueBefore} USDC value</span>
                </td>
                <td>
                  <span className={`liquidity-label ${asset.liquidityStatus === "Route constrained" ? "liquidity-constrained" : ""}`}>
                    {asset.liquidityStatus}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
