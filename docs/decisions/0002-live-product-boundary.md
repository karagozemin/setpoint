# Decision 0002: Live product and evidence boundary

Status: accepted for M6  
Date: 2026-09-26

## Context

The M5 site presented accepted M4.2 artifacts as an operator console. That was useful engineering evidence but not a real operator workflow. M6 requires a live vault application without weakening the accepted hybrid semantics or misrepresenting fork-only liquidity probes as production quotes.

The configured external RWA Index deployment exposes public balances, targets, oracle observations, guards, roles, agent sessions, and `rebalance(Trade[])`. Its Synthra adapter does not expose a verified public quote method that proves executable depth. The public Robinhood Chain testnet RPC supports `latest` calls but rejects explicit block-number `eth_call` at its reported head. The external oracle is currently stale. Random connected wallets are not authorized vault managers.

## Decision

1. `/app` and `/evidence` have separate data boundaries. The live app cannot import scenario artifacts; evidence cannot submit transactions.
2. `RWAIndexLiveAdapter` owns live reads, policy validation, batch construction, exact simulation, authorization detection, execution-request construction, and authorized submission.
3. Live reads use batched `latest` windows and expose the observed block as provenance because the public provider rejects explicit block-number calls. Exact simulation is repeated immediately before submission.
4. The frozen static planner constructs the simple batch. The React layer edits allocations and presents results; it does not implement another solver.
5. Stale authoritative prices return `NO_TRADE / STALE_PRICE`. NAV, weights, and drift remain unavailable rather than being reconstructed from stale prices.
6. A passing exact simulation returns `FAST_PATH`. When the full batch fails and no truthful live executable-depth adapter exists, Setpoint fails closed. It does not feed historical fork curves into adaptive planning.
7. An unauthorized wallet receives calldata/export actions, not an active execution affordance. An authorized wallet is rechecked and re-simulated before submission, then confirmed state is read again.
8. No Setpoint contract is added or deployed in M6. The external vault already enforces execution authorization and hard guards; a registry or forwarding contract unused by the execution path would be a vanity deployment.

## Consequences

The current live RWA Index path truthfully returns `NO_TRADE` while its oracle is stale, but remains capable of `FAST_PATH` exact simulation and authorized submission when live state permits. Live `ADAPTIVE_FALLBACK` remains unavailable until executable quote evidence can be obtained without fork-only mutation. Historical adaptive proof remains available under `/evidence`, clearly labeled as fork-backed evidence.

This decision does not change `src/core/`, the recoverable-failure allowlist, the M2 planner hash, accepted artifacts, or the 11 security invariants.
