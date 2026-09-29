# Setpoint

<p align="center">
  <img src="./web/public/brand/setpoint.png" alt="Setpoint logo" width="220" />
</p>

<p align="center"><strong>The execution safety layer for onchain vault rebalances.</strong></p>

Setpoint turns a vault's desired allocation into a transaction it can justify—or refuses to trade.

Portfolio policy describes where a vault should be. It does not prove that the route is executable now, that its prices are fresh, that its constraints still hold, or that the final calldata will survive the vault's own checks. Setpoint closes that gap: it reads current onchain state, validates the proposed allocation, builds the simplest coherent rebalance, simulates the exact vault call, and exposes the evidence behind the decision before an operator signs anything.

The operating principle is deliberately conservative: **do not optimize what is not broken, and do not execute what cannot be proven safe.**

| Decision | Meaning |
|---|---|
| `FAST_PATH` | The complete, simple rebalance passed policy checks and exact-vault simulation. |
| `ADAPTIVE_FALLBACK` | The simple batch failed for an explicitly recoverable reason; a smaller liquidity-aware plan independently passed the same safety gate. |
| `NO_TRADE` | State, policy, liquidity, or simulation evidence is insufficient. Setpoint fails closed. |

Setpoint is non-custodial: the browser and team never hold a user's key. Sandbox assets live in a vault whose immutable owner is the creating wallet; external vaults keep their own custody, roles, accounting, and final execution authority. No path bypasses onchain guards.

> **Architecture:** Read [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the system boundaries, decision pipeline, trust model, live execution sequence, and extension points.

## Product surfaces

The reviewed M6 application is available at [setpoint-neon.vercel.app](https://setpoint-neon.vercel.app).

| Route | Purpose | Data source | Can submit a transaction? |
|---|---|---|---|
| `/` | Product overview | Static product content | No |
| `/app`, `/app/sandbox` | Setpoint Sandbox execution first; external compatibility monitoring second | Robinhood Chain mainnet + testnet RPC | Yes—live wallet-owned sandbox vaults on testnet |
| `/app/vault/:integration` | External protocol monitoring or the legacy RWA Index workflow | Protocol-specific mainnet/testnet contracts | Capability-dependent; external authority remains required |
| `/evidence` | Historical M4.2/M5 decision evidence | Versioned repository artifacts | No |

The separation between `/app` and `/evidence` is a safety boundary. Live decisions never substitute checked-in fork artifacts for current chain state, and the evidence console cannot invoke execution code.

## What happens during a Setpoint Sandbox rebalance

The first surface in `/app` is a Setpoint-managed testnet execution environment. It uses real Robinhood Chain Testnet contracts and test-only assets, while external mainnet integrations remain a separate monitoring proof.

1. **Create or open the wallet vault.** `SetpointSandboxFactory.getVault(wallet)` resolves one owner-controlled vault per address; `createVault()` deploys and seeds a bounded 10,000 sUSDG sandbox portfolio.
2. **Store the target onchain.** The connected owner sets cash plus four supported asset weights. They must sum to exactly 100%, and no risk asset may exceed 70%.
3. **Honor hard stops.** A paused vault, stale authoritative prices, invalid NAV, unsupported integration, or invalid policy cannot produce an executable plan.
4. **Sample real liquidity.** The live adapter calls the route-restricted swap adapter at several sizes in both directions. Each quote comes from current constant-product reserves and is bound to the observed state ID.
5. **Run the frozen hybrid core.** The unchanged M2 planner is the simple path; current quote curves feed the existing M4.1/M4.2 adaptive solver when a recoverable liquidity constraint requires it.
6. **Simulate exact calldata.** Setpoint calls the real sandbox vault's `rebalance(Trade[])` entry point with the connected owner address.
7. **Return a typed decision.** Runtime state determines `FAST_PATH`, `ADAPTIVE_FALLBACK`, or `NO_TRADE`; the UI does not choose the label.
8. **Recheck before signing.** Setpoint re-reads the state ID and repeats account-specific exact simulation immediately before submission.
9. **Confirm, discard, and re-read.** After a receipt, Setpoint reads fresh chain state. It never treats predicted state as confirmed state or reuses the old plan.

RPC failures, wallet rejection, unsupported integrations, and transaction reverts are application errors—not `NO_TRADE` decisions. `NO_TRADE` is reserved for a completed Setpoint analysis that deliberately refuses execution.

## Live integration registry

This registry now appears under **Live Monitoring** below the Setpoint-owned execution surface. It demonstrates adapter breadth; it is not the primary way to try the product.

The registry recognizes six explicitly pinned external deployments. Four meaningful operator surfaces are prioritized; empty deployments remain visible in a secondary watchlist instead of occupying the primary grid. Every card checks deployed bytecode and current RPC state, and capability labels distinguish read compatibility from planning and execution.

| Integration | Network | Address | Capability |
|---|---|---|---|
| Vimen Agentic MAG7 | Robinhood Chain · `4663` | `0x39b3B771D6fAbF4eFD775Ae090AfDdf14f82520F` | Live recipe, balances, full-backing proof, feed ages, and immutable rebalance-policy analysis |
| HISS Vault V2 | Robinhood Chain · `4663` | `0x432e90b1B35995EBE46eD93B4Db369abfc230E69` | Live accounting, holdings, queue/liveness, and compatibility analysis |
| Fides Frontier | Robinhood Chain · `4663` | `0x4504483Ea748e630A9368F44f0Ee5B4350462Db8` | Live backing, constituent, oracle, guard, and compatibility analysis |
| RWA Index | Robinhood Chain testnet · `46630` | `0x357CD10343829DBd5889c7b0B2fBc4388fC4875B` | Target editing, simple-batch planning, exact simulation, and authorized submission |
| MAG7 Index Vault · watchlist | Robinhood Chain · `4663` | `0xc6ff4bc6E90a624a20D5c06679965A951a5Ba2F4` | Seven fixed legs, NAV/share, feed freshness, drift band, per-leg cap, and cooldown reads |
| Wield RWA Vault · watchlist | Robinhood Chain · `4663` | `0x7769526f55cd6B0B8a9E0Bf9e124618A0fe084de` | Live underlying registry, signed-intent policy, and compatibility analysis |

The mainnet adapters normalize only facts their native contracts expose. Vimen exposes a rotating recipe plus hard agent/maker policy; HISS has queue and keeper semantics; Fides uses backing units and a constrained rebalancer; MAG7 exposes an equal-weight vault policy; Wield requires an agent-signed allocation intent. Setpoint does not fabricate a common target-weight execution interface across them.

At the 2026-09-27 integration smoke test, Vimen Agentic MAG7 exposed 24 VMAG of fully backed seven-leg inventory but its 24-hour stock feeds were stale over the weekend; HISS V2 exposed a funded live portfolio; Fides was funded and fully backed but its own `nav()` rejected stale oracle evidence; RWA Index remained oracle-stale; and both MAG7 Index Vault and Wield reported zero issued supply and zero portfolio NAV. These labels are refreshed from RPC in `/app`; they are observations, not permanent claims.

All six are independent external technical integrations. They are not Setpoint customers, partners, endorsements, audited by Setpoint, or sources of funds managed by Setpoint. Source repositories and pinned commits are recorded in `src/live/integration-catalog.ts`; MAG7's currently unavailable source-repository link is replaced by its official protocol documentation plus a pinned runtime-bytecode hash.

### RWA Index planning boundary

RWA Index remains the only adapter that currently constructs and simulates rebalance calldata. Its external dependencies are:

| Contract | Address |
|---|---|
| Oracle | `0x2F2316d6D4a8952730a71BfCD9fa0Af5A0138AB9` |
| Synthra swap adapter | `0x6E498DB59449aF170A9525a69456154F226a4E03` |
| Mock USDC base asset | `0xFF00eA84190AeD0B1AbEF4fbC45E51258f2799BA` |

Its pinned source is included at `third_party/rwa-index` at upstream commit `b2456ca5400ba9ec36d81691554b889fb9250513`.

At the recorded M6 verification, all five configured oracle observations exceeded the vault's 24-hour freshness limit. Setpoint therefore exposed live balances and targets while withholding authoritative NAV, weights, and drift, and returned `NO_TRADE / STALE_PRICE`. The application never reconstructs authoritative accounting from stale prices.

Two integration constraints shape the current live boundary:

- Live workspaces resolve the latest block first, then pin accounting, policy, oracle, bytecode, and reserve calls to that explicit block identity (number or EIP-1898 hash, depending on RPC support). Setpoint still re-reads state and exact-simulates immediately before submission because state can change after the snapshot.
- The deployed swap adapter exposes no verified public quote method for executable depth. A failed full live batch therefore fails closed; historical fork liquidity curves are never inserted into the live decision path.

Live `ADAPTIVE_FALLBACK` will remain unavailable until an integration can supply current, state-bound, executable quote evidence.

## Setpoint Sandbox contracts

The root [`contracts`](./contracts) Foundry workspace contains the Setpoint-owned testnet path:

| Contract | Why it exists |
|---|---|
| `SetpointSandboxFactory` | Resolves one vault per wallet and enforces a 32-vault / 320,000 sUSDG global seed budget before deploying the documented initial portfolio. |
| `SetpointSandboxVault` | Holds real sandbox ERC-20 balances, stores owner-selected targets, and enforces route, size, oracle, slippage, drift, and NAV-loss guards. |
| `SetpointSandboxOracle` | Stores immutable sandbox reference prices and refreshable timestamps; any caller can renew approved timestamps, while stale values still stop execution. |
| `SetpointSandboxPool` | Holds real token reserves and executes fee-bearing constant-product swaps. Each route has 50,000,000 sUSDG of base depth. |
| `SetpointSandboxSwapAdapter` | Exposes quotes and swaps only for registered sUSDG/risk-asset routes; arbitrary external calls are impossible. |
| `SetpointSandboxToken` | Clearly labeled, mint-restricted testnet assets with no production value or redemption claim. |

The checked [`deployment record`](./deployments/setpoint-sandbox-rh-testnet.json) is live on Robinhood Chain Testnet from block `125959056`. The core addresses are:

| Contract | Address |
|---|---|
| Factory | [`0x2502…733a`](https://explorer.testnet.chain.robinhood.com/address/0x250270a045cab2C7221A359AC785A5C41159733a) |
| Oracle | [`0x1B8D…2e23`](https://explorer.testnet.chain.robinhood.com/address/0x1B8D09ae751833701fFb4391e2189f0DDdA32e23) |
| Swap adapter | [`0x0966…7Fa0`](https://explorer.testnet.chain.robinhood.com/address/0x09668263b912653480c6fdF9154D2EC731177Fa0) |
| Base asset | [`0x5aD7…352E`](https://explorer.testnet.chain.robinhood.com/address/0x5aD7Ae80Dcc5195E195f12967c3627Ee87Ef352E) |

The acceptance wallet [created](https://explorer.testnet.chain.robinhood.com/tx/0x6167672ae74d90c435f96d23cf74e275079b1a6a49db9f54de15240f0796195d) vault [`0x3Ee0…7A0`](https://explorer.testnet.chain.robinhood.com/address/0x3Ee0d6Ac3007909B44845986785c0F3846E7e7A0), [stored targets onchain](https://explorer.testnet.chain.robinhood.com/tx/0x8199747d9e1005ba9578c994e07867efd071c7b6eb160bdb97e738454794b9e9), and completed a four-leg `FAST_PATH` [rebalance](https://explorer.testnet.chain.robinhood.com/tx/0xefdb3c9441056cf383f9d8bdae8e0586e61e3d0209fc2b025030fc7af9cbb710) at block `125960618`. Confirmed drift fell from `45.0000%` to `0.0281%`. A separate [permissionless heartbeat](https://explorer.testnet.chain.robinhood.com/tx/0x681d76cda5748175e244b69b56fce99c36be61610164261ee0e71c81c1c4ee8c) renewed all immutable references. If the record is ever absent or explicitly reset to `UNDEPLOYED`, the UI fails closed instead of substituting zero addresses or local data. The superseded deployment remains unchanged under [`deployments/history`](./deployments/history/).

## Wallet and execution model

All external compatibility reads require no wallet. MetaMask, Rabby, and other EIP-1193 wallets are used for sandbox vault creation, target updates, and rebalances, plus the legacy RWA Index authorized path.

- A sandbox vault's immutable `owner` is the wallet that called the factory; there is no Setpoint backend signer or relayer.
- Only that owner can store targets or call `rebalance`.
- Every submitted plan is current-state-bound and exact-simulated again before `writeContract`.
- The wallet holds the private key. Setpoint neither receives nor persists it.

- Setpoint checks the external vault's `MANAGER_ROLE` and active agent-session authorization.
- Unauthorized wallets can analyze, copy calldata, and export an execution request.
- Authorized wallets must pass a fresh state read and account-specific simulation before `writeContract`.
- Wallet cancellation is reported as `WALLET_REJECTION`; a submitted transaction failure is `TRANSACTION_REVERT`.
- A confirmed transaction is followed by a state re-read and explorer-linked receipt.

External integrations retain their own authority model and never inherit sandbox permissions.

## Safety model

The decision boundary is default-closed:

- stale or missing authoritative prices stop planning;
- invalid targets and unsupported assets stop before simulation;
- only USDC-hub routes accepted by the integration may be constructed;
- every executable candidate must pass the exact target-vault call;
- fallback is limited to an explicit recoverable-failure allowlist;
- unknown reverts cannot activate fallback;
- a successful state transition invalidates the previous plan; and
- custody and authorization remain external to Setpoint.

The recoverable hybrid-core allowlist is `INSUFFICIENT_OUTPUT`, `TRADE_TOO_LARGE`, `INSUFFICIENT_BALANCE`, `DRIFT_NOT_IMPROVED`, and `EXCESSIVE_VALUE_LOSS`. Every other failure is non-recoverable unless the code and its evidence are deliberately changed.

See [docs/SECURITY.md](./docs/SECURITY.md) for trust assumptions, demonstrated invariants, threat coverage, and explicit non-goals. This repository does not claim an audit or formal verification.

## Architecture at a glance

The repository has four deliberately separate planes:

| Plane | Primary paths | Responsibility |
|---|---|---|
| Decision core | `src/core/` | Chain-independent policy, hybrid selection, adaptive sizing, and typed evidence. |
| Setpoint execution | `contracts/`, `src/sandbox/`, `web/live/SandboxExecute.tsx` | Wallet-specific vaults, real pool quotes/swaps, onchain targets, exact simulation, signing, and confirmed-state reads. |
| Live product | `src/live/`, `web/live/` | Multi-vault registry, protocol-specific RPC reads, compatibility analysis, plus RWA Index planning, simulation, authorization, and submission. |
| Evidence | `artifacts/`, `web/data/`, `web/components/` | Read-only presentation of accepted fork and deterministic test results. |

React does not implement portfolio math, evidence artifacts do not enter live analysis, and the live adapter does not claim adaptive execution without a truthful quote source.

For component ownership, diagrams, state transitions, error taxonomy, deployment details, and guidance for adding an integration, continue to the **[complete architecture guide](./docs/ARCHITECTURE.md)**.

## Local development

Prerequisites:

- Node.js 20 or newer;
- pnpm 10.17.1 via Corepack;
- Foundry tools for historical fork runners; and
- network access to the public Robinhood Chain mainnet and testnet RPCs for live checks.

```bash
git submodule update --init --recursive
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:5173`. Public vault reads work without connecting a wallet.

## Verification

Run the normal repository gates:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm demo:check
pnpm security:demo
pnpm integrations:smoke
pnpm live:smoke
pnpm sandbox:contracts
```

Sandbox operations are explicit and credential-gated:

```bash
# Never commit or print this value.
export SETPOINT_SANDBOX_DEPLOYER_KEY=0x...
export RH_TESTNET_RPC=https://rpc.testnet.chain.robinhood.com # optional default

pnpm sandbox:deploy          # dry-run/gas estimate, broadcast, record, smoke
pnpm sandbox:oracle-status   # read-only freshness report
pnpm sandbox:refresh-oracle  # permissionless immutable-price heartbeat transaction
pnpm sandbox:smoke           # bytecode/topology/reserve/quote/oracle checks
pnpm sandbox:e2e             # wallet vault, targets, exact simulation, rebalance, post-state
```

The deploy command also loads the ignored root `.env` file and accepts `PRIVATE_KEY` as a compatibility alias. A 64-character hex value without `0x` is normalized in process memory only; the secret file is not rewritten.

The sandbox oracle keeps a 24-hour freshness guard. Its approved reference values become immutable at initialization; permissionless `refreshPrices` can renew only those values' timestamps and cannot supply a price. The scheduled GitHub Action renews the heartbeat every six hours with `SETPOINT_SANDBOX_REFRESHER_KEY`, and any connected sandbox-vault owner can recover a stale deployment from the UI. If automation and all callers stop submitting refresh transactions, analysis and execution correctly lock as `STALE_PRICE`. This is explicitly a static testnet-reference model, not a production oracle design.

Both smoke commands are read-only. `pnpm integrations:smoke` checks all six registered deployments and reports current readiness without upgrading degraded or empty state to “ready.” `pnpm live:smoke` performs the deeper RWA Index planning-path checks, including exact `eth_call` capability. Results depend on external RPC and contract state.

Browser reads use the fixed same-origin `/rpc/mainnet` and `/rpc/testnet` pass-through routes configured in Vite and Vercel. This avoids the upstream public RPC's intermittent invalid duplicate CORS header without introducing caching or a Setpoint data API. CLI smoke tests continue to call the public RPC origins directly.

Historical milestones remain reproducible independently:

```bash
pnpm m1:rwa-index
pnpm m2:baseline
pnpm m3:solver
pnpm m4:adaptive
pnpm m4:batch
pnpm m4:hybrid
```

## Evidence

The `/evidence` surface preserves the accepted historical flows without presenting them as current chain observations:

- ordinary rebalance → `FAST_PATH`;
- large target → `INSUFFICIENT_OUTPUT` → `ADAPTIVE_FALLBACK` → safe three-leg subset;
- stale oracle → `NO_TRADE`; and
- invalid policy, unsupported route, unsafe residual liquidity, and unknown-revert security cases.

The large-target fork proof records 31.025554% initial drift, 10 attempted legs, 60.051107% NAV attempted turnover, a real-vault `INSUFFICIENT_OUTPUT`, three executed safe legs, 22.5% NAV executed turnover, 19.113279% confirmed drift, and a refused USDC→NFLX residual. Fork transaction hashes are evidence identifiers, not public-chain transaction links.

## Repository map

```text
src/core/                       chain-independent solver and hybrid semantics
src/sandbox/                    Setpoint Sandbox ABI, config, live reads, quote sampling, simulation, and execution
src/live/integration-catalog.ts registered deployments and capability boundaries
src/live/integration-read-adapters.ts mainnet protocol-specific read adapters
src/live/rwa-index-live-adapter.ts planning, simulation, and execution adapter
web/live/                       integration registry, compatibility UI, and wallet workflow
contracts/                      Setpoint-owned Foundry contracts, tests, and deployment script
deployments/                    recorded live testnet topology, block, and transaction hashes
web/data/                       artifact-to-view-model adapters
web/components/                 historical evidence presentation
web/Landing.tsx                 product landing page
web/Router.tsx                  /, /app, and /evidence routing
integrations/rwa-index/         accepted planner, ABI, fork harness, and probes
artifacts/                      versioned historical and security evidence
security/                       deterministic security scenarios
scripts/live-smoke.ts           non-mutating public-RPC validation
scripts/integration-smoke.ts    six-integration bytecode/state validation
config/rwa-index.json           verified external deployment configuration
third_party/rwa-index/          pinned external source
docs/                           architecture, security model, and decisions
```

## Project status and limits

M1 established external-vault compatibility on a disposable fork. M2 froze the static control planner. M3 added deterministic simulation-gated planning. M4 and M4.1 introduced executable-liquidity sampling and adaptive multi-leg planning. M4.2 adopted simple-first hybrid orchestration. M5 turned accepted artifacts into an evidence console. M6 separated a real live operator product from historical evidence. The current milestone adds the Setpoint-owned sandbox contract and product path without changing the frozen core.

The mainnet surfaces remain read-only technical integrations; they do not imply Setpoint-managed production execution. The sandbox uses test-only assets and deliberately bounded liquidity. Setpoint has no production custody, token, governance, private RPC credential, cross-venue routing, relayer, or production capital. A random visitor owns only the sandbox vault their wallet creates and never inherits authority over an external vault.

The public sandbox factory does not claim proof-of-personhood. It contractually caps the deployment at 32 seeded vaults and 320,000 sUSDG of total initial NAV, while every route starts with 50,000,000 sUSDG of base depth. Even if the entire global seeded inventory is pushed through one route, the recorded deployment's smoke test requires both directions to remain above the vault's 97% oracle-output floor. The 33rd distinct wallet is rejected with `SeedBudgetExhausted`; this finite-capacity tradeoff bounds shared-liquidity griefing but means a fully consumed factory requires a new deployment for additional users.

## Documentation

- [Architecture](./docs/ARCHITECTURE.md) — system structure, runtime flows, boundaries, and extension model
- [Security model](./docs/SECURITY.md) — assumptions, invariants, threat coverage, and reproduction
- [Decision 0001](./docs/decisions/0001-hybrid-rebalance-orchestration.md) — why Setpoint is simple-first and adaptive only when justified
- [Decision 0002](./docs/decisions/0002-live-product-boundary.md) — why live state and historical evidence remain isolated
- [Decision 0003](./docs/decisions/0003-wallet-owned-testnet-sandbox.md) — why the primary product path is a wallet-owned testnet protocol
- [Build log](./BUILD_LOG.md) — milestone-by-milestone implementation record
