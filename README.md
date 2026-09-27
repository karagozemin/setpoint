# Setpoint

<p align="center">
  <img src="./web/public/brand/setpoint.png" alt="Setpoint logo" width="180" />
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

Setpoint is non-custodial. It does not hold assets, grant execution authority, replace vault accounting, or bypass onchain guards. The integrated vault remains the authority for custody, roles, and final execution.

> **Architecture:** Read [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the system boundaries, decision pipeline, trust model, live execution sequence, and extension points.

## Product surfaces

The reviewed M6 application is available at [setpoint-neon.vercel.app](https://setpoint-neon.vercel.app).

| Route | Purpose | Data source | Can submit a transaction? |
|---|---|---|---|
| `/` | Product overview | Static product content | No |
| `/app` | Live vault analysis and operator workflow | Robinhood Chain testnet RPC | Yes, only for a vault-authorized wallet |
| `/evidence` | Historical M4.2/M5 decision evidence | Versioned repository artifacts | No |

The separation between `/app` and `/evidence` is a safety boundary. Live decisions never substitute checked-in fork artifacts for current chain state, and the evidence console cannot invoke execution code.

## What happens during a rebalance

1. **Read current state.** Setpoint retrieves the vault's assets, balances, targets, oracle observations, guards, integration addresses, and operator authorization.
2. **Validate the proposal.** Allocations must be complete, supported, non-negative, within the per-asset bound, and sum to exactly 100%.
3. **Honor hard stops.** A paused vault, stale authoritative prices, invalid NAV, unsupported integration, or invalid policy cannot produce an executable plan.
4. **Build the simple batch.** The frozen RWA Index planner creates a coherent, sell-before-buy rebalance under the vault's trade and slippage limits.
5. **Simulate exact calldata.** Setpoint calls the real vault's `rebalance(Trade[])` entry point with the configured manager identity.
6. **Return a typed decision.** A passing call becomes `FAST_PATH`; an unprovable live path becomes `NO_TRADE`. Historical hybrid evidence demonstrates when `ADAPTIVE_FALLBACK` can safely rescue a recoverable failure.
7. **Separate analysis from authority.** An unauthorized operator can inspect and export calldata. Only an externally authorized wallet receives the execution action.
8. **Recheck before signing.** Setpoint reads authorization again and repeats exact simulation using the connected account immediately before submission.
9. **Confirm, discard, and re-read.** After a receipt, Setpoint reads fresh chain state. It never treats predicted state as confirmed state or reuses the old plan.

RPC failures, wallet rejection, unsupported integrations, and transaction reverts are application errors—not `NO_TRADE` decisions. `NO_TRADE` is reserved for a completed Setpoint analysis that deliberately refuses execution.

## Live integration

The registered live adapter targets the external RWA Index deployment on Robinhood Chain testnet (`chainId 46630`).

| Contract | Address |
|---|---|
| Vault | `0x357CD10343829DBd5889c7b0B2fBc4388fC4875B` |
| Oracle | `0x2F2316d6D4a8952730a71BfCD9fa0Af5A0138AB9` |
| Synthra swap adapter | `0x6E498DB59449aF170A9525a69456154F226a4E03` |
| Mock USDC base asset | `0xFF00eA84190AeD0B1AbEF4fbC45E51258f2799BA` |

RWA Index is an external technical integration target. It is not a Setpoint customer, partner, production deployment, or source of funds managed by Setpoint. Its pinned source is included at `third_party/rwa-index` at upstream commit `b2456ca5400ba9ec36d81691554b889fb9250513`.

At the recorded M6 verification, all five configured oracle observations exceeded the vault's 24-hour freshness limit. Setpoint therefore exposed live balances and targets while withholding authoritative NAV, weights, and drift, and returned `NO_TRADE / STALE_PRICE`. The application never reconstructs authoritative accounting from stale prices.

Two integration constraints shape the current live boundary:

- The public RPC accepts `latest` reads but rejects explicit block-number `eth_call` at its reported head. Setpoint batches a latest-state read window, records the observed block as provenance, and simulates again immediately before submission.
- The deployed swap adapter exposes no verified public quote method for executable depth. A failed full live batch therefore fails closed; historical fork liquidity curves are never inserted into the live decision path.

Live `ADAPTIVE_FALLBACK` will remain unavailable until an integration can supply current, state-bound, executable quote evidence.

## Wallet and execution model

Public analysis requires no wallet. MetaMask, Rabby, and other EIP-1193 wallets are used only for network detection, authorization checks, and transaction submission.

- Setpoint checks the external vault's `MANAGER_ROLE` and active agent-session authorization.
- Unauthorized wallets can analyze, copy calldata, and export an execution request.
- Authorized wallets must pass a fresh state read and account-specific simulation before `writeContract`.
- Wallet cancellation is reported as `WALLET_REJECTION`; a submitted transaction failure is `TRANSACTION_REVERT`.
- A confirmed transaction is followed by a state re-read and explorer-linked receipt.

There is no Setpoint-owned smart-contract deployment in this repository. The external vault already enforces the relevant execution authority and hard guards; adding an unused registry or forwarding contract would not strengthen the execution path.

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

The repository has three deliberately separate planes:

| Plane | Primary paths | Responsibility |
|---|---|---|
| Decision core | `src/core/` | Chain-independent policy, hybrid selection, adaptive sizing, and typed evidence. |
| Live product | `src/live/`, `web/live/` | Current RPC reads, integration validation, simple-batch construction, exact simulation, wallet authorization, and submission. |
| Evidence | `artifacts/`, `web/data/`, `web/components/` | Read-only presentation of accepted fork and deterministic test results. |

React does not implement portfolio math, evidence artifacts do not enter live analysis, and the live adapter does not claim adaptive execution without a truthful quote source.

For component ownership, diagrams, state transitions, error taxonomy, deployment details, and guidance for adding an integration, continue to the **[complete architecture guide](./docs/ARCHITECTURE.md)**.

## Local development

Prerequisites:

- Node.js 20 or newer;
- pnpm 10.17.1 via Corepack;
- Foundry tools for historical fork runners; and
- network access to the public Robinhood Chain testnet RPC for live checks.

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
pnpm live:smoke
```

`pnpm live:smoke` is read-only. It verifies the chain ID, latest block, deployed bytecode, state/oracle/guard reads, and exact `eth_call` capability. Live results depend on external RPC and contract state.

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
src/live/                       live RWA Index integration boundary and types
web/live/                       operator UI and EIP-1193 wallet workflow
web/data/                       artifact-to-view-model adapters
web/components/                 historical evidence presentation
web/Landing.tsx                 product landing page
web/Router.tsx                  /, /app, and /evidence routing
integrations/rwa-index/         accepted planner, ABI, fork harness, and probes
artifacts/                      versioned historical and security evidence
security/                       deterministic security scenarios
scripts/live-smoke.ts           non-mutating public-RPC validation
config/rwa-index.json           verified external deployment configuration
third_party/rwa-index/          pinned external source
docs/                           architecture, security model, and decisions
```

## Project status and limits

M1 established external-vault compatibility on a disposable fork. M2 froze the static control planner. M3 added deterministic simulation-gated planning. M4 and M4.1 introduced executable-liquidity sampling and adaptive multi-leg planning. M4.2 adopted simple-first hybrid orchestration. M5 turned accepted artifacts into an evidence console. M6 separated a real live operator product from historical evidence.

The current integration uses mock testnet assets and toy Synthra liquidity. It has no production funds, custody, token, governance, private RPC credential, cross-venue routing, or Setpoint smart-contract deployment. A random visitor does not inherit execution authority from the UI.

## Documentation

- [Architecture](./docs/ARCHITECTURE.md) — system structure, runtime flows, boundaries, and extension model
- [Security model](./docs/SECURITY.md) — assumptions, invariants, threat coverage, and reproduction
- [Decision 0001](./docs/decisions/0001-hybrid-rebalance-orchestration.md) — why Setpoint is simple-first and adaptive only when justified
- [Decision 0002](./docs/decisions/0002-live-product-boundary.md) — why live state and historical evidence remain isolated
- [Build log](./BUILD_LOG.md) — milestone-by-milestone implementation record
