import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { formatUnits, getAddress } from "viem";
import { explorerAddress, explorerTransaction, rwaIndexLiveConfig } from "../../src/live/config";
import {
  integrationExplorerAddress,
  integrationForAddress,
  liveIntegrations,
  type LiveIntegrationDefinition,
} from "../../src/live/integration-catalog";
import {
  readIntegrationPreview,
  readIntegrationSnapshot,
  type IntegrationPreview,
  type LiveIntegrationSnapshot,
} from "../../src/live/integration-read-adapters";
import { RWAIndexLiveAdapter, UnsupportedVaultError } from "../../src/live/rwa-index-live-adapter";
import type { ExecutionResult, LiveAnalysisResult, LiveVaultState, ProposedAllocation } from "../../src/live/types";
import { connectWallet, readWallet, switchToRobinhood, type WalletState } from "./wallet";

const adapter = new RWAIndexLiveAdapter();
const WAD = 10n ** 18n;

type AppErrorKind = "RPC_ERROR" | "UNSUPPORTED_INTEGRATION" | "WALLET_REJECTION" | "TRANSACTION_REVERT" | "APPLICATION_ERROR";
interface AppError { kind: AppErrorKind; message: string }

function withDeadline<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(`${label} did not respond within ${Math.round(milliseconds / 1000)} seconds.`)), milliseconds);
    promise.then(
      (value) => { window.clearTimeout(timeout); resolve(value); },
      (error) => { window.clearTimeout(timeout); reject(error); },
    );
  });
}

function compact(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function percent(value: bigint | null, digits = 2): string {
  if (value === null) return "Unavailable";
  return `${(Number(value) / 1e16).toFixed(digits)}%`;
}

function tokenAmount(value: bigint | null, digits = 4): string {
  if (value === null) return "Unavailable";
  const formatted = Number(formatUnits(value, 18));
  return formatted.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function inputToWad(value: string): bigint {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return -1n;
  return BigInt(Math.round(parsed * 1e4)) * 10n ** 12n;
}

function allocationFromState(state: LiveVaultState): ProposedAllocation {
  return {
    cashWeight: state.cashTarget,
    assetWeights: Object.fromEntries(state.assets.map((asset) => [asset.address.toLowerCase(), asset.targetWeight])),
  };
}

function Header({ wallet, readOnly, onConnect, onSwitch, onDisconnect }: { wallet: WalletState; readOnly: boolean; onConnect: () => void; onSwitch: () => void; onDisconnect: () => void }) {
  const wrongNetwork = wallet.account !== null && wallet.chainId !== rwaIndexLiveConfig.chainId;
  return (
    <header className="product-header">
      <a href="/" className="product-wordmark"><img alt="" className="brand-mark" height={28} src="/brand/setpoint.png" width={28} /><span>SETPOINT</span></a>
      <nav aria-label="Primary navigation">
        <a aria-current="page" href="/app">App</a>
        <a href="/evidence">Evidence</a>
        <a href="https://github.com/karagozemin/setpoint" target="_blank" rel="noreferrer">GitHub ↗</a>
      </nav>
      {readOnly ? (
        <span className="header-read-only">Live reads · no wallet required</span>
      ) : wallet.account === null ? (
        <button className="header-action" onClick={onConnect} type="button">Connect wallet</button>
      ) : wrongNetwork ? (
        <button className="header-action warning" onClick={onSwitch} type="button">Switch network</button>
      ) : (
        <button className="wallet-address" onClick={onDisconnect} title="Disconnect wallet from Setpoint" type="button"><i />{compact(wallet.account)}</button>
      )}
    </header>
  );
}

type PreviewState = IntegrationPreview | { error: string } | null;

function VaultEntry({ onOpen, busy, error }: { onOpen: (address: string) => void; busy: boolean; error: AppError | null }) {
  const [address, setAddress] = useState("");
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  useEffect(() => {
    let active = true;
    for (const integration of liveIntegrations) {
      void withDeadline(readIntegrationPreview(integration.id), 12_000, `${integration.name} live preview`)
        .then((preview) => { if (active) setPreviews((current) => ({ ...current, [integration.id]: preview })); })
        .catch((caught) => { if (active) setPreviews((current) => ({ ...current, [integration.id]: { error: caught instanceof Error ? caught.message : "Live read failed" } })); });
    }
    return () => { active = false; };
  }, []);
  return (
    <main className="vault-entry">
      <div className="entry-heading">
        <p className="product-kicker">Live integration registry</p>
        <h1>Choose a vault with evidence.</h1>
        <p>Every active card resolves deployed bytecode and reads current chain state. Planning and execution remain integration-specific.</p>
      </div>
      {error && <ErrorNotice error={error} />}
      <section className="integration-registry" aria-label="Live vault integrations">
        <div className="registry-heading"><span>LIVE VAULTS</span><small>4 external contracts · 2 networks</small></div>
        <div className="integration-cards">
          {liveIntegrations.map((integration, index) => {
            const preview = previews[integration.id];
            const failed = preview !== null && preview !== undefined && "error" in preview;
            const livePreview = preview !== null && preview !== undefined && !("error" in preview) ? preview : null;
            return <article className={`integration-card integration-${integration.id}`} key={integration.id}>
              <div className="integration-card-top"><span>{String(index + 1).padStart(2, "0")}</span><span className={failed ? "adapter-state failed" : `adapter-state ${livePreview?.status.toLowerCase() ?? "loading"}`}><i />{failed ? "RPC UNAVAILABLE" : livePreview?.statusLabel ?? "READING LIVE STATE"}</span></div>
              <div><p>{integration.network} · {integration.chainId}</p><h2>{integration.name}</h2><code>{compact(integration.vault)}</code></div>
              <p className="integration-description">{integration.description}</p>
              <dl><div><dt>Adapter</dt><dd>{integration.capability === "PLANNING_AND_SIMULATION" ? "Plan + exact simulation" : "Live compatibility"}</dd></div><div><dt>Current state</dt><dd>{failed ? "Read failed" : livePreview?.primaryMetric ?? "Loading…"}</dd></div></dl>
              <p className="integration-live-detail">{failed ? "The card remains registered, but Setpoint will not present cached state as live." : livePreview?.detail ?? "Reading the public RPC…"}</p>
              <button disabled={busy || failed} onClick={() => onOpen(integration.vault)} type="button">{busy ? "Reading…" : integration.capability === "PLANNING_AND_SIMULATION" ? "Open vault →" : "Inspect live state →"}</button>
              <details><summary>Why this integration?</summary><p>{integration.why}</p><p className="integration-boundary">{integration.executionBoundary}</p></details>
            </article>;
          })}
        </div>
      </section>
      <form className="address-entry" onSubmit={(event) => { event.preventDefault(); onOpen(address); }}>
        <label htmlFor="vault-address">Paste supported vault address</label>
        <div><input id="vault-address" placeholder="0x…" value={address} onChange={(event) => setAddress(event.target.value)} /><button disabled={busy || address.length < 42} type="submit">Detect integration</button></div>
        <p>Only registered adapters open. Setpoint never assumes an arbitrary ERC-4626 vault shares another protocol's accounting or execution semantics.</p>
      </form>
    </main>
  );
}

function VaultOpening({ integration }: { integration: LiveIntegrationDefinition }) {
  return <main className="vault-opening" aria-busy="true" aria-live="polite"><div className="opening-index">LIVE RPC / {integration.chainId}</div><div className="opening-pulse"><i /><i /><i /></div><p className="product-kicker">Opening registered adapter</p><h1>{integration.name}</h1><p>Resolving deployed bytecode, current block, accounting state, holdings, and protocol-native controls.</p><dl><div><dt>Network</dt><dd>{integration.network}</dd></div><div><dt>Capability</dt><dd>{integration.capability === "PLANNING_AND_SIMULATION" ? "Plan + exact simulation" : "Live compatibility"}</dd></div><div><dt>Timeout</dt><dd>12 seconds · fails visibly</dd></div></dl></main>;
}

function ErrorNotice({ error }: { error: AppError }) {
  return <div className="error-notice" role="alert"><strong>{error.kind.replaceAll("_", " ")}</strong><span>{error.message}</span></div>;
}

function Provenance({ state, refreshing, onRefresh }: { state: LiveVaultState; refreshing: boolean; onRefresh: () => void }) {
  return (
    <div className="live-provenance">
      <span className="live-mark"><i /> LIVE RPC</span>
      <span>{state.network}</span>
      <span>Block <strong>#{state.blockNumber.toString()}</strong></span>
      <span>Updated {new Date(state.readAt).toLocaleTimeString()}</span>
      <button onClick={onRefresh} disabled={refreshing} type="button">{refreshing ? "Refreshing…" : "Refresh state"}</button>
    </div>
  );
}

function AllocationEditor({ state, allocation, onChange }: { state: LiveVaultState; allocation: ProposedAllocation; onChange: (next: ProposedAllocation) => void }) {
  const rows = [{ symbol: state.baseSymbol, address: state.baseAsset, current: state.nav === null ? null : state.cashBalance * WAD / state.nav, target: allocation.cashWeight, cash: true }, ...state.assets.map((asset) => ({ symbol: asset.symbol, address: asset.address, current: asset.weight, target: allocation.assetWeights[asset.address.toLowerCase()] ?? 0n, cash: false }))];
  const total = rows.reduce((sum, row) => sum + row.target, 0n);
  return (
    <section className="operator-section allocation-section" aria-labelledby="allocation-heading">
      <div className="section-heading"><div><p className="product-kicker">02 / Proposed policy</p><h2 id="allocation-heading">Target allocation</h2></div><span className={total === WAD ? "allocation-total valid" : "allocation-total invalid"}>{percent(total)} total</span></div>
      <p className="section-note">A Setpoint analysis input only. Editing this table does not change the external vault’s onchain strategy.</p>
      <div className="allocation-table">
        <div className="allocation-head"><span>Asset</span><span>Live weight</span><span>Onchain target</span><span>Proposed</span><span>Delta</span></div>
        {rows.map((row) => {
          const onchain = row.cash ? state.cashTarget : state.assets.find(({ address }) => address === row.address)?.targetWeight ?? 0n;
          return <div className="allocation-row" key={row.address}>
            <span><strong>{row.symbol}</strong><code>{compact(row.address)}</code></span>
            <span>{percent(row.current)}</span>
            <span>{percent(onchain)}</span>
            <label><span className="sr-only">Proposed {row.symbol} weight percent</span><input type="number" min="0" max={row.cash ? "100" : "80"} step="0.01" value={(Number(row.target) / 1e16).toFixed(2)} onChange={(event) => {
              const next = inputToWad(event.target.value);
              onChange(row.cash ? { ...allocation, cashWeight: next } : { ...allocation, assetWeights: { ...allocation.assetWeights, [row.address.toLowerCase()]: next } });
            }} /><em>%</em></label>
            <span className={row.current !== null && row.target > row.current ? "positive" : ""}>{row.current === null ? "—" : `${row.target >= row.current ? "+" : ""}${percent(row.target - row.current)}`}</span>
          </div>;
        })}
      </div>
    </section>
  );
}

function LiveStatePanel({ state }: { state: LiveVaultState }) {
  return (
    <section className="operator-section state-section" aria-labelledby="state-heading">
      <div className="section-heading"><div><p className="product-kicker">01 / Confirmed state</p><h2 id="state-heading">Portfolio</h2></div><a href={explorerAddress(state.vault)} target="_blank" rel="noreferrer">View vault ↗</a></div>
      {state.staleAssets.length > 0 && <div className="state-alert"><strong>Accounting unavailable</strong><span>The oracle is outside the vault’s freshness guard. Raw balances remain live; NAV, weights and drift are intentionally not estimated.</span></div>}
      <dl className="state-metrics">
        <div><dt>Authoritative NAV</dt><dd>{state.nav === null ? "Unavailable" : `${tokenAmount(state.nav)} ${state.baseSymbol}`}</dd></div>
        <div><dt>Vault drift</dt><dd>{percent(state.drift, 4)}</dd></div>
        <div><dt>Cash balance</dt><dd>{tokenAmount(state.cashBalance)} <small>{state.baseSymbol}</small></dd></div>
        <div><dt>Oracle</dt><dd className={state.staleAssets.length ? "danger" : "healthy"}>{state.staleAssets.length ? `${state.staleAssets.length} stale` : "Current"}</dd></div>
      </dl>
      <div className="holdings-table">
        <div className="holdings-head"><span>Holding</span><span>Balance</span><span>Weight</span><span>Target</span><span>Oracle</span></div>
        {state.assets.map((asset) => <div className="holding-row" key={asset.address}>
          <span><strong>{asset.symbol}</strong><code>{compact(asset.address)}</code></span>
          <span>{tokenAmount(asset.balance)}</span><span>{percent(asset.weight)}</span><span>{percent(asset.targetWeight)}</span>
          <span className={asset.priceStatus === "STALE" ? "price-stale" : "price-current"}><i />{asset.priceStatus}<small>{asset.priceAge >= 86400n ? `${asset.priceAge / 86400n}d old` : `${asset.priceAge / 3600n}h old`}</small></span>
        </div>)}
      </div>
      <details className="guards"><summary>Vault guards <span>6 controls</span></summary><dl><div><dt>Paused</dt><dd>{state.guards.paused ? "Yes" : "No"}</dd></div><div><dt>Drift trigger</dt><dd>{percent(state.guards.driftThreshold)}</dd></div><div><dt>Max leg</dt><dd>{percent(state.guards.maxTradeFraction)} NAV</dd></div><div><dt>Slippage floor</dt><dd>{percent(state.guards.slippageTolerance)}</dd></div><div><dt>Max price age</dt><dd>{(state.guards.maxStaleness / 3600n).toString()}h</dd></div><div><dt>Max NAV loss</dt><dd>{percent(state.guards.maxRebalanceLoss)}</dd></div></dl></details>
    </section>
  );
}

function AnalysisResult({ result, wallet, executing, execution, onExecute }: { result: LiveAnalysisResult; wallet: WalletState; executing: boolean; execution: ExecutionResult | null; onExecute: () => void }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  async function copyCalldata() { if (result.calldata) await navigator.clipboard.writeText(result.calldata); }
  function exportRequest() {
    const payload = JSON.stringify({ chainId: result.state.chainId, from: result.simulation.caller, to: result.state.vault, data: result.calldata, value: "0", blockNumber: result.state.blockNumber.toString(), mode: result.mode }, null, 2);
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([payload], { type: "application/json" })); link.download = `setpoint-execution-${result.state.blockNumber}.json`; link.click(); URL.revokeObjectURL(link.href);
  }
  return <section className={`analysis-result result-${result.mode.toLowerCase()}`} aria-live="polite">
    <div className="result-mark">{result.mode === "FAST_PATH" ? "✓" : "×"}</div>
    <div className="result-copy"><p>{result.title}</p><h2>{result.mode}</h2><strong>{result.summary}</strong><span>{result.reason.replaceAll("_", " ")}</span></div>
    <div className="result-actions">
      {result.calldata && <><button onClick={copyCalldata} type="button">Copy calldata</button><button onClick={exportRequest} type="button">Export request</button></>}
      {result.canExecute && wallet.chainId === rwaIndexLiveConfig.chainId && <button className="execute-action" disabled={executing} onClick={onExecute} type="button">{executing ? "Waiting for confirmation…" : "Execute rebalance"}</button>}
      {!result.canExecute && result.mode === "FAST_PATH" && <p><strong>Plan ready.</strong> Connected wallet is not authorized; send this request to the vault manager.</p>}
    </div>
    <button className="result-disclosure" onClick={() => setDetailsOpen(!detailsOpen)} type="button">{detailsOpen ? "Hide" : "Review"} technical details <span>{detailsOpen ? "−" : "+"}</span></button>
    {detailsOpen && <div className="result-details"><div><h3>Decision evidence</h3><ul>{result.details.map((detail) => <li key={detail}>{detail}</li>)}</ul></div><div><h3>Exact simulation</h3><dl><div><dt>Attempted</dt><dd>{result.simulation.attempted ? "Yes" : "No"}</dd></div><div><dt>Passed</dt><dd>{result.simulation.passed ? "Yes" : "No"}</dd></div><div><dt>Caller</dt><dd><code>{compact(result.simulation.caller)}</code></dd></div><div><dt>Failure</dt><dd>{result.simulation.failureCode ?? "None"}</dd></div></dl></div><div><h3>Trade legs</h3>{result.trades.length === 0 ? <p>No execution plan was constructed.</p> : <ol>{result.trades.map((trade, index) => <li key={`${trade.tokenIn}-${index}`}><code>{compact(trade.tokenIn)}</code> → <code>{compact(trade.tokenOut)}</code><span>{tokenAmount(trade.amountIn)} in · {tokenAmount(trade.minAmountOut)} min out</span></li>)}</ol>}</div></div>}
    {execution && <div className="execution-confirmed"><strong>Transaction confirmed</strong><a href={explorerTransaction(execution.hash)} target="_blank" rel="noreferrer">{compact(execution.hash)} ↗</a><span>Block #{execution.blockNumber.toString()} · confirmed state re-read</span></div>}
  </section>;
}

function CompatibilityWorkspace({ snapshot, refreshing, error, onRefresh, onBack }: { snapshot: LiveIntegrationSnapshot; refreshing: boolean; error: AppError | null; onRefresh: () => void; onBack: () => void }) {
  const integration = snapshot.integration;
  return <main className="operator-workspace compatibility-workspace">
    <div className="workspace-title"><div><button className="back-action" onClick={onBack} type="button">← All integrations</button><p className="product-kicker">External integration / {integration.shortName}</p><h1>Live compatibility</h1><p><a href={integrationExplorerAddress(integration)} target="_blank" rel="noreferrer">{integration.vault}</a></p></div><div className={`authority-state compatibility-${snapshot.status.toLowerCase()}`}><span>Adapter status</span><strong>{snapshot.statusLabel}</strong><small>Read-only · chain-native state</small></div></div>
    <div className="live-provenance"><span className="live-mark"><i /> LIVE RPC</span><span>{integration.network}</span><span>Block <strong>#{snapshot.blockNumber.toString()}</strong></span><span>Updated {new Date(snapshot.readAt).toLocaleTimeString()}</span><button onClick={onRefresh} disabled={refreshing} type="button">{refreshing ? "Refreshing…" : "Refresh state"}</button></div>
    {error && <ErrorNotice error={error} />}
    <div className={`compatibility-summary summary-${snapshot.status.toLowerCase()}`}><div><span>{snapshot.statusLabel}</span><h2>{integration.name}</h2><p>{snapshot.summary}</p></div><a href={integration.sourceRepository} target="_blank" rel="noreferrer">Verified source ↗</a></div>
    <dl className="compatibility-metrics">{snapshot.metrics.map((metric) => <div className={metric.tone ?? "neutral"} key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd>{metric.note && <small>{metric.note}</small>}</div>)}</dl>
    <div className="compatibility-grid">
      <section className="operator-section compatibility-holdings" aria-labelledby="compatibility-holdings-heading"><div className="section-heading"><div><p className="product-kicker">01 / Live inventory</p><h2 id="compatibility-holdings-heading">Holdings and registry</h2></div><span>{snapshot.holdings.length} rows</span></div><div className="compatibility-table"><div className="compatibility-table-head"><span>Asset</span><span>Live balance</span><span>Policy</span><span>Evidence</span></div>{snapshot.holdings.map((holding) => <div className="compatibility-table-row" key={holding.address}><span><strong>{holding.symbol}</strong><code>{compact(holding.address)}</code></span><span>{holding.balance}</span><span>{holding.policy}</span><span className={`compat-evidence evidence-${holding.status.toLowerCase()}`}><i />{holding.evidence}<small>{holding.status}</small></span></div>)}</div></section>
      <section className="operator-section compatibility-guards" aria-labelledby="compatibility-guards-heading"><div className="section-heading"><div><p className="product-kicker">02 / Onchain controls</p><h2 id="compatibility-guards-heading">Policy and guards</h2></div></div><dl>{snapshot.guards.map((guard) => <div key={guard.label}><dt>{guard.label}</dt><dd>{guard.value}</dd></div>)}</dl></section>
    </div>
    <section className="operator-section compatibility-analysis" aria-labelledby="compatibility-analysis-heading"><div className="section-heading"><div><p className="product-kicker">03 / Setpoint analysis</p><h2 id="compatibility-analysis-heading">Compatibility boundary</h2></div><span>LIVE READ ADAPTER</span></div><div className="compatibility-checks">{snapshot.checks.map((check) => <article className={`check-${check.status.toLowerCase()}`} key={check.label}><span>{check.status === "PASS" ? "✓" : check.status === "WARN" ? "!" : "i"}</span><div><strong>{check.label}</strong><p>{check.detail}</p></div></article>)}</div><div className="execution-boundary"><strong>Execution boundary</strong><p>{snapshot.executionBoundary}</p><p>Setpoint will not fabricate target weights, calldata, signer authority, or simulation support from an incompatible vault interface.</p></div></section>
    <div className="integration-limit"><strong>External integration disclosure</strong><p>{integration.name} is an independently operated external protocol. This adapter establishes technical read compatibility only; it is not a partnership, customer, endorsement, audit, or Setpoint-managed deployment.</p><span>Source pinned at <code>{integration.sourceCommit.slice(0, 12)}</code></span></div>
  </main>;
}

function classifyError(error: unknown, context: "read" | "wallet" | "transaction"): AppError {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (error instanceof UnsupportedVaultError) return { kind: "UNSUPPORTED_INTEGRATION", message };
  if (context === "read") return { kind: "RPC_ERROR", message };
  if (context === "transaction") return { kind: message.toLowerCase().includes("reject") ? "WALLET_REJECTION" : "TRANSACTION_REVERT", message };
  return { kind: "WALLET_REJECTION", message };
}

export default function LiveApp() {
  const [wallet, setWallet] = useState<WalletState>({ provider: null, account: null, chainId: null });
  const initialVault = useMemo(() => new URL(window.location.href).searchParams.get("vault"), []);
  const [vault, setVault] = useState<string | null>(initialVault);
  const [state, setState] = useState<LiveVaultState | null>(null);
  const [snapshot, setSnapshot] = useState<LiveIntegrationSnapshot | null>(null);
  const [allocation, setAllocation] = useState<ProposedAllocation | null>(null);
  const [analysis, setAnalysis] = useState<LiveAnalysisResult | null>(null);
  const [execution, setExecution] = useState<ExecutionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    void readWallet().then(setWallet).catch(() => undefined);
    const provider = window.ethereum;
    const sync = () => { void readWallet().then(setWallet).catch(() => undefined); };
    provider?.on?.("accountsChanged", sync);
    provider?.on?.("chainChanged", sync);
    return () => { provider?.removeListener?.("accountsChanged", sync); provider?.removeListener?.("chainChanged", sync); };
  }, []);
  useEffect(() => { if (vault) void openVault(vault); }, []);
  useEffect(() => {
    if (!state || !allocation) return;
    const serializable = { cashWeight: allocation.cashWeight.toString(), assetWeights: Object.fromEntries(Object.entries(allocation.assetWeights).map(([token, weight]) => [token, weight.toString()])) };
    window.localStorage.setItem(`setpoint:allocation:${state.vault.toLowerCase()}`, JSON.stringify(serializable));
  }, [state, allocation]);

  async function openVault(address: string) {
    setBusy(true); setError(null); setAnalysis(null); setExecution(null); setSnapshot(null);
    try {
      const normalized = getAddress(address);
      const integration = integrationForAddress(normalized);
      if (!integration) throw new UnsupportedVaultError(normalized);
      if (integration.id !== "rwa-index") {
        const nextSnapshot = await withDeadline(readIntegrationSnapshot(integration.id), 12_000, `${integration.name} live adapter`);
        setState(null); setAllocation(null); setSnapshot(nextSnapshot);
      } else {
        const next = await withDeadline(adapter.readVaultState(normalized, { account: wallet.account }), 12_000, "RWA Index live adapter");
        let nextAllocation = allocationFromState(next);
        const saved = window.localStorage.getItem(`setpoint:allocation:${normalized.toLowerCase()}`);
        if (saved) {
          try {
            const parsed = JSON.parse(saved) as { cashWeight: string; assetWeights: Record<string, string> };
            const candidate = { cashWeight: BigInt(parsed.cashWeight), assetWeights: Object.fromEntries(Object.entries(parsed.assetWeights).map(([token, weight]) => [token, BigInt(weight)])) };
            if (adapter.validateAllocation(next, candidate).valid) nextAllocation = candidate;
          } catch { window.localStorage.removeItem(`setpoint:allocation:${normalized.toLowerCase()}`); }
        }
        setState(next); setAllocation(nextAllocation);
      }
      setVault(normalized);
      const url = new URL(window.location.href); url.searchParams.set("vault", normalized); window.history.replaceState(null, "", url);
    } catch (caught) { setError(classifyError(caught, "read")); }
    finally { setBusy(false); }
  }

  async function refresh() {
    if (!vault) return;
    const integration = integrationForAddress(vault);
    if (integration && integration.id !== "rwa-index") {
      setBusy(true); setError(null);
      try { setSnapshot(await withDeadline(readIntegrationSnapshot(integration.id, true), 12_000, `${integration.name} live adapter`)); }
      catch (caught) { setError(classifyError(caught, "read")); }
      finally { setBusy(false); }
      return;
    }
    await openVault(vault);
  }
  async function connect() { try { const next = await connectWallet(); setWallet(next); if (vault) await openVault(vault); } catch (caught) { setError(classifyError(caught, "wallet")); } }
  async function disconnect() { setWallet({ provider: wallet.provider, account: null, chainId: wallet.chainId }); if (vault) await openVault(vault); }
  async function switchNetwork() { if (!wallet.provider) return; try { await switchToRobinhood(wallet.provider); setWallet(await readWallet()); } catch (caught) { setError(classifyError(caught, "wallet")); } }
  async function analyze() {
    if (!allocation) return;
    setAnalyzing(true); setError(null); setAnalysis(null); setExecution(null);
    try { const result = await adapter.analyzeRebalance(allocation, { account: wallet.account }); setState(result.state); setAnalysis(result); }
    catch (caught) { setError(classifyError(caught, "read")); }
    finally { setAnalyzing(false); }
  }
  async function execute() {
    if (!analysis || !wallet.provider || !wallet.account) return;
    setExecuting(true); setError(null);
    try { const confirmed = await adapter.execute(analysis, wallet.provider, wallet.account); setExecution(confirmed); setState(confirmed.after); }
    catch (caught) { setError(classifyError(caught, "transaction")); }
    finally { setExecuting(false); }
  }

  function closeVault() {
    setState(null); setSnapshot(null); setVault(null); setAllocation(null); setAnalysis(null); setExecution(null); setError(null);
    const url = new URL(window.location.href); url.searchParams.delete("vault"); window.history.replaceState(null, "", url);
  }

  const selectedIntegration = vault ? integrationForAddress(vault) : null;
  const openingIntegration = !state && !snapshot && busy ? selectedIntegration : null;
  const readOnlySurface = snapshot !== null || selectedIntegration?.capability === "LIVE_COMPATIBILITY";

  return <div className="product-page">
    <Header wallet={wallet} readOnly={readOnlySurface} onConnect={connect} onSwitch={switchNetwork} onDisconnect={() => { void disconnect(); }} />
    {openingIntegration ? <VaultOpening integration={openingIntegration} /> : !state && !snapshot ? <VaultEntry onOpen={openVault} busy={busy} error={error} /> : snapshot ? <CompatibilityWorkspace snapshot={snapshot} refreshing={busy} error={error} onRefresh={() => { void refresh(); }} onBack={closeVault} /> : state ? <main className="operator-workspace">
      <div className="workspace-title"><div><button className="back-action" onClick={closeVault} type="button">← All integrations</button><p className="product-kicker">External integration / RWA Index</p><h1>Rebalance control</h1><p><a href={explorerAddress(state.vault)} target="_blank" rel="noreferrer">{state.vault}</a></p></div><div className="authority-state"><span>Execution authority</span><strong>{state.authorization.canExecute ? "Authorized wallet" : wallet.account ? "Read only" : "Wallet disconnected"}</strong><small>{state.authorization.canExecute ? "Vault manager or active session" : "Analysis and export available"}</small></div></div>
      <Provenance state={state} refreshing={busy} onRefresh={refresh} />
      {error && <ErrorNotice error={error} />}
      <div className="operator-grid"><LiveStatePanel state={state} />{allocation && <AllocationEditor state={state} allocation={allocation} onChange={setAllocation} />}</div>
      <div className="analyze-bar"><div><span>Setpoint preflight</span><strong>Re-read state → validate policy → build batch → exact eth_call</strong></div><button disabled={analyzing || !allocation} onClick={analyze} type="button">{analyzing ? "Analyzing live state…" : "Analyze rebalance"}</button></div>
      {analysis && <AnalysisResult result={analysis} wallet={wallet} executing={executing} execution={execution} onExecute={execute} />}
      <div className="integration-limit"><strong>Live integration boundary</strong><p>RWA Index is an external technical integration, not a customer or Setpoint-managed deployment. Its public adapter exposes no trustworthy quote method; live adaptive sizing remains closed instead of using historical fork curves.</p></div>
    </main> : null}
  </div>;
}
