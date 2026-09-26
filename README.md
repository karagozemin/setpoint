# Setpoint

Setpoint is a non-custodial safety and execution orchestration layer for onchain vault rebalances.

It reads a vault's current state, validates an operator's proposed allocation, constructs the simplest coherent rebalance, and simulates the exact vault call. A safe full batch returns `FAST_PATH`. Recoverable execution failures may enter `ADAPTIVE_FALLBACK` only when trustworthy executable-liquidity evidence exists. Invalid, stale, unsupported, or unprovable paths return `NO_TRADE`.

The governing product document is [Setpoint PRD v1.2](./Setpoint_PRD_v1_2.md). The hybrid policy is recorded in [Decision 0001](./docs/decisions/0001-hybrid-rebalance-orchestration.md), and the live product boundary in [Decision 0002](./docs/decisions/0002-live-product-boundary.md).

## Live app

The M6 product has three routes:

- `/` — focused product landing page;
- `/app` — live Robinhood Chain testnet vault analysis and wallet workflow; and
- `/evidence` — the historical fork-backed M4.2/M5 evidence console.

Run locally:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:5173`. Public vault reads do not require a wallet. MetaMask, Rabby, and other EIP-1193 wallets can connect for network/authorization detection and transaction submission when the account is actually authorized.

The reviewed M6 product is live at [setpoint-neon.vercel.app](https://setpoint-neon.vercel.app).

Reviewed M6 preview: `https://setpoint-fl1z2lkvh-karagozs-projects.vercel.app` (Vercel deployment protection may require team access).

## What it does

The live workflow is:

1. select or enter a supported vault;
2. read the current chain, block, contract links, balances, oracle timestamps, targets, and hard guards;
3. review or propose a bounded target allocation;
4. re-read confirmed state and validate policy;
5. build the frozen simple RWA Index-style batch;
6. simulate the exact `rebalance(Trade[])` calldata with `eth_call` from the configured manager identity;
7. return a typed Setpoint decision;
8. export calldata when the connected wallet is unauthorized; or
9. re-simulate, submit with the authorized wallet, wait for confirmation, and re-read state.

RPC, unsupported-integration, wallet-rejection, and transaction-revert errors are application states. They are not `NO_TRADE` decisions. A genuinely stale authoritative oracle is `NO_TRADE`.

## Live integration

The registered external integration is RWA Index on Robinhood Chain testnet (`chainId 46630`):

| Contract | Address |
|---|---|
| Vault | `0x357CD10343829DBd5889c7b0B2fBc4388fC4875B` |
| Oracle | `0x2F2316d6D4a8952730a71BfCD9fa0Af5A0138AB9` |
| Synthra swap adapter | `0x6E498DB59449aF170A9525a69456154F226a4E03` |
| Mock USDC base asset | `0xFF00eA84190AeD0B1AbEF4fbC45E51258f2799BA` |

RWA Index is an external technical integration target. It is not a customer, partner, production Setpoint deployment, or live funds under Setpoint management. The pinned source is included under `third_party/rwa-index` at upstream commit `b2456ca5400ba9ec36d81691554b889fb9250513`.

At the latest M6 verification, all five configured oracle observations were older than the vault's 24-hour freshness guard. The live UI therefore shows raw onchain balances and targets but deliberately leaves authoritative NAV, weights, and drift unavailable. `Analyze rebalance` returns real `NO_TRADE / STALE_PRICE`. It does not fall back to artifact data.

The public RPC serves `latest` but rejects explicit block-number `eth_call` at its reported head. Setpoint batches a latest-state read window and displays the observed block as provenance. It always performs a fresh exact simulation immediately before an authorized submission.

The deployed swap adapter has no verified public quote method suitable for executable depth. Fork-only allowance/inventory probes are not used in `/app`. If a full live batch fails, adaptive sizing remains fail-closed until a truthful live quote adapter exists.

## Wallet and execution

The app supports injected EIP-1193 wallets, account display, chain detection, and switch/add-network requests for Robinhood Chain testnet. It checks both the vault's `MANAGER_ROLE` and active agent-session authorization.

- Unauthorized wallet: analyze, copy calldata, or export an execution request.
- Authorized wallet: exact re-simulation, `rebalance(Trade[])` submission, receipt wait, explorer link, and confirmed-state re-read.
- Wallet cancellation: `WALLET_REJECTION`, never `NO_TRADE`.
- Transaction revert: `TRANSACTION_REVERT`, never a simulation result.

There is no Setpoint-owned smart-contract deployment. The repository had no funded deployment credential, and the external vault already enforces the useful policy and authorization controls. An unused registry or forwarding contract would be a vanity deployment, so M6 does not introduce one. No sandbox deployment is claimed.

## Architecture

```text
React product UI
      ↓
RWAIndexLiveAdapter        /app — live RPC only
      ↓
viem public/wallet clients
      ↓
external RWA Index vault

artifact view adapters     /evidence — checked-in JSON only
      ↓
historical M4.2/security evidence
```

`src/core/` remains the frozen chain-independent solver. The live adapter is under `src/live/`; it reuses the accepted static planner and exact ABI rather than implementing portfolio math in React. Historical artifact adapters remain under `web/data/` and are loaded only by `/evidence`.

## Security

The [security model](./docs/SECURITY.md) documents trust assumptions, the recoverable-failure allowlist, threats addressed, and threats out of scope. It is not an audit or formal-verification claim.

The deterministic security suite covers stale accounting, invalid target policy, unsupported routes, unsafe residual liquidity, and unknown simulation failure. Its 11 invariants require simulation gating, default-closed fallback, confirmed-state re-read, and external authorization enforcement.

```bash
pnpm security:demo
```

## Technical evidence

`/evidence` preserves the accepted historical flows:

- normal rebalance → `FAST_PATH`;
- large target → `INSUFFICIENT_OUTPUT` → `ADAPTIVE_FALLBACK` → safe three-leg subset;
- stale oracle → `NO_TRADE`; and
- policy, route, unsafe-liquidity, and unknown-revert security cases.

The large-target proof is historical fork evidence: 31.025554% initial drift, 10 attempted legs, 60.051107% NAV attempted turnover, a real-vault `INSUFFICIENT_OUTPUT`, three safe legs, 22.5% NAV executed turnover, 19.113279% confirmed drift, and a refused USDC→NFLX residual. Fork transaction hashes are never linked as public-chain transactions.

## Reproduce

Prerequisites are Node.js 20+, pnpm, Foundry tools for the historical fork runners, and network access to the public Robinhood Chain testnet RPC.

```bash
git submodule update --init --recursive
corepack enable
pnpm install --frozen-lockfile
pnpm security:demo
pnpm typecheck
pnpm test
pnpm build
pnpm demo:check
pnpm live:smoke
```

Historical milestones remain independently runnable:

```bash
pnpm m1:rwa-index
pnpm m2:baseline
pnpm m3:solver
pnpm m4:adaptive
pnpm m4:batch
pnpm m4:hybrid
```

`pnpm live:smoke` is read-only. It checks chain ID, current block, deployed bytecode, live state/oracle/guard reads, and exact `eth_call` capability. It reports the absence of a Setpoint deployment instead of inventing one.

## Repository layout

```text
src/core/                       frozen planning and hybrid semantics
src/live/                       live integration boundary and types
web/live/                       real operator UI and EIP-1193 wallet flow
web/data/ + web/components/     historical evidence presentation
web/Landing.tsx                 product landing
web/Router.tsx                  /, /app, /evidence routing
integrations/rwa-index/         fork harness and accepted planners/adapters
artifacts/                      versioned historical evidence
scripts/live-smoke.ts           non-mutating public-RPC validation
config/rwa-index.json           verified external deployment configuration
third_party/rwa-index/          pinned external source
```

## Historical milestones and limitations

M1 established real external-vault compatibility on a disposable fork. M2 created the frozen static control group. M3 added deterministic simulation-gated planning. M4/M4.1 added executable-liquidity sampling and multi-leg adaptive planning. M4.2 accepted the simple-first hybrid strategy. M5 exposed that evidence as a static console. M6 separates the real live product from historical evidence.

The deployment uses mock testnet assets and toy Synthra liquidity. The public oracle is currently stale. Random visitors do not hold the external manager role. Setpoint has no custody, token, governance, production funds, private RPC credential, or new onchain deployment. See [BUILD_LOG.md](./BUILD_LOG.md) for exact implementation results and blockers.
