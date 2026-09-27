# Security model and failure evidence

This document describes the safety boundary demonstrated by the current Setpoint prototype. It is not an audit, a formal-verification report, or a claim about production readiness.

Setpoint is a non-custodial rebalance orchestration layer. It reads authoritative vault state, validates a constrained target policy, preflights a candidate, requires exact-vault simulation, and returns either a simulation-approved plan or a typed no-trade result. Sandbox custody belongs to each wallet-owned vault; external integrations retain their native authority.

## Trust assumptions

- The integrated vault's accounting, NAV, balances, target storage, and hard guards are authoritative.
- Setpoint receives a supported, constrained target policy. Invalid ranges, unsupported assets, and unsupported routes are rejected before execution.
- Accounting prices must satisfy the configured freshness limit.
- The sandbox vault enforces its immutable owner; external vaults enforce their native authorization. The browser neither grants roles nor bypasses access control.
- Liquidity quotes are bound to the confirmed state identifier and expire; a plan is not reused after state changes.
- The exact `rebalance(Trade[])` call must pass vault simulation before the corresponding plan can be returned for execution.
- A successful execution is followed by a confirmed-state re-read and a new solve. Expected state is not treated as confirmed state.

## Decision boundary

The default path is a coherent simple batch. Adaptive fallback is available only for the explicit recoverable failure allowlist:

- `INSUFFICIENT_OUTPUT`
- `TRADE_TOO_LARGE`
- `INSUFFICIENT_BALANCE`
- `DRIFT_NOT_IMPROVED`
- `EXCESSIVE_VALUE_LOSS`

Stale or invalid inputs, unsupported assets or routes, authorization failures, loose slippage construction, and unknown reverts are non-recoverable. They fail closed and cannot activate adaptive execution. An adaptive candidate must independently pass the same exact-vault simulation gate.

The `/evidence` console is a read-only presentation of checked-in evidence. The `/app` surface can invoke the solver only through live adapters and cannot change the failure allowlist.

## Sandbox-specific controls

- One factory entry exists per wallet; duplicate vault creation reverts.
- Only the vault's immutable owner may update targets or rebalance.
- Targets must sum to exactly 100%; each risk asset is capped at 70%.
- Trades are limited to registered sUSDG/risk pairs, capped at 30% of NAV per leg, and must satisfy the 3% oracle minimum-output floor.
- Oracle observations older than 24 hours fail closed.
- A batch must strictly improve drift and retain at least 98% of pre-batch NAV.
- The route adapter has no arbitrary-call surface and each pool accepts execution only from that adapter.
- Deployment and oracle writes require an explicit local environment key; no key is bundled, logged, committed, or accepted by the browser.
- Analysis is tied to a digest-like ID over execution-relevant vault, target, oracle, and reserve state observed at a recorded block. Execution re-reads that state ID, exact-simulates again as the owner, waits for confirmation, and re-reads post-state.

## Reproducible demonstrations

| Scenario | Evidence level | Demonstrated result |
|---|---|---|
| Stale authoritative oracle | Fork evidence | `STALE_PRICE` → `NO_TRADE`; no fallback, simulation-approved execution, legs, or turnover |
| Policy-breaking target | Integration test evidence | A 95% target above the asset's 80% cap → `INVALID_POLICY`; no simulation, fallback, or execution |
| Unsupported direct route | Integration test evidence | A non-hub asset-to-asset leg remains visible and is rejected before simulation; no fallback or execution |
| Unsafe residual liquidity | Fork evidence | Ten-leg fast path fails `INSUFFICIENT_OUTPUT`; a simulated three-leg safe subset executes; the remaining USDC→NFLX route ends `NO_SAFE_LIQUIDITY` |
| Unknown simulation failure | Integration test evidence | `UNKNOWN_REVERT` → `SIMULATION_REJECTED`; no fallback or execution |

The policy-breaking target fixture proves Setpoint's policy-validation boundary. It does not claim actor-level target authorization that the present external integration does not expose. The result is explicitly a Setpoint policy rejection, not a vault transaction revert.

The fork-evidence scenarios reuse the accepted M4.2 artifacts rather than manufacturing new onchain observations. The integration-test scenarios run the frozen hybrid solver against deterministic fixtures. Precise stale-oracle age is not claimed because the source artifact does not record it.

Generated evidence lives in `artifacts/security/`. `security-summary.json` records the invariant matrix, evidence levels, source hashes, and the frozen M2 planner hash.

## Invariants demonstrated

- Stale price, invalid policy, unsupported route, and unknown failure cannot produce execution.
- Unsupported legs remain visible in evidence; they are not silently omitted while reporting completion.
- Adaptive fallback is default-closed and activated only by the named recoverable failure allowlist.
- A failed fast-path transaction is never executed.
- Every observed adaptive execution passed exact-vault simulation.
- The unsafe residual USDC→NFLX trade was not submitted.
- Confirmed state was re-read after the successful adaptive fork execution.
- Integration fixtures do not execute, and the fork execution uses the configured RWA Index manager identity.
- UI/demo code does not import or invoke execution-core solvers and cannot change execution policy.

## Threats addressed by the demonstrated controls

- stale accounting prices;
- invalid or policy-breaking target configuration;
- unsupported assets and execution routes;
- excessive output loss or price impact relative to the oracle floor;
- unknown or unclassified simulation failures;
- execution of a simulation-rejected plan; and
- stale plan reuse after a successful state transition.

## Threats not solved

- a compromised vault owner, manager, or administrator;
- a malicious oracle that supplies fresh but false prices;
- a compromised or equivocating RPC endpoint;
- production venue manipulation outside the configured constraints;
- smart-contract bugs in the vault, oracle, adapter, pool, or other external integrations;
- signing-key or host compromise;
- MEV protection or execution-ordering guarantees; and
- cross-venue routing risk, because cross-venue routing is not implemented.

## Reproduce

From a dependency-complete checkout:

```bash
pnpm security:demo
pnpm typecheck
pnpm test
pnpm build
pnpm sandbox:contracts
```

`pnpm security:demo` deterministically regenerates and validates the five scenario artifacts plus the summary. It exits nonzero if a scenario invariant fails or if the M2 planner SHA-256 differs from `dcd079ed25ff6fd7683c947fbf46748abd70862fe2a85a368c919b26fe7cee92`.
