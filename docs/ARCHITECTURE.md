# Setpoint architecture

## 1. Purpose

Setpoint is a non-custodial decision and execution-safety layer for onchain vault rebalances. Its job is not to own the portfolio or invent authority. Its job is to turn current vault state plus a proposed target allocation into one of three explicit outcomes:

- `FAST_PATH`: the complete simple batch is safe enough to present for execution;
- `ADAPTIVE_FALLBACK`: an explicitly recoverable simple-batch failure was replaced by a smaller independently verified plan; or
- `NO_TRADE`: Setpoint cannot prove a safe execution path.

This document describes the M6 repository architecture, including a crucial implementation distinction:

- the **chain-independent hybrid core** contains all three decision modes and is demonstrated by deterministic and fork-backed evidence;
- the **current live RWA Index adapter** can return `FAST_PATH` or `NO_TRADE`, but deliberately cannot invoke adaptive fallback because the deployed venue exposes no trustworthy public executable-quote interface.

That distinction is a safety property, not a missing UI state.

## 2. Architectural principles

The system is organized around six invariants.

1. **Simple first.** If one coherent batch satisfies policy, liquidity preflight, and exact-vault simulation, Setpoint does not decompose it.
2. **Fail closed.** Missing, stale, unsupported, or unclassified evidence cannot produce execution.
3. **Simulation gates execution.** A plan is not executable merely because local math says it should work.
4. **State is disposable.** A plan belongs to the state from which it was derived. After a confirmed transition, Setpoint discards it and reads again.
5. **Authority stays external.** The vault owns assets, roles, sessions, accounting, and hard guards. Setpoint cannot elevate a wallet.
6. **Evidence never impersonates live data.** Fork artifacts are useful proofs, but they are never inputs to `/app`.

## 3. System context

Setpoint is currently a browser-delivered static application. There is no Setpoint API server, database, relayer, signing service, or deployed Setpoint contract in the execution path.

```mermaid
flowchart LR
    Operator[Operator]

    subgraph Browser[Setpoint browser application]
        Landing[Product surface]
        Live[Live operator UI<br/>/app]
        Evidence[Evidence console<br/>/evidence]
        Adapter[RWAIndexLiveAdapter]
        ArtifactAdapter[Read-only artifact adapters]
    end

    Wallet[Injected EIP-1193 wallet]
    RPC[Robinhood Chain testnet RPC]
    Vault[External RWA Index vault]
    Oracle[External oracle]
    Swap[External swap adapter]
    Artifacts[Versioned JSON evidence]

    Operator --> Landing
    Operator --> Live
    Operator --> Evidence
    Live --> Adapter
    Adapter --> RPC
    Live <--> Wallet
    Wallet --> RPC
    RPC --> Vault
    Vault --> Oracle
    Vault --> Swap
    Evidence --> ArtifactAdapter --> Artifacts
```

The browser communicates directly with public chain infrastructure. Transaction signing remains inside the injected wallet. Historical JSON is bundled as static application data and has no route to the live adapter.

## 4. Runtime surfaces and boundaries

| Surface | Code owner | Input | Output | Explicitly cannot do |
|---|---|---|---|---|
| Landing | `web/Landing.tsx` | Static content | Product explanation and navigation | Read chain state or submit transactions |
| Live application | `web/live/` | Operator allocation and wallet events | Live state, typed analysis, calldata, execution status | Implement portfolio math or consume evidence artifacts |
| Live integration | `src/live/` | RPC state, allocation, optional account/provider | Validated state, simulation result, optional submission | Claim adaptive liquidity without a live quote source |
| Decision core | `src/core/` | Normalized state, policy, prices, liquidity, simulator | `FAST_PATH`, `ADAPTIVE_FALLBACK`, or `NO_TRADE` with evidence | Read an RPC, sign, submit, or mutate a vault |
| Evidence presentation | `web/data/`, `web/components/` | Checked-in JSON artifacts | Read-only scenario view models | Import execution solvers or submit transactions |
| Integration harness | `integrations/rwa-index/` | External ABI/source and fork state | Static plans, quotes, fork execution evidence | Represent fork observations as live state |

The separation is enforced structurally and tested. `RWAIndexLiveAdapter` owns the live integration workflow; React owns interaction and presentation. The evidence console maps artifacts into view models without importing the execution core.

## 5. Component architecture

```mermaid
flowchart TB
    subgraph Presentation
        Router[web/Router.tsx]
        Landing[web/Landing.tsx]
        LiveUI[web/live/LiveApp.tsx]
        EvidenceUI[web/App.tsx + components]
    end

    subgraph LiveBoundary[Live integration boundary]
        LiveAdapter[src/live/rwa-index-live-adapter.ts]
        LiveTypes[src/live/types.ts]
        LiveConfig[src/live/config.ts]
        Wallet[web/live/wallet.ts]
    end

    subgraph Decision[Decision engines]
        Static[Accepted static planner<br/>integrations/rwa-index/src/baseline.ts]
        Hybrid[src/core/hybrid-solver.ts]
        Adaptive[src/core/batch-solver.ts<br/>adaptive-solver.ts]
        Policy[src/core/policy.ts]
    end

    subgraph Proof[Evidence and verification]
        DataAdapters[web/data/]
        Artifacts[artifacts/]
        Security[security/]
        Harness[integrations/rwa-index/test + scripts]
    end

    Router --> Landing
    Router --> LiveUI
    Router --> EvidenceUI
    LiveUI --> LiveAdapter
    LiveUI --> Wallet
    LiveAdapter --> LiveTypes
    LiveAdapter --> LiveConfig
    LiveAdapter --> Static
    Hybrid --> Adaptive
    Hybrid --> Policy
    EvidenceUI --> DataAdapters --> Artifacts
    Security --> Hybrid
    Harness --> Static
    Harness --> Hybrid
```

### Why the live adapter does not call the hybrid core

The accepted hybrid core requires executable-liquidity curves bound to current state. The current Synthra deployment does not expose a verified public quote method that can provide those curves without fork-only state mutation. Calling the hybrid core with historical curves would make the result look live while depending on old evidence.

The live adapter therefore reuses only the accepted static planner, performs an exact `eth_call`, and returns `NO_TRADE / SIMULATION_REJECTED` if that batch fails. Its result type exposes `adaptiveFallbackAvailable: false` so this boundary is machine-visible as well as documented.

## 6. Live decision pipeline

The live pipeline is intentionally narrower than the full hybrid engine.

```mermaid
flowchart TD
    Start([Analyze]) --> Read[Read latest vault, oracle,<br/>guards, balances, and roles]
    Read --> Integration{Registered deployment<br/>matches?}
    Integration -- No --> AppError[Application error:<br/>unsupported integration or RPC]
    Integration -- Yes --> Policy{Allocation valid?}
    Policy -- No --> Invalid[NO_TRADE<br/>INVALID_POLICY]
    Policy -- Yes --> Pause{Vault paused?}
    Pause -- Yes --> Paused[NO_TRADE<br/>VAULT_PAUSED]
    Pause -- No --> Fresh{All prices current?}
    Fresh -- No --> Stale[NO_TRADE<br/>STALE_PRICE]
    Fresh -- Yes --> Accounting{NAV and drift valid?}
    Accounting -- No --> InvalidNav[NO_TRADE<br/>INVALID_NAV]
    Accounting -- Yes --> Build[Build complete simple batch]
    Build --> Legs{Non-zero legs?}
    Legs -- No --> Reached[NO_TRADE<br/>TARGET_REGION_REACHED]
    Legs -- Yes --> Sim[Simulate exact<br/>rebalance Trade array]
    Sim --> Passed{Simulation passed?}
    Passed -- Yes --> Fast[FAST_PATH]
    Passed -- No --> Quote{Truthful live executable<br/>quote source available?}
    Quote -- No, current M6 --> Rejected[NO_TRADE<br/>SIMULATION_REJECTED]
    Quote -. Future integration .-> Hybrid[Hybrid adaptive pipeline]
```

### State acquisition

`readVaultState()` validates the requested vault against the registered deployment, then reads:

- chain ID, latest block number/hash/timestamp;
- vault assets, base asset, oracle, and swap-adapter addresses;
- balances, token metadata, target weights, and oracle observations;
- vault pause, drift, trade-size, slippage, staleness, and loss guards; and
- `MANAGER_ROLE` plus active agent-session authorization for an optional account.

Integration addresses are checked against `src/live/config.ts`. Assets are currently required to use the verified deployment's 18-decimal representation.

The public RPC rejects historical `eth_call` at its own reported head, so the adapter cannot claim an atomic block-pinned snapshot. It uses batched `latest` read windows and retains the observed latest block as provenance. This is weaker than archival block pinning; the compensating control is a fresh state read and account-specific exact simulation immediately before a transaction is sent.

### Accounting under stale prices

The oracle is authoritative for this integration. When any observation exceeds `maxStaleness`, Setpoint still exposes raw balances, targets, timestamps, and guards, but sets NAV, asset values, weights, and drift to unavailable. It does not silently calculate a substitute NAV from stale inputs.

### Allocation validation

The live adapter requires:

- one proposed weight for every configured asset;
- no unregistered asset key;
- no negative weight;
- at most 80% for each non-cash asset; and
- exactly 100% across cash and assets.

The edited proposal is analysis input. It does not mutate the vault's stored target configuration. The browser stores a valid proposal in local storage for operator convenience; it does not store signing keys or execution authority.

### Batch construction and simulation

The static planner constructs the RWA Index-style batch under the vault's `maxTradeFraction` and `slippageTolerance`. Calldata is encoded for the exact external `rebalance(Trade[])` ABI. Analysis simulation uses the configured manager identity so that authorization noise does not hide whether the plan itself would pass the vault.

This simulation is evidence for a decision, not authority to execute. The connected wallet is checked independently.

## 7. Full hybrid decision core

The chain-independent core accepts normalized state and injected adapters rather than importing chain clients. Its main contracts are:

| Contract | Role |
|---|---|
| `PortfolioState` | State ID, block provenance, NAV, cash, drift, and positions |
| `VaultPolicy` | Target bands, drift trigger, trade/loss/age limits, and pause state |
| `PricePoint` | WAD price, update time, and source |
| `Trade` | `tokenIn`, `tokenOut`, `amountIn`, and `minAmountOut` |
| `SimulationAdapter` | Injected exact-execution gate for a candidate batch |
| `RebalancePlan` | Accepted plan plus expected effects, constraints, simulation, and rejected alternatives |
| `NoTradeResult` | Typed refusal with reason and supporting details |

`solveHybrid()` follows this order:

1. validate policy, state, prices, and routes;
2. stop if the target region is already reached or drift is below its trigger;
3. preflight the simple batch against order, balance, leg-size, min-out, turnover, cash, loss, and quote constraints;
4. simulate the exact simple batch;
5. return `FAST_PATH` if both preflight and simulation pass;
6. invoke adaptive planning only if every blocking condition is recoverable;
7. independently simulate the adaptive candidate; and
8. return `ADAPTIVE_FALLBACK` or typed `NO_TRADE` with rejected alternatives and excluded legs.

The recoverable simulation failures are intentionally closed over a small allowlist:

- `INSUFFICIENT_OUTPUT`
- `TRADE_TOO_LARGE`
- `INSUFFICIENT_BALANCE`
- `DRIFT_NOT_IMPROVED`
- `EXCESSIVE_VALUE_LOSS`

Stale inputs, invalid policy, unsupported routes/assets, loose min-out construction, authorization failures, and unknown reverts cannot activate fallback.

### Liquidity evidence

Adaptive decisions require state-bound quote samples, not nominal pool balances. A sample records the exact direction and size, expected output, oracle output, price impact, quote loss, compatibility with `minAmountOut`, source state, and age. The planner records the selected sample and binding constraint for every accepted leg and preserves excluded or rejected alternatives.

That evidence model is why the solver can explain not only what it selected, but also why apparently useful residual trades were refused.

## 8. Transaction lifecycle

Analysis and execution are separate state transitions. An analysis can be exported without a wallet; execution requires current external authority.

```mermaid
sequenceDiagram
    actor O as Operator
    participant UI as Live UI
    participant A as Live adapter
    participant RPC as Public RPC
    participant W as EIP-1193 wallet
    participant V as External vault

    O->>UI: Analyze proposed allocation
    UI->>A: analyzeRebalance(allocation, account?)
    A->>RPC: Read current state and guards
    A->>RPC: eth_call rebalance(trades) as configured manager
    RPC-->>A: Pass or revert
    A-->>UI: FAST_PATH or NO_TRADE + evidence

    alt Wallet is not authorized
        UI-->>O: Copy calldata / export request
    else Wallet is authorized and operator confirms
        O->>UI: Execute
        UI->>A: execute(analysis, provider, account)
        A->>RPC: Re-read state, role, and session
        A->>RPC: Re-simulate exact batch as connected account
        A->>W: Request signature and submission
        W->>V: rebalance(trades)
        V-->>RPC: Transaction receipt
        A->>RPC: Read confirmed post-transaction state
        A-->>UI: Receipt + before/after state
    end
```

The execution method accepts only a simulation-approved `FAST_PATH` result with calldata. It then:

1. reads current vault state with the connected account;
2. verifies manager-role or active-session authority;
3. re-simulates the same trades as that account;
4. asks the wallet to submit;
5. waits for the receipt; and
6. reads post-confirmation state.

There is still an unavoidable interval between simulation and mining. The external vault's hard guards remain the final protection if state changes in that interval.

## 9. Authority and custody boundary

| Capability | Setpoint | External vault / wallet |
|---|---:|---:|
| Read public state | Yes | Provides state |
| Propose an allocation for analysis | Yes | No mutation implied |
| Build and simulate calldata | Yes | Vault code determines success |
| Hold portfolio assets | No | Vault |
| Grant manager or session rights | No | Vault administration |
| Hold or export a private key | No | Wallet |
| Approve a signature | No | Operator in wallet |
| Enforce final onchain guards | No | Vault |

No Setpoint contract participates in execution. Adding a contract that the transaction path does not rely on would increase surface area without moving a trust boundary.

## 10. Error and decision taxonomy

Setpoint keeps product decisions distinct from infrastructure and user-interaction errors.

| Category | Examples | Meaning |
|---|---|---|
| Decision | `STALE_PRICE`, `INVALID_POLICY`, `SIMULATION_REJECTED` | Analysis completed and deliberately returned `NO_TRADE` |
| RPC/application | RPC unavailable, chain mismatch, unsupported vault | The system could not complete a valid analysis |
| Wallet | disconnected provider, rejected signature, failed network switch | The operator or wallet stopped the workflow |
| Transaction | submitted call reverted or receipt failed | Execution failed after the analysis boundary |

Collapsing these into `NO_TRADE` would make safety decisions indistinguishable from outages, so the UI preserves them as different states.

## 11. Evidence architecture and provenance

The evidence plane is immutable at runtime:

```text
fork/test runner
    -> versioned JSON artifacts
    -> web/data adapters
    -> read-only evidence view models
    -> /evidence
```

Artifacts record scenario metadata, fork source block, before/after portfolio state, selected and excluded legs, simulation results, turnover, drift, and terminal reason. The UI never treats fork transaction hashes as public-chain transactions.

Evidence levels are explicit:

- **live RPC:** current external reads shown in `/app`;
- **fork evidence:** real contract behavior against a disposable fork;
- **integration-test evidence:** deterministic fixtures exercising policy and failure boundaries; and
- **static presentation:** rendering of already accepted artifacts.

The security generator also records source hashes, including the frozen M2 planner hash, so a regenerated proof fails if a protected implementation changes unexpectedly.

## 12. Deployment architecture

The production build is a Vite static bundle deployed on Vercel.

- `web/Router.tsx` selects `/`, `/app`, or `/evidence` in the browser.
- Vercel rewrites application routes to `index.html`.
- Live and evidence bundles are lazy-loaded as separate route surfaces.
- The Content Security Policy permits network connections only to the application origin and the Robinhood Chain testnet RPC.
- Framing, objects, camera, microphone, geolocation, and payment APIs are disabled by response headers.
- There is no server-side secret or environment-specific signing credential.

Because `/app` is client-side, its RPC URL and registered contract addresses are public configuration, not secrets.

## 13. Verification strategy

| Layer | Primary command | What it establishes |
|---|---|---|
| Type contracts | `pnpm typecheck` | Node and web TypeScript boundaries compile |
| Unit/integration | `pnpm test` | Solver behavior, live adapter behavior, data adapters, and security invariants |
| Product build | `pnpm build` | The browser application compiles and bundles |
| Evidence UI | `pnpm demo:check` | Accepted artifact flows remain renderable and internally consistent |
| Security cases | `pnpm security:demo` | Five scenarios and 11 fail-closed invariants regenerate deterministically |
| External read path | `pnpm live:smoke` | Current chain, bytecode, addresses, guards, oracle reads, and `eth_call` capability |
| Fork milestones | `pnpm m1:rwa-index` through `pnpm m4:hybrid` | Historical compatibility and planning evidence |

`live:smoke` is the only normal gate above whose result is inherently dependent on an external network and mutable contract state.

## 14. Adding another live integration

A new integration should be a new adapter, not a conditional expansion of React portfolio logic. At minimum it must define and prove:

1. **Identity:** chain ID, supported vault addresses, ABI, base asset, oracle, and execution venue.
2. **Authoritative reads:** balances, targets, accounting values, timestamps, guards, and block provenance.
3. **Normalization:** token decimals, WAD conversions, supported assets, and route rules.
4. **Policy validation:** complete target semantics and integration-specific limits.
5. **Planning:** a deterministic simple-batch constructor with visible unsupported legs.
6. **Simulation:** the exact target-vault call with an identity that separates plan validity from user authorization.
7. **Authorization:** the vault-native role/session checks required for submission.
8. **Execution:** account-specific re-simulation, wallet submission, receipt handling, and confirmed-state re-read.
9. **Liquidity proof:** if adaptive mode is exposed, current executable quotes bound to the same state and exact trade sizes.
10. **Failure mapping:** typed decision reasons kept separate from RPC, wallet, and transaction errors.
11. **Tests and evidence:** normal, stale, invalid, unsupported, recoverable, unknown-revert, and state-transition cases.
12. **Security review:** updated trust assumptions, CSP endpoints, and threat analysis.

An integration is not adaptive-capable merely because a pool has reserves or a quote can be estimated locally. It must provide evidence that matches the actual route, direction, size, state, and execution constraints.

## 15. Known limitations and non-goals

The current system deliberately does not provide:

- production funds or a production vault integration;
- custody, key management, role administration, or transaction relaying;
- a private RPC, indexer, backend database, or atomic archival read service;
- live adaptive fallback for the current Synthra deployment;
- cross-venue routing, cross-vault netting, or MEV protection;
- protection from a malicious-but-fresh oracle, compromised RPC, compromised wallet, or bugs in external contracts; or
- an audit or formal-verification claim.

The testnet integration also uses mock assets and toy venue liquidity. These constraints are visible in the product because hiding them would weaken the meaning of every decision the product returns.

## 16. Related decisions

- [Decision 0001: Hybrid rebalance orchestration](./decisions/0001-hybrid-rebalance-orchestration.md)
- [Decision 0002: Live product and evidence boundary](./decisions/0002-live-product-boundary.md)
- [Security model and failure evidence](./SECURITY.md)
- [Repository overview](../README.md)

