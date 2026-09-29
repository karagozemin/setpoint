import { sandboxDeployment } from "../src/sandbox/config";

function SiteHeader() {
  return <header className="landing-header"><a className="landing-wordmark" href="/"><img alt="" className="brand-mark" height={28} src="/brand/setpoint.png" width={28} /><span>SETPOINT</span></a><nav aria-label="Primary navigation"><a href="/app">App</a><a href="/evidence">Evidence</a><a href="https://github.com/karagozemin/setpoint" target="_blank" rel="noreferrer">GitHub ↗</a><a className="social-link" href="https://x.com/setpointxyz" target="_blank" rel="noreferrer">X / @setpointxyz ↗</a></nav><a className="landing-open" href="/app">Open Setpoint <span>↗</span></a></header>;
}

export default function Landing() {
  return <div className="landing-page">
    <SiteHeader />
    <main>
      <section className="landing-hero">
        <div className="hero-index"><span>Safety / execution</span><span>Robinhood Chain · 4663 / 46630</span></div>
        <div className="hero-copy"><p className="product-kicker">Vault rebalance orchestration</p><h1>Rebalance the vault.<br /><em>Not the risk.</em></h1></div>
        <div className="hero-support"><p>Setpoint preflights an intended rebalance against live vault state, liquidity evidence and onchain constraints.</p><p>Safe batches pass through. Broken batches get the largest provably safe progress—or no trade at all.</p><div><a className="primary-link" href="/app">Open Setpoint <span>→</span></a><a className="secondary-link" href="/evidence">Technical evidence</a></div></div>
      </section>

      <section className="landing-sandbox" aria-labelledby="landing-sandbox-title">
        <div className="landing-sandbox-lead"><p className="product-kicker">Setpoint Sandbox / Chain 46630</p><h2 id="landing-sandbox-title">Own the vault.<br />Move the state.</h2><p>The first product path is a wallet-owned testnet vault with real token balances, stored targets, timestamped prices, constant-product liquidity, exact simulation, and a signed rebalance.</p><a href="/app">{sandboxDeployment.status === "DEPLOYED" ? "Execute a testnet rebalance →" : "Inspect the execution surface →"}</a></div>
        <ol>
          <li><span>01</span><div><strong>Create</strong><p>The factory deploys one owner-controlled vault and seeds a bounded sandbox portfolio.</p></div></li>
          <li><span>02</span><div><strong>Analyze</strong><p>Live reserve quotes feed the unchanged hybrid solver; runtime evidence selects the mode.</p></div></li>
          <li><span>03</span><div><strong>Execute</strong><p>Your wallet signs only after exact simulation. Confirmation triggers a fresh post-state read.</p></div></li>
        </ol>
        <aside className={sandboxDeployment.status.toLowerCase()}><i /><span>{sandboxDeployment.status === "DEPLOYED" ? "LIVE TESTNET" : "BROADCAST PENDING"}</span><strong>{sandboxDeployment.status === "DEPLOYED" ? "Real contracts recorded" : "No fake addresses shown"}</strong><small>Robinhood Chain Testnet · 46630</small></aside>
      </section>

      <section className="decision-visual" aria-labelledby="decision-title">
        <div className="visual-heading"><p className="product-kicker">A real accepted decision</p><h2 id="decision-title">Full intent in.<br />Safe progress out.</h2><p>Historical fork-backed evidence · RWA Index · block 124,692,520</p></div>
        <div className="decision-track">
          <article><span>01 / INTENT</span><strong>10 legs</strong><p>60.051107% NAV attempted turnover</p></article><i>→</i>
          <article className="track-failure"><span>02 / EXACT SIMULATION</span><strong>Rejected</strong><p><code>INSUFFICIENT_OUTPUT</code></p></article><i>→</i>
          <article className="track-signal"><span>03 / SETPOINT</span><strong>3 safe legs</strong><p>22.5% NAV executed turnover</p></article><i>→</i>
          <article><span>04 / CONFIRMED STATE</span><strong>19.113279%</strong><p>drift, down from 31.025554%</p></article>
        </div>
        <div className="residual-line"><span>Residual refused</span><code>USDC → NFLX</code><strong>NO_SAFE_LIQUIDITY</strong></div>
      </section>

      <section className="how-it-works">
        <div className="section-lead"><p className="product-kicker">How it works</p><h2>One decision boundary.<br />Three honest outcomes.</h2></div>
        <ol>
          <li><span>01</span><div><h3>Read what is true now</h3><p>Current block, balances, policy, oracle freshness and vault guards come from live RPC—not a scenario file.</p></div></li>
          <li><span>02</span><div><h3>Try the simple rebalance first</h3><p>Setpoint constructs the coherent plan and simulates the exact vault call. It does not optimize what already works.</p></div></li>
          <li><span>03</span><div><h3>Adapt—or refuse</h3><p>Only recoverable execution failures can open fallback. Invalid, stale or unprovable paths remain closed.</p></div></li>
        </ol>
      </section>

      <section className="outcome-band" aria-label="Setpoint result modes"><div><span>01</span><strong>FAST_PATH</strong><p>Full batch is safe.</p></div><div><span>02</span><strong>ADAPTIVE_FALLBACK</strong><p>Smaller progress is proven.</p></div><div><span>03</span><strong>NO_TRADE</strong><p>Safety cannot be proven.</p></div></section>

      <section className="trust-section">
        <div><p className="product-kicker">Trust boundary</p><h2>Execution safety without taking custody.</h2><p>Setpoint plans and proves. The vault keeps its assets, authority and hard onchain constraints.</p></div>
        <dl><div><dt>01 / STATE</dt><dd>Authoritative vault reads</dd></div><div><dt>02 / POLICY</dt><dd>Constrained operator intent</dd></div><div><dt>03 / PREFLIGHT</dt><dd>Executable-condition checks</dd></div><div><dt>04 / GATE</dt><dd>Exact vault eth_call</dd></div></dl>
      </section>

      <section className="integration-proof integration-proof-expanded"><div className="integration-proof-lead"><p className="product-kicker">Live integration registry</p><h2>Different vaults.<br />Honest boundaries.</h2><p>Setpoint reads each protocol through its real accounting and policy surface. It does not call every ERC-4626 vault “supported” and hope the semantics match.</p><a href="/app">Open integration registry →</a></div><div className="landing-integrations"><article><span>MAINNET · FUNDED AGENTIC BASKET</span><h3>Vimen Agentic MAG7</h3><p>Current seven-stock recipe, live balances, full backing, feed freshness and hard rebalance caps.</p></article><article><span>MAINNET · LIVE PORTFOLIO</span><h3>HISS Vault V2</h3><p>USDG accounting, holdings, queue state, liveness and capacity evidence.</p></article><article><span>MAINNET · LIVE COMPATIBILITY</span><h3>Fides Frontier</h3><p>Immutable basket, full-backing proof, oracle state and rebalance guards.</p></article><article><span>TESTNET · PLAN + SIMULATE</span><h3>RWA Index</h3><p>Target allocation, simple-batch planning and exact vault simulation.</p></article></div><p className="integration-disclosure">MAG7 Index Vault and Wield remain monitored in the secondary watchlist while their deployed portfolios are empty · independent external protocols · no partnership, endorsement or custody claim</p></section>

      <section className="closing-cta"><p className="product-kicker">Live product</p><h2>See what the vault<br />can safely do now.</h2><a href="/app">Open Setpoint <span>→</span></a></section>
    </main>
    <footer className="landing-footer"><span className="footer-brand"><img alt="" className="brand-mark brand-mark-sm" height={18} src="/brand/setpoint.png" width={18} />SETPOINT © 2026</span><p>Safety and execution orchestration for onchain vault rebalances.</p><nav><a href="/evidence">Evidence</a><a className="social-link" href="https://x.com/setpointxyz" target="_blank" rel="noreferrer">X / @setpointxyz</a><a href="https://github.com/karagozemin/setpoint/blob/main/docs/SECURITY.md" target="_blank" rel="noreferrer">Security</a><a href="https://github.com/karagozemin/setpoint" target="_blank" rel="noreferrer">Source</a></nav></footer>
  </div>;
}
