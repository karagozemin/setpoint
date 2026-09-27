import { useEffect, useMemo, useState } from "react";
import { formatUnits, type Address } from "viem";
import { explorerAddress, explorerTransaction, rwaIndexLiveConfig } from "../../src/live/config";
import { sandboxDeployment } from "../../src/sandbox/config";
import { SetpointSandboxLiveAdapter } from "../../src/sandbox/setpoint-sandbox-live-adapter";
import type { SandboxAnalysis, SandboxExecution, SandboxVaultState } from "../../src/sandbox/types";
import type { WalletState } from "./wallet";

const sandbox = new SetpointSandboxLiveAdapter();
const WAD = 10n ** 18n;

function amount(value: bigint, digits = 2): string {
  return Number(formatUnits(value, 18)).toLocaleString(undefined, { maximumFractionDigits: digits });
}
function pct(value: bigint): string { return `${(Number(value) / 1e16).toFixed(2)}%`; }
function compact(value: string): string { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function toWad(value: string): bigint { return BigInt(Math.round(Number(value) * 100)) * 10n ** 14n; }
function simulationStatus(analysis: SandboxAnalysis): "PASSED" | "REFUSED" | "NOT REQUIRED" {
  if (analysis.result.kind === "no-trade") return "NOT REQUIRED";
  return analysis.simulationPassed ? "PASSED" : "REFUSED";
}
function isSatisfiedNoTrade(analysis: SandboxAnalysis): boolean {
  return analysis.result.kind === "no-trade" && (analysis.result.reason === "TARGET_REGION_REACHED" || analysis.result.reason === "DRIFT_BELOW_TRIGGER");
}
function resultTone(analysis: SandboxAnalysis): string {
  if (isSatisfiedNoTrade(analysis)) return "satisfied";
  return analysis.mode.toLowerCase();
}
function resultTitle(analysis: SandboxAnalysis): string {
  return isSatisfiedNoTrade(analysis) ? "NO REBALANCE NEEDED" : analysis.mode.replaceAll("_", " ");
}

interface Props {
  wallet: WalletState;
  onConnect: () => void;
  onSwitch: () => void;
}

export default function SandboxExecute({ wallet, onConnect, onSwitch }: Props) {
  const [vault, setVault] = useState<Address | null>(null);
  const [state, setState] = useState<SandboxVaultState | null>(null);
  const [targets, setTargets] = useState<bigint[]>([]);
  const [cashTarget, setCashTarget] = useState(20n * 10n ** 16n);
  const [analysis, setAnalysis] = useState<SandboxAnalysis | null>(null);
  const [execution, setExecution] = useState<SandboxExecution | null>(null);
  const [activity, setActivity] = useState<Array<{ label: string; hash: `0x${string}`; block?: bigint }>>([]);
  const [phase, setPhase] = useState<"IDLE" | "READING" | "CREATING" | "SAVING" | "ANALYZING" | "SIGNING" | "CONFIRMING">("IDLE");
  const [error, setError] = useState<string | null>(null);
  const wrongNetwork = wallet.account !== null && wallet.chainId !== rwaIndexLiveConfig.chainId;
  const targetTotal = useMemo(() => targets.reduce((sum, value) => sum + value, cashTarget), [targets, cashTarget]);

  useEffect(() => {
    setVault(null); setState(null); setAnalysis(null); setExecution(null); setError(null);
    if (!sandbox.deployed() || !wallet.account || wrongNetwork) return;
    const account = wallet.account;
    let active = true;
    setPhase("READING");
    void sandbox.vaultFor(account).then(async (found) => {
      if (!active) return;
      setVault(found);
      if (found) {
        const next = await sandbox.readState(account, found);
        if (active) { adopt(next); await readActivity(account, found); }
      }
    }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Sandbox read failed."); })
      .finally(() => { if (active) setPhase("IDLE"); });
    return () => { active = false; };
  }, [wallet.account, wallet.chainId, wrongNetwork]);

  function adopt(next: SandboxVaultState) {
    setVault(next.vault); setState(next); setTargets(next.assets.map(({ targetWeight }) => targetWeight)); setCashTarget(next.cashTarget);
  }

  async function readActivity(account: Address, vaultAddress: Address) {
    try {
      const events = await sandbox.recentActivity(account, vaultAddress);
      setActivity(events.map((event) => ({
        label: event.kind === "CREATED" ? "Vault created" : event.kind === "TARGETS_UPDATED" ? "Targets updated" : "Rebalance confirmed",
        hash: event.transactionHash,
        block: event.blockNumber,
      })));
    } catch {
      // Event history is supplementary; current state remains authoritative.
    }
  }

  async function createVault() {
    if (!wallet.provider || !wallet.account) return;
    setPhase("CREATING"); setError(null);
    try {
      const created = await sandbox.createVault(wallet.provider, wallet.account);
      setActivity((current) => [{ label: "Vault created", hash: created.hash }, ...current]);
      adopt(await sandbox.readState(wallet.account, created.vault)); await readActivity(wallet.account, created.vault);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Vault creation failed."); }
    finally { setPhase("IDLE"); }
  }

  async function saveTargets() {
    if (!wallet.provider || !wallet.account || targetTotal !== WAD) return;
    setPhase("SAVING"); setError(null); setAnalysis(null); setExecution(null);
    try {
      const hash = await sandbox.setTargets(wallet.provider, wallet.account, targets, cashTarget);
      setActivity((current) => [{ label: "Targets updated", hash }, ...current]);
      const next = await sandbox.readState(wallet.account); adopt(next); await readActivity(wallet.account, next.vault);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Target update failed."); }
    finally { setPhase("IDLE"); }
  }

  async function analyze() {
    if (!wallet.account) return;
    setPhase("ANALYZING"); setError(null); setAnalysis(null); setExecution(null);
    try { const next = await sandbox.analyze(wallet.account); setAnalysis(next); adopt(next.state); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Analysis failed."); }
    finally { setPhase("IDLE"); }
  }

  async function execute() {
    if (!analysis || !wallet.provider || !wallet.account) return;
    setPhase("SIGNING"); setError(null);
    try {
      setPhase("CONFIRMING");
      const next = await sandbox.execute(analysis, wallet.provider, wallet.account);
      setExecution(next); adopt(next.after); setAnalysis(null);
      setActivity((current) => [{ label: "Rebalance confirmed", hash: next.hash, block: next.blockNumber }, ...current]);
      await readActivity(wallet.account, next.after.vault);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Rebalance failed."); }
    finally { setPhase("IDLE"); }
  }

  return <section className="sandbox-execute" id="execute-now" aria-labelledby="sandbox-title">
    <div className="sandbox-hero">
      <div><p className="product-kicker">EXECUTE NOW / ROBINHOOD CHAIN TESTNET</p><h1 id="sandbox-title">Your vault. Your targets. A real rebalance.</h1><p>Create a wallet-owned Setpoint sandbox vault, inspect live reserves, run the frozen hybrid solver, exact-simulate the batch, and sign the real testnet transaction.</p></div>
      <div className={`sandbox-network ${sandboxDeployment.status.toLowerCase()}`}><i /><span>{sandboxDeployment.status === "DEPLOYED" ? "LIVE TESTNET" : "DEPLOYMENT PENDING"}</span><strong>Chain {sandboxDeployment.chainId}</strong><small>No production assets · no custody</small></div>
    </div>

    {sandboxDeployment.status !== "DEPLOYED" ? <div className="sandbox-blocked">
      <span>01 / BROADCAST GATE</span><h2>Implementation ready; testnet deployment is credential-gated.</h2><p>No private key is present in this environment, so Setpoint refuses to invent addresses or present local state as live. Add <code>SETPOINT_SANDBOX_DEPLOYER_KEY</code> locally and run <code>pnpm sandbox:deploy</code>.</p>
    </div> : !wallet.account ? <div className="sandbox-onboarding"><span>01</span><div><h2>Connect the wallet that will own the vault.</h2><p>The factory binds one sandbox vault to this address. Only that wallet can store targets or execute a rebalance.</p></div><button onClick={onConnect} type="button">Connect wallet →</button></div>
      : wrongNetwork ? <div className="sandbox-onboarding"><span>01</span><div><h2>Switch to Robinhood Chain Testnet.</h2><p>Live reads and signatures must resolve against chain ID 46630.</p></div><button onClick={onSwitch} type="button">Switch network →</button></div>
      : !vault ? <div className="sandbox-onboarding"><span>01</span><div><h2>Create your funded sandbox vault.</h2><p>The factory deploys a wallet-owned vault and seeds a bounded, deliberately drifted 10,000 sUSDG test portfolio.</p></div><button disabled={phase !== "IDLE"} onClick={createVault} type="button">{phase === "CREATING" ? "Confirm in wallet…" : "Create my vault →"}</button></div>
      : state ? <>
        <div className="sandbox-provenance"><span><i /> LIVE RPC</span><span>Block #{state.blockNumber.toString()}</span><span>Vault <a href={explorerAddress(state.vault)} target="_blank" rel="noreferrer">{compact(state.vault)} ↗</a></span><span>Owner {compact(state.owner)}</span><span className={state.oracleFresh ? "fresh" : "stale"}>{state.oracleFresh ? "Oracle fresh" : "Oracle stale"}</span></div>
        {error && <div className="sandbox-error" role="alert"><strong>ACTION STOPPED</strong><span>{error}</span></div>}
        <div className="sandbox-state-grid">
          <section><p className="product-kicker">01 / CONFIRMED STATE</p><h2>Live portfolio</h2><dl className="sandbox-metrics"><div><dt>NAV</dt><dd>{amount(state.nav)} <small>sUSDG</small></dd></div><div><dt>Drift</dt><dd>{pct(state.drift)}</dd></div><div><dt>Cash</dt><dd>{pct(state.baseWeight)}</dd></div><div><dt>Assets</dt><dd>{state.assets.length}</dd></div></dl>
            <div className="sandbox-table"><div><span>Asset</span><span>Live</span><span>Target</span><span>Pool depth</span></div>{state.assets.map((asset) => <div key={asset.address}><span><strong>{asset.symbol}</strong><small>{compact(asset.address)}</small></span><span>{pct(asset.weight)}</span><span>{pct(asset.targetWeight)}</span><span>{amount(asset.reserveBase, 0)} sUSDG</span></div>)}</div>
          </section>
          <section><div className="sandbox-section-title"><div><p className="product-kicker">02 / ONCHAIN POLICY</p><h2>Target allocation</h2></div><strong className={targetTotal === WAD ? "valid" : "invalid"}>{pct(targetTotal)}</strong></div>
            <div className="sandbox-targets"><label><span>sUSDG cash</span><input min="0" max="100" step="0.5" type="number" value={(Number(cashTarget) / 1e16).toFixed(2)} onChange={(event) => setCashTarget(toWad(event.target.value))} /></label>{state.assets.map((asset, index) => <label key={asset.address}><span>{asset.symbol}</span><input min="0" max="70" step="0.5" type="number" value={(Number(targets[index] ?? 0n) / 1e16).toFixed(2)} onChange={(event) => setTargets((current) => current.map((value, item) => item === index ? toWad(event.target.value) : value))} /></label>)}</div>
            <button className="sandbox-secondary-action" disabled={phase !== "IDLE" || targetTotal !== WAD} onClick={saveTargets} type="button">{phase === "SAVING" ? "Confirming target tx…" : "Save targets onchain"}</button>
          </section>
        </div>
        <div className="sandbox-analyze"><div><span>03 / SETPOINT PREFLIGHT</span><strong>Re-read state → quote live pools → frozen hybrid solver → exact eth_call</strong><small>Plans are discarded after any confirmed state change.</small></div><button disabled={phase !== "IDLE" || !state.oracleFresh} onClick={analyze} type="button">{phase === "ANALYZING" ? "Sampling live liquidity…" : "Analyze rebalance →"}</button></div>
        {analysis && <div className={`sandbox-result result-${resultTone(analysis)}`}><div><p className="product-kicker">RUNTIME DECISION</p><h2>{resultTitle(analysis)}</h2><strong>{analysis.result.modeSelectionReason.replaceAll("_", " ")}</strong><p>{analysis.result.kind === "plan" ? `${analysis.trades.length} real trade leg${analysis.trades.length === 1 ? "" : "s"} passed exact vault simulation.` : analysis.result.details.join(" ")}</p></div><dl><div><dt>Exact simulation</dt><dd>{simulationStatus(analysis)}</dd></div><div><dt>Liquidity curves</dt><dd>{analysis.liquidity.curves.length}</dd></div><div><dt>Fallback invoked</dt><dd>{analysis.result.fallbackInvoked ? "YES" : "NO"}</dd></div></dl>{analysis.simulationPassed && <button disabled={phase !== "IDLE"} onClick={execute} type="button">{phase === "SIGNING" ? "Confirm in wallet…" : phase === "CONFIRMING" ? "Waiting for confirmation…" : "Execute real rebalance →"}</button>}</div>}
        {execution && <div className="sandbox-confirmed"><span>✓</span><div><p>TRANSACTION CONFIRMED</p><h2>Post-state re-read at block #{execution.blockNumber.toString()}</h2><p>Drift {pct(execution.before.drift)} → <strong>{pct(execution.after.drift)}</strong></p></div><a href={explorerTransaction(execution.hash)} target="_blank" rel="noreferrer">{compact(execution.hash)} ↗</a></div>}
        <section className="sandbox-activity"><div><p className="product-kicker">04 / RECENT ACTIVITY</p><h2>Onchain events</h2></div>{activity.length ? <ol>{activity.map((item) => <li key={`${item.hash}:${item.label}`}><span>{item.label}</span><a href={explorerTransaction(item.hash)} target="_blank" rel="noreferrer">{compact(item.hash)} ↗</a><small>{item.block ? `Block #${item.block}` : "Confirmed onchain"}</small></li>)}</ol> : <p>Factory, target, and rebalance events will appear here after confirmation.</p>}</section>
      </> : <div className="sandbox-onboarding"><span>•••</span><div><h2>Reading your confirmed vault state.</h2></div></div>}
  </section>;
}
