# Setpoint Product Requirements Document

**Version:** 1.2  
**Status:** Historical M0–M4.2 product baseline; not the current release source of truth  
**Date:** 2026-09-26  
**Supersedes:** Setpoint PRD v1.1  
**Current program state described by this document:** M0–M4.2 accepted; M5 was next at the time

> **Current release note (2026-09-29):** This PRD preserves the requirements that led to the frozen M4.2 core. It predates the M5 evidence console, M6 live integration product, and the wallet-owned Robinhood Chain Testnet sandbox. For current product behavior, deployment state, routes, operations, and limitations, use [`README.md`](./README.md), [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md), [`docs/SECURITY.md`](./docs/SECURITY.md), and Decisions 0001–0003. Historical “next milestone” language below is intentionally retained as chronology.

---

## 1. Executive summary

Setpoint is a non-custodial safety and execution orchestration layer for multi-asset onchain vault rebalancing.

**Positioning:** Setpoint — safety and execution orchestration for onchain vault rebalances.  
**Supporting line:** Preflight simple rebalances. Adapt only when liquidity or vault constraints make them unsafe.

It reads authoritative accounting and policy from an existing vault, constructs a coherent rebalance, validates executable liquidity, simulates the exact transaction against the target vault, and returns either an approved plan or a typed refusal. It does not own accounting, custody assets, invent investment strategy, or replace the vault.

The first implementation against the external RWA Index deployment established a hybrid execution strategy:

1. Build the simple full rebalance implied by the confirmed vault state and target policy.
2. Validate exact-size executable quotes, conservative intermediate balances, configured limits, and the real vault simulation.
3. If the batch is safe and simulation passes, execute it unchanged as `FAST_PATH`.
4. If it fails for an explicitly recoverable execution reason, invoke bounded adaptive planning as `ADAPTIVE_FALLBACK`.
5. If state, policy, authorization, oracle, or safety is invalid—or no safe executable subset exists—return `NO_TRADE` with evidence.

This is the product thesis supported by current evidence: **simple coherent execution is preferable when it is already safe; adaptive planning creates value when the simple rebalance is unsafe or infeasible.** Setpoint does not claim that adaptive planning always outperforms a static baseline.

The current codebase proves the core execution loop on a disposable Robinhood Chain testnet fork. The next milestone is an operator console over the existing artifacts and orchestration state. It is not a retail trading UI.

## 2. Product thesis and decision freeze

### 2.1 Product definition

Setpoint is the policy-aware layer between vault intent and transaction submission:

**Core product principle: Do not optimize what is not broken.**

```text
authoritative vault state + target policy + venue liquidity
                         |
                         v
              Setpoint orchestration
        validate -> plan -> simulate -> explain
                         |
                         v
             approved transaction or no-trade
```

Setpoint's core product is the decision record around a rebalance: what state was read, what policy applied, which execution mode was selected, what exact transaction was simulated, why it was accepted or rejected, and what confirmed state followed execution.

### 2.2 Frozen product decisions

The following decisions are frozen for the current product phase:

- Setpoint is a rebalance solver and execution-orchestration layer, not a vault accounting system.
- Vault accounting is authoritative and assumed to be solved upstream.
- The first integration uses one accounting numeraire.
- Setpoint is non-custodial and never requires possession of vault funds.
- The default execution path is a simple coherent full batch when that batch is safe and simulation-approved.
- Adaptive planning is a bounded fallback for explicitly recoverable execution failures.
- Every state-changing plan must be simulation-gated against the real target-vault interface.
- Confirmed state must be re-read after execution; old plans are not reused.
- Safety and invalid-state failures fail closed.
- RWA Index is an external technical integration and benchmark target, not a claimed customer or partner.
- Benchmark evidence must remain reproducible and must not weaken the baseline.
- Existing DEX or aggregator infrastructure remains underneath Setpoint; Setpoint does not need to replace it.

### 2.3 Out of scope

Setpoint will not, in this phase:

- build a new vault or vault accounting engine;
- custody user or vault funds;
- build a DEX or manufacture liquidity;
- define asset-selection or investment strategy;
- become a generic retail trading terminal;
- perform cross-vault netting;
- use an LLM or AI model to authorize or execute trades;
- add CoW Protocol or 0x adapters before the adapter milestone is explicitly opened;
- claim production readiness from toy testnet liquidity; or
- claim universal outperformance over simple rebalancing.

### 2.4 Decisions intentionally still open

Only the following product variables remain open:

- the first production ICP subtype;
- the first production execution adapter;
- the production multi-venue quote abstraction;
- gas-aware optimization and its objective weighting; and
- the production model for policy creation, approval, and administration.

These decisions must be resolved with production-oriented evidence. They do not reopen the hybrid execution decision.

## 3. Product evolution and rationale

### 3.1 Initial framing

The project began as an adaptive rebalance solver. The intuition was that smaller, liquidity-aware steps would be safer than a large static transaction under hard vault constraints.

### 3.2 Scope corrections

Research and implementation narrowed the product:

- Accounting was removed from Setpoint's scope because the vault must remain authoritative.
- Custody and capital movement were removed because the orchestration layer can operate through proposals, simulation, and authorized execution.
- A single accounting numeraire was selected for the first integration.
- Generic routing, cross-vault netting, and AI execution were removed as speculative or premature.
- RWA Index was selected as a real external target because it exposes meaningful vault constraints and a deployed `rebalance(Trade[])` interface.

### 3.3 Evidence-driven correction to the solver thesis

M2 established a truthful static control group. M3 and M4 introduced deterministic and liquidity-aware planning. M4.1 improved adaptive planning to multi-leg batches. Those results showed that adaptive planning was not the best default in normal scenarios: the coherent static batch was faster and often ended with equal or lower drift when it could execute safely.

M4.2 therefore changed orchestration, not the vault or baseline. The simple batch became the fast path. Adaptive planning became a recoverability mechanism activated only after an eligible failure.

This correction is now part of the product definition. It is not a temporary benchmark optimization.

## 4. Problem statement

Multi-asset vaults can know their balances, net asset value, target weights, and guardrails yet still lack a reliable way to turn that intent into an executable rebalance.

The gap appears when:

- a desired batch exceeds available venue depth;
- quote output is incompatible with an oracle-derived minimum;
- leg size or turnover exceeds policy;
- intermediate balances make an otherwise valid batch impossible;
- the transaction would fail a vault-specific drift or NAV invariant;
- market or oracle state is stale; or
- operators cannot explain why a rebalance did or did not run.

A naive system sends the target delta directly and reverts. A permanently conservative system fragments every rebalance, adding latency and operational complexity even when the full batch is safe. Setpoint must distinguish these cases before execution.

## 5. Users, ICP, and jobs to be done

### 5.1 Initial user

The initial user is a vault curator, portfolio manager, protocol strategist, technical vault or risk operator, or automated execution system responsible for carrying out a predefined portfolio policy. Human operators must be able to interpret policy, simulations, and transaction evidence. Setpoint is not initially designed for a retail depositor.

### 5.2 Initial ICP envelope

The initial ICP has:

- an existing vault with authoritative balances, NAV, and targets;
- a single accounting numeraire;
- explicit onchain or machine-readable rebalance guards;
- permissioned or otherwise controlled rebalance submission;
- several assets whose executable liquidity may differ materially; and
- a need for deterministic, auditable pre-trade decisions.

The initial vertical is RWA, tokenized-stock, and other multi-asset onchain vaults. The exact first production subtype remains open. The RWA Index deployment proves technical compatibility but is not evidence of a commercial relationship.

### 5.3 Jobs to be done

An operator needs to:

- see whether a vault is eligible to rebalance;
- know whether the complete intended rebalance is executable now;
- obtain the safest useful alternative when the complete rebalance is not executable;
- understand every refusal and fallback decision;
- simulate the exact transaction against real vault constraints;
- execute only through existing authorization; and
- verify the resulting confirmed state before making another decision.

## 6. Validation and current evidence

### 6.1 Evidence standard

Setpoint distinguishes among:

- **contract evidence:** behavior verified against deployed interfaces or source;
- **fork evidence:** deterministic behavior observed on a pinned disposable fork;
- **test evidence:** behavior verified with unit or integration tests;
- **product hypothesis:** a claim not yet validated in production; and
- **commercial evidence:** a user, customer, or partner commitment.

Fork evidence must not be presented as production performance or commercial adoption.

### 6.2 Completed technical milestones

- **M0:** repository and architecture foundation.
- **M1:** reproducible external-vault harness against the real RWA Index deployment.
- **M2:** truthful static full-rebalance baseline.
- **M3:** deterministic chain-independent Solver v1 and typed no-trade outcomes.
- **M4:** executable-liquidity sampling and adaptive Solver v2.
- **M4.1:** bounded multi-leg batch planning and selective backoff.
- **M4.2:** hybrid fast path with adaptive fallback.

### 6.3 M4.2 fork evidence

The accepted M4.2 evidence produced the following behavior on the pinned fork:

| Scenario | Mode | Executed result |
|---|---|---|
| Deep liquidity | `FAST_PATH` | 1 batch, 6 legs, final drift 0.075394%, target bands reached |
| Thin liquidity | `FAST_PATH` | 1 batch, 6 legs, final drift 0.143624%, target bands reached |
| Asymmetric liquidity | `FAST_PATH` | 1 batch, 6 legs, final drift 0.072184%, target bands reached |
| Defensive cash | `FAST_PATH` | 1 batch, 5 legs, final drift 0.063295%, target bands reached |
| Stale oracle | `NO_TRADE` | `STALE_PRICE`; fallback not invoked |
| Large target change | `ADAPTIVE_FALLBACK` | fast path rejected; 3 safe legs executed; drift improved from 31.025554% to 19.113279% |

In the large-target scenario, the simple plan attempted 10 legs and 60.051107% turnover and failed the real simulation with `INSUFFICIENT_OUTPUT`. Adaptive fallback executed 22.5% turnover, then stopped. No sampled USDC-to-NFLX size satisfied the vault's 98%-of-oracle minimum-output floor, so the remaining route produced `NO_SAFE_LIQUIDITY` rather than an unsafe trade.

Across this accepted scenario set, fallback was invoked in one of five non-stale scenarios and in two of six eligible planning cycles. These are scenario-specific diagnostic rates, not expected production rates.

### 6.4 Supported conclusion

The current evidence supports these claims:

- the full batch should execute directly when exact-size validation and vault simulation pass;
- adaptive planning can rescue a safe subset when the full batch fails for a recoverable liquidity or sizing reason;
- stale or invalid state must not activate fallback; and
- an unsafe residual should be refused even after a successful partial rebalance.

It does not support claims that Setpoint always lowers drift faster, always saves cost, or always outperforms static execution.

## 7. Product principles

### 7.1 Authoritative state over local assumptions

Balances, NAV, targets, roles, and vault guards come from the integrated system. Local caches and prior plans are non-authoritative.

### 7.2 Simple when safe

Do not fragment or optimize a coherent rebalance merely because a more complex planner exists. If the full batch is safe, executable, and simulation-approved, use it unchanged.

### 7.3 Adaptive only with a reason

Fallback must be tied to a typed recoverable failure. The system must preserve the original failure and explain how the fallback responds to it.

### 7.4 Fail closed

Unknown, stale, malformed, unsupported, paused, or unauthorized states produce no transaction.

### 7.5 Simulation is a release gate

Passing local arithmetic is insufficient. The exact proposed call must pass target-vault simulation from the intended caller before it can be approved.

### 7.6 Re-plan from confirmation

After any transaction, discard the old plan, read confirmed state, and start a new decision cycle.

### 7.7 Evidence before claims

Benchmarks preserve control-group behavior, record failures, and expose limitations. Product language must not outrun the evidence.

### 7.8 Determinism and auditability

The same normalized inputs must produce the same plan, refusal, stable ordering, and decision evidence.

## 8. Scope

### 8.1 Implemented core scope

The current implementation includes:

- a chain-independent policy and planning core;
- an external-vault adapter for RWA Index;
- authoritative state reads from a real deployment;
- stale-oracle detection and fork-only timestamp recovery;
- executable-liquidity curve sampling;
- a truthful simple full-batch baseline;
- deterministic adaptive single-step and multi-leg planners;
- hybrid mode selection;
- real `rebalance(Trade[])` simulation;
- fork-only execution and post-transaction verification;
- typed no-trade and failure outcomes; and
- versioned benchmark artifacts.

### 8.2 Next scope: M5

M5 adds a thin operator console over existing core outputs. It visualizes state, plan, mode, simulation, execution eligibility, and resulting evidence. It must not duplicate solver logic in the UI.

### 8.3 Later scope

Later milestones may add a production execution adapter, quote-source abstraction, production policy administration, authentication, persistence, and operating controls. Those items require separate acceptance criteria.

## 9. Product experience and control flow

### 9.1 Decision cycle

```text
read confirmed state
        |
validate accounting, policy, oracle, roles, and support
        |
        +-- invalid/unsafe --------------------------> NO_TRADE
        |
build complete simple rebalance
        |
validate exact-size quotes, balances, and limits
        |
simulate exact rebalance(Trade[])
        |
        +-- passes ---------------------------------> FAST_PATH
        |
        +-- recoverable failure -> adaptive planner -> simulate
        |                                      |          |
        |                                      |          +-- approved -> ADAPTIVE_FALLBACK
        |                                      +------------- unsafe -> NO_TRADE
        |
        +-- non-recoverable/unknown ----------------> NO_TRADE

approved transaction -> authorized submission -> confirmation
                                             |
                                             v
                              discard plan and re-read state
```

### 9.2 Operator-visible outcome

Every cycle returns one of:

- `FAST_PATH`: the complete simple batch passed all gates;
- `ADAPTIVE_FALLBACK`: the simple batch failed recoverably and a bounded alternative passed;
- `NO_TRADE`: no transaction is approved, with a typed reason; or
- `ERROR`: infrastructure failed before a trustworthy decision could be produced.

An error is not a no-trade policy decision and must be displayed separately.

### 9.3 Execution authority

Setpoint may prepare or submit a transaction only through the vault's existing authorization model. A proposal may be export-only, multisig-bound, or sent by an authorized automation account. Setpoint does not acquire broader rights.

## 10. Functional requirements

### 10.1 State and policy

- **FR-001:** Read authoritative vault balances, NAV, target weights or ranges, supported assets, and relevant guard parameters.
- **FR-002:** Normalize all values to the configured accounting numeraire without replacing upstream accounting.
- **FR-003:** Validate that targets, ranges, balances, prices, decimals, NAV, and policy limits are internally consistent.
- **FR-004:** Detect stale or missing prices before candidate construction.
- **FR-005:** Record chain ID, block number, block hash, contract addresses, and configuration identity for reproducibility.

### 10.2 Simple fast path

- **FR-006:** Construct the complete coherent rebalance implied by confirmed state and target policy.
- **FR-007:** Preserve deterministic sell-before-buy ordering where the base asset is the hub.
- **FR-008:** Split legs only when required by an explicit vault or policy maximum.
- **FR-009:** Obtain exact-size executable evidence for every material leg.
- **FR-010:** Validate conservative intermediate balances, turnover, leg-size, cash-buffer, route, and quote validity constraints.
- **FR-011:** Simulate the exact encoded target-vault call from the intended caller.
- **FR-012:** Select `FAST_PATH` only if every required check passes.

### 10.3 Adaptive fallback

- **FR-013:** Map simulation and preflight failures to typed recoverable, non-recoverable, or unknown classes.
- **FR-014:** Invoke adaptive planning only for an allowlisted recoverable class.
- **FR-015:** Bound fallback by confirmed balances, target distance, venue depth, oracle floor, vault caps, turnover, cash policy, and configured search limits.
- **FR-016:** Rank candidate batches deterministically using the documented objective.
- **FR-017:** Simulate every selected fallback batch through the same target-vault gate.
- **FR-018:** Stop with `NO_TRADE` when no safe candidate exists; never relax a vault guard to force progress.

### 10.4 Execution and lifecycle

- **FR-019:** Execute only the exact approved calldata and only through an authorized caller.
- **FR-020:** Bind approval to the state and quote validity window used for simulation.
- **FR-021:** After confirmation, discard the prior plan and re-read authoritative state.
- **FR-022:** Record pre-state, candidates, selected mode, simulations, transaction result, and post-state in a machine-readable artifact.

### 10.5 Explainability

- **FR-023:** Provide a human-readable explanation for mode selection and refusal.
- **FR-024:** Preserve the original fast-path failure when fallback is selected.
- **FR-025:** Distinguish observed values, configured limits, derived metrics, and assumptions.

## 11. Hybrid solver and orchestration specification

### 11.1 Required inputs

The orchestrator consumes:

- confirmed portfolio balances;
- authoritative NAV and accounting prices;
- target weights or target ranges;
- vault guards and policy limits;
- supported routes and asset metadata;
- executable quote samples or exact-size quotes;
- intended caller and target-vault interface;
- chain and block identity; and
- deterministic planner configuration.

### 11.2 Fast-path construction

The fast path computes the delta between current value and target value in the single numeraire. Overweight positions sell into the base asset before underweight positions buy from it. The planner uses conservative expected proceeds when checking later buys and applies all hard per-leg and batch limits.

The fast path is not a deliberately weak baseline. It must represent the strongest honest simple implementation supported by the integration.

### 11.3 Fast-path preflight

Before simulation, the orchestrator must reject a fast path that has:

- unsupported assets or routes;
- absent, stale, malformed, or inconsistent accounting data;
- insufficient token or base-asset balance under conservative settlement;
- expired or absent executable quote evidence;
- a leg or total turnover above configured limits;
- a cash result below the policy buffer; or
- an output below the applicable oracle-derived or policy minimum.

The exact batch must then pass `eth_call` or an equivalent target-vault simulation from the intended execution identity.

### 11.4 Failure taxonomy

Recoverable failure classes include:

- `INSUFFICIENT_OUTPUT` when a smaller or different safe subset may satisfy output constraints;
- `TRADE_TOO_LARGE` when resizing can comply with a leg cap;
- `INSUFFICIENT_BALANCE` only when ordering or resizing can address the deficit;
- `DRIFT_NOT_IMPROVED` when a different subset may strictly reduce drift;
- `EXCESSIVE_VALUE_LOSS` when smaller execution may preserve the NAV floor;
- insufficient executable depth;
- quote-impact incompatibility with minimum output;
- configured turnover or leg-size limits; and
- a minimum cash-buffer conflict that can be respected by a partial plan.

Non-recoverable or fail-closed classes include:

- stale or missing accounting price;
- invalid targets, ranges, NAV, decimals, or policy;
- paused vault or execution path;
- unauthorized caller;
- unsupported asset or route;
- stale liquidity evidence;
- inconsistent chain or contract identity; and
- unknown or unclassified failure.

Recoverability is an explicit mapping. String matching an unfamiliar revert is insufficient.

### 11.5 Adaptive candidate generation

For a recoverable failure, the fallback planner:

1. classifies overweight and underweight assets relative to target ranges;
2. samples or consumes executable depth along supported routes;
3. bounds each candidate by target distance, confirmed balance, per-leg caps, turnover, cash requirements, quote validity, and minimum output;
4. assembles bounded multi-leg sell/buy batches;
5. uses conservative sell proceeds to fund later buys;
6. simulates the highest-ranked safe candidate; and
7. backs off only the binding recoverable leg when the failure is attributable and a smaller sampled size exists.

The planner must not assume optimistic quote output is available as spendable balance.

After every confirmed fallback execution, Setpoint must re-read authoritative vault state and re-sample executable liquidity before planning again. It must not carry forward a quote curve or local portfolio projection as if it were confirmed.

### 11.6 Candidate objective

Within the current single-venue, single-numeraire implementation, candidates are ranked lexicographically by:

1. lowest projected target-band drift;
2. lowest quote loss;
3. lowest turnover;
4. greatest safety margin;
5. lowest leg count; and
6. stable deterministic candidate ID.

This is a planner ordering, not an investment objective. Gas-aware and multi-venue objectives remain open.

### 11.7 Required outputs

An approved plan includes:

- mode: `FAST_PATH` or `ADAPTIVE_FALLBACK`;
- state and configuration identity;
- exact ordered `Trade[]`;
- calldata and intended caller;
- expected and minimum outputs;
- projected drift, turnover, NAV, and cash;
- quote and simulation evidence;
- fallback trigger, when applicable;
- expiry or invalidation conditions; and
- a deterministic plan ID.

A no-trade result includes a typed code, stage, evidence, human-readable explanation, and whether retrying with fresh state may be meaningful.

## 12. Vault and accounting boundary

### 12.1 Upstream responsibilities

The vault or its accounting system owns:

- asset balances and share accounting;
- NAV calculation;
- asset pricing authority;
- deposits, withdrawals, fees, and liabilities;
- target-policy storage or authoritative policy reference; and
- enforcement of vault-specific invariants.

### 12.2 Setpoint responsibilities

Setpoint reads and validates those inputs, maps them into normalized planning types, constructs proposed trades, and tests them against the vault. It does not silently recompute a conflicting NAV or substitute its own price authority.

### 12.3 Initial numeraire constraint

The first integration uses one base asset as the accounting and routing hub. Supporting multiple numeraires, liabilities, derivatives, or nested-vault accounting requires a future explicit scope decision.

## 13. Execution and adapter boundary

### 13.1 Vault adapter

A vault adapter is responsible for:

- reading authoritative state;
- translating vault policy and guards into core types;
- encoding the vault's rebalance call;
- simulating from the correct caller; and
- decoding typed failures without changing their meaning.

### 13.2 Venue adapter

A venue adapter is responsible for executable quote evidence and transaction route encoding. The current RWA integration uses its deployed Synthra path. A generic multi-venue abstraction is not yet frozen.

### 13.3 Transaction lifecycle

The production lifecycle must distinguish proposal, approval, submission, inclusion, confirmation, replacement, failure, and invalidation. M0–M4.2 exercise this lifecycle on a disposable local fork only.

## 14. Security and safety requirements

### 14.1 Trust boundaries

Setpoint must treat vault state, oracle data, policy configuration, venue quotes, RPC responses, and operator inputs as separate trust domains. A successful read is not automatically a trustworthy value.

### 14.2 Required controls

- allowlist supported chains, vaults, assets, routes, and function selectors;
- require authorization and versioning for target changes;
- enforce maximum weights or target ranges independently of a submitted target;
- expose and honor a pause control before planning and submission;
- bind a plan to chain, vault, state block, caller, policy version, and quote window;
- reject stale or missing oracle and liquidity evidence;
- enforce balances, per-leg caps, turnover, cash buffer, minimum output, NAV floor, and drift requirements before submission;
- simulate the exact calldata, not a simplified proxy call;
- prevent execution of mutated or expired plans;
- use least-privilege execution identities;
- keep private keys and signing outside solver logic;
- preserve an append-only decision and execution record; and
- stop on unknown failures.

### 14.3 Malicious or compromised targets

A malicious target policy can direct value into an attacker-chosen asset while remaining arithmetically coherent. Setpoint does not determine whether an investment target is economically legitimate. Production policy administration must therefore require authenticated provenance, supported-asset controls, bounded policy changes, and an approval process appropriate to the vault.

This threat includes the class of target-manipulation attacks highlighted by the Kelthar/CoW feedback: execution correctness cannot compensate for a malicious objective. Policy provenance remains a production requirement.

### 14.4 MEV and quote validity

Simulation is necessary but not sufficient for public-chain execution. A production adapter must define deadlines, slippage binding, private or protected submission where appropriate, replay protection, replacement behavior, and re-simulation rules.

## 15. Architecture

```text
                           +----------------------+
                           | Policy authority     |
                           +----------+-----------+
                                      |
+------------------+       +----------v-----------+       +------------------+
| Vault/accounting |------>| Integration adapter |<------| Venue liquidity  |
| authoritative    |       | normalize + encode  |       | executable data  |
+------------------+       +----------+-----------+       +------------------+
                                      |
                           +----------v-----------+
                           | Hybrid orchestrator  |
                           | validate fast path   |
                           | classify failures    |
                           | adaptive fallback    |
                           +----------+-----------+
                                      |
                           +----------v-----------+
                           | Vault simulation     |
                           +----+------------+----+
                                |            |
                         approved|            |refused
                                v            v
                       +--------+---+   +----+---------+
                       | Authorized |   | Typed no-    |
                       | submission |   | trade record |
                       +------+-----+   +--------------+
                              |
                       +------v-------+
                       | Confirmation |
                       | + state read |
                       +--------------+
```

The chain-independent core owns validation, classification, deterministic planning, and plan/result types. Integrations own contract-specific reads, encoding, quote acquisition, and failure decoding. Runners and future services own orchestration lifecycle and artifact persistence. The UI consumes outputs; it does not become a second solver.

## 16. Data model and interfaces

### 16.1 Core input types

`PortfolioState` contains chain and block identity, numeraire, NAV, balances, prices, current weights, and target status.

`RebalancePolicy` contains target ranges, supported assets and routes, per-leg and turnover limits, minimum cash, quote validity, and vault safety thresholds.

`LiquidityEvidence` contains venue, route, sampled input, executable output, timestamp or block, and validity metadata.

### 16.2 Core result types

`RebalancePlan` contains mode, ordered trades, projected metrics, exact simulation request and result, evidence references, and invalidation rules.

`NoTradeResult` contains a stable code, stage, severity, recoverability, evidence, and explanation.

`ExecutionRecord` contains approved plan identity, submission identity, transaction receipt, post-state, realized metrics, and any divergence from projection.

### 16.3 Interface properties

All interfaces must be:

- deterministic after external evidence has been fixed;
- explicit about units and token decimals;
- serializable for audit artifacts;
- versioned when compatibility changes; and
- able to represent refusal without throwing away evidence.

## 17. RWA Index reference integration

### 17.1 Role in the product

RWA Index is the first real external-vault test target. It validates integration mechanics and hard-guard compatibility. It is not presented as a Setpoint customer, partner, or production deployment.

### 17.2 Deployment facts

- Robinhood Chain testnet chain ID: `46630`
- vault: `0x357CD10343829DBd5889c7b0B2fBc4388fC4875B`
- oracle: `0x2F2316d6D4a8952730a71BfCD9fa0Af5A0138AB9`
- manager/admin used for fork simulation: `0xbB91Fe38652991f0E9735dc139601bD637ae4d66`
- testnet pool syncer: `0x1f954000e202EBbB82Da88D53000b3eF0Cd34aeA`
- syncer owner: `0x156aB5483E47eCd1aFb1260d1093c96F1b9596b7`
- vault entry point: `rebalance(Trade[])`
- trade fields: `tokenIn`, `tokenOut`, `amountIn`, `minAmountOut`

### 17.3 Relevant hard guards

- each leg is at most 10% of NAV by oracle value;
- `minAmountOut` is at least 98% of oracle-implied output;
- `totalDrift()` must strictly decrease;
- NAV after execution must be at least 98% of NAV before execution; and
- oracle prices must not be stale.

The deployed contract remains the final authority where source descriptions and live behavior differ.

### 17.4 Reproducible fork behavior

The harness starts an Anvil fork, verifies deployed code and roles, observes the stale-oracle failure, impersonates the existing authorized feeder to preserve prices while refreshing timestamps, calls the deployed testnet-only pool syncer through its real owner, reads vault state, and simulates the exact vault call from the real manager.

All mutations are local to the disposable fork. No live funds move and no private key is required.

### 17.5 Integration-specific limitations

- The base asset is an 18-decimal mintable mock USDC, not production USDC.
- Stock tokens and Synthra pools are testnet deployments with toy-sized liquidity.
- Oracle refresh changes timestamps, not economic price values.
- Pool synchronization is a testnet helper, not a production liquidity mechanism.
- Historical forks depend on the source RPC's archive availability.

## 18. Benchmark and evaluation design

### 18.1 Benchmark question

The primary benchmark question is:

> Does Setpoint preserve the simple rebalance when it is safe and produce a safer useful outcome when that rebalance is not executable?

The benchmark is not designed to prove that a complex solver always beats a static planner.

### 18.2 Control group

M2 is the control group. It values target deltas with the vault oracle, splits only for the deployed leg cap, sells overweight assets into the base asset, buys underweights, uses the real 98% oracle floor, and simulates the complete batch. Its behavior must not be degraded to improve Setpoint's relative result.

### 18.3 Equivalent-state requirement

Every compared path must begin from the same chain, block, post-setup snapshot, policy, targets, balances, price state, and pool state. Snapshot restoration must isolate execution paths.

### 18.4 Scenario set

The maintained scenario matrix includes:

- relatively deep liquidity;
- thin liquidity;
- asymmetric liquidity;
- a large target change;
- a defensive cash target; and
- stale-oracle no-trade.

Future scenarios may be added, but accepted scenarios may not be silently removed from aggregate reporting.

### 18.5 Metrics

Required metrics include:

- selected mode and fallback trigger;
- fast-path pass and rejection rates;
- eligible fallback invocation and rescue rates;
- target-band completion;
- initial, projected, and final drift;
- attempted and executed turnover;
- number of batches and legs;
- quote loss and oracle-floor margin;
- simulation success and typed failure;
- NAV before and after;
- residual unsafe or unsupported routes; and
- wall-clock and RPC-call counts as diagnostic data.

Gas cost is not yet an optimization objective and must not be implied by current results.

### 18.6 Reporting rules

- Report every scenario, including no-trade and zero-execution outcomes.
- Separate projected results from confirmed fork results.
- Preserve raw machine-readable artifacts.
- State fork block and configuration hashes.
- Label toy-pool results as testnet evidence.
- Do not extrapolate benchmark rates to production.

## 19. Testing and acceptance strategy

### 19.1 Unit tests

Unit coverage must include:

- unit and decimal normalization;
- target-range classification;
- deterministic ordering and IDs;
- balance, leg-size, turnover, and cash constraints;
- conservative funding across ordered legs;
- failure classification;
- candidate ranking and backoff; and
- stale or invalid input refusal.

### 19.2 Integration tests

Integration coverage must include:

- authoritative state reads;
- ABI encoding and error decoding;
- executable quote sampling;
- exact `rebalance(Trade[])` simulation;
- correct caller and role behavior;
- fork-only oracle recovery and pool synchronization; and
- post-transaction state verification.

### 19.3 Scenario acceptance

For every benchmark scenario, the run must produce a complete artifact even if no transaction executes. A successful run means the system made and recorded the correct safe decision; it does not require a trade.

### 19.4 Safety invariants

No approved plan may:

- use stale or missing prices;
- exceed a hard vault or configured policy limit;
- spend more than conservatively available;
- rely on an unsupported route;
- omit exact-call simulation;
- execute after its bound state or quote has expired; or
- continue from an unconfirmed local projection.

## 20. Observability and product metrics

### 20.1 Decision telemetry

Each cycle must expose:

- state-read health and freshness;
- policy version and validation status;
- candidate counts and rejection reasons;
- selected execution mode;
- original fast-path failure;
- simulation request and result;
- execution status; and
- post-state reconciliation.

### 20.2 Product metrics

The first meaningful product metrics are:

- percentage of eligible cycles resolved by `FAST_PATH`;
- percentage routed to `ADAPTIVE_FALLBACK`;
- percentage of recoverable failures that yield an approved safe subset;
- percentage ending in `NO_TRADE`, grouped by reason;
- number of unsafe residual trades avoided;
- simulation-to-confirmation success rate;
- simulation rejection rate, grouped by cause;
- state-to-decision latency;
- policy-compliant turnover and drift improvement;
- quote loss and confirmed NAV loss;
- number of prevented invalid or unsafe submissions;
- number of integrated vaults and recurring rebalance cycles; and
- notional analyzed, approved, and confirmed under orchestration.

These metrics measure orchestration quality. They do not imply investment performance.

### 20.3 Alerts

Production alerts must eventually cover repeated stale data, unsupported state changes, simulation divergence, authorization failure, abnormal no-trade rates, plan expiry, transaction replacement, and post-state mismatch. Alert thresholds remain part of production operations design.

## 21. Go-to-market and commercial hypothesis

### 21.1 Wedge

The initial wedge is teams operating multi-asset vaults with existing accounting and explicit rebalance controls but unreliable execution under real liquidity constraints.

### 21.2 Value proposition

Setpoint offers:

- fewer avoidable reverts;
- a safe fallback when full execution is infeasible;
- less unnecessary fragmentation when full execution is feasible;
- auditable decision evidence; and
- integration without transferring custody or replacing vault accounting.

### 21.3 Validation needed

Before production positioning is frozen, Setpoint must validate:

- which vault subtype feels this problem frequently enough to buy;
- who owns the operational budget;
- which execution venue or aggregator must be supported first;
- acceptable integration and policy-administration workflows; and
- whether the operator console provides sufficient trust and control.

No revenue, customer, or partnership claim is established by the RWA Index integration.

## 22. Positioning and competitive boundary

Setpoint sits between vault/accounting systems and execution venues.

It is not:

- a vault platform;
- an asset manager;
- a custody provider;
- an oracle;
- a DEX or liquidity source;
- a generic aggregator;
- an intent marketplace;
- a trading bot; or
- an AI investment agent.

Its differentiation is policy-aware hybrid orchestration against the target vault's actual constraints, with a preference for the simplest safe execution and a deterministic fallback when that execution is not viable.

## 23. Milestones

| Milestone | Status | Exit criterion |
|---|---|---|
| M0 — Foundation | Complete (accepted) | Clean reproducible repository, architecture boundary, pinned external target |
| M1 — External-vault harness | Complete (accepted) | Read real RWA state and successfully simulate valid `rebalance(Trade[])` on a fork |
| M2 — Truthful baseline | Complete (accepted) | Reproducible full-batch control group and scenario artifacts |
| M3 — Solver v1 | Complete (accepted) | Deterministic core planning, typed no-trade, real simulation gate |
| M4 — Liquidity-aware solver | Complete (accepted) | Executable-depth sampling and equivalent-state comparison |
| M4.1 — Batch planner | Complete (accepted) | Multi-leg adaptive batches, conservative funding, bounded backoff |
| M4.2 — Hybrid orchestration | Complete (accepted) | Fast path by default, allowlisted adaptive fallback, accepted decision record |
| M5 — Operator console | Next | Thin UI faithfully presents existing state, decisions, simulation, and artifacts |
| Security/failure demonstrations | Future | Demonstrate stale oracle, malicious target, and insufficient-liquidity handling |
| Public deployable demo | Future | Publish an explicitly scoped, reproducible application |
| External founder/user validation | Future | Obtain external feedback on simulation and benchmark evidence |
| Documentation and demo video | Future | Polish architecture, benchmark presentation, and end-to-end demo |
| Hackathon submission | Future | Package only verified claims and reproducible evidence |
| Production adapter | Not started | Define after venue and ICP selection |

Milestone acceptance records technical evidence. It does not imply production readiness.

## 24. M5 operator console and demo requirements

### 24.1 M5 objective

M5 makes the accepted orchestration legible and operable without changing execution logic. The console consumes the same typed state and result artifacts used by tests and runners.

### 24.2 Required views

The first operator console must show:

- chain, vault, block, data freshness, and execution identity;
- NAV, balances, current weights, target ranges, and drift;
- active policy limits and hard vault guards;
- selected mode: `FAST_PATH`, `ADAPTIVE_FALLBACK`, or `NO_TRADE`;
- exact ordered trade legs and minimum outputs;
- quote and simulation evidence;
- the original fast-path failure when fallback activates;
- removed, resized, and blocked legs with their reasons;
- projected and confirmed post-state metrics;
- before-to-after authoritative drift;
- transaction or no-trade status;
- transaction or fork proof, clearly labeled; and
- a link or export for the complete evidence artifact.

### 24.3 Required demo narrative

The demo must include:

1. a normal scenario in which the full coherent batch passes and executes as `FAST_PATH`;
2. a large-target scenario in which the same honest simple planner fails with `INSUFFICIENT_OUTPUT`, adaptive fallback executes a safe subset, and the unsafe residual is refused; and
3. a stale-oracle scenario that returns `NO_TRADE` without invoking fallback.

### 24.4 UI restrictions

The UI must not:

- become a retail trading interface;
- hide or relabel failures for presentation;
- contain a separate planning implementation;
- imply live production execution where the action is fork-only;
- fabricate realized savings or benchmark results; or
- expand M5 into policy administration or generic venue integration.

## 25. Risks, kill criteria, and open questions

### 25.1 Principal risks

- production vaults may not expose sufficiently reliable authoritative accounting;
- executable quote evidence may diverge from settlement under MEV or latency;
- vault-specific adapters may be too costly to maintain without a stable interface class;
- adaptive fallback may rarely rescue cases in the chosen production ICP;
- operators may prefer venue-native tooling if Setpoint's evidence and controls are not materially better;
- target-policy compromise can make technically valid execution economically malicious; and
- toy testnet liquidity may poorly represent production behavior.

### 25.2 Kill or pivot criteria

Reconsider the product or selected ICP if production-oriented evidence shows that:

- simple execution almost never fails for recoverable reasons;
- fallback cannot materially rescue or de-risk failed rebalances;
- authoritative state cannot be obtained reliably enough for safe orchestration;
- integration cost exceeds the operational value delivered;
- operators will not delegate or adopt the required execution workflow; or
- safe execution requires Setpoint to take custody or replace upstream accounting.

The criterion is not whether adaptive planning beats the baseline in every normal scenario.

### 25.3 Remaining open questions

- Which production ICP subtype has the highest frequency and cost of recoverable rebalance failure?
- Which first production adapter best tests the product thesis?
- What quote abstraction preserves executable semantics across venues?
- How should gas enter the candidate objective without obscuring safety?
- Who may create, approve, pause, and version production policy?

## 26. Definition of done and current program state

### 26.1 Definition of done for the current core

The current core is complete when it can reproducibly read real external-vault state, preserve a truthful baseline, select the simple path when safe, activate adaptive planning only on an allowlisted recoverable failure, simulate exact calldata against the vault, refuse unsafe residuals, and record the complete decision. M0–M4.2 meet this definition on the RWA Index fork harness.

### 26.2 What is frozen

- non-custodial orchestration above authoritative vault accounting;
- one accounting numeraire for the first integration;
- simple coherent `FAST_PATH` as the default;
- adaptive planning as a bounded recoverable-failure fallback;
- exact target-vault simulation before approval;
- fail-closed behavior for stale, invalid, unauthorized, unsupported, and unknown states;
- re-reading confirmed state after execution;
- a truthful, unchanged baseline; and
- no DEX, cross-vault netting, AI execution, or UI-side solver.

### 26.3 What remains open

- first production ICP subtype;
- first production execution adapter;
- multi-venue quote abstraction;
- gas-aware optimization; and
- production policy administration and approval.

### 26.4 What is supported by current evidence

- RWA Index state and guards can be reproduced on a disposable fork.
- The deployed stale-oracle condition can be observed and handled without weakening the guard.
- The full honest simple batch is the best path in the tested normal scenarios when it passes.
- Adaptive fallback can execute a safe useful subset after a recoverable full-batch failure.
- The system can refuse an unsafe residual after partial progress.
- Every accepted claim above is backed by source, tests, fork behavior, or versioned artifacts.

### 26.5 Known limitations

- Evidence is from Robinhood Chain testnet and toy Synthra liquidity, not production markets.
- Executable liquidity is sampled at discrete sizes; there is no proof of a continuous mathematical optimum.
- Quotes are bound to confirmed state and must be discarded when that state changes.
- Oracle timestamps are refreshed only through fork impersonation while price values are preserved.
- The pool syncer is testnet-only.
- Fork-only mock-USDC probe funding supports sampling and is not production capital.
- The current integration uses one Synthra venue path and one accounting numeraire.
- There is no cross-venue routing.
- Gas is measured only diagnostically and is not optimized.
- There is no production key management, transaction service, persistence layer, alerting stack, or policy administration.
- There is no CoW or 0x adapter.
- There is no production customer; RWA Index is not a customer or partner.
- No production NAV is currently under Setpoint orchestration.
- Benchmark results do not demonstrate universal outperformance.

### 26.6 Next milestone

The next milestone is **M5: operator console**. It must expose the accepted hybrid orchestration and real evidence without modifying the frozen execution core. No M5 implementation is part of this PRD revision.

---

## Appendix A — Current repository evidence

The accepted M4.2 implementation is recorded by:

- commit `98fb490b77f40f7cef56eb9e55cd1e80a8c3ec41`;
- decision record `docs/decisions/0001-hybrid-rebalance-orchestration.md`;
- command `pnpm m4:hybrid`;
- `artifacts/m4-2-summary.json` plus versioned cycle, hybrid, and comparison artifacts; and
- the unchanged M2 aggregate hash `dcd079ed25ff6fd7683c947fbf46748abd70862fe2a85a368c919b26fe7cee92`.

The accepted final M4.2 fork was block `124725774`, hash `0xb5fcc713b8f099c630eb808e65dff914fc3d5ee723abda8e29c680482766bc87`. A later run may use a different block; it must record that identity and must not overwrite historical claims without review.

## Appendix B — Decision codes

The stable public vocabulary must include at least:

- `FAST_PATH`
- `ADAPTIVE_FALLBACK`
- `NO_TRADE`
- `STALE_PRICE`
- `MISSING_PRICE`
- `INVALID_POLICY`
- `UNAUTHORIZED`
- `UNSUPPORTED_ASSET`
- `UNSUPPORTED_ROUTE`
- `INSUFFICIENT_OUTPUT`
- `TRADE_TOO_LARGE`
- `INSUFFICIENT_BALANCE`
- `DRIFT_NOT_IMPROVED`
- `EXCESSIVE_VALUE_LOSS`
- `NO_SAFE_LIQUIDITY`
- `STALE_LIQUIDITY`
- `SIMULATION_FAILED`
- `UNKNOWN_FAILURE`

Integrations may retain more specific internal details, but must map them conservatively into the product-level taxonomy.

## Appendix C — Decision log

| Decision | Status | Rationale |
|---|---|---|
| Treat vault accounting as upstream | Frozen | Avoid duplicate or conflicting books |
| Use a single initial numeraire | Frozen | Matches first integration and limits ambiguity |
| Keep Setpoint non-custodial | Frozen | Minimizes trust and integration surface |
| Use a truthful simple full batch | Frozen | Establishes the correct default and control group |
| Use adaptive planning only as fallback | Frozen | M2–M4.2 evidence shows complexity is valuable primarily on recoverable failure |
| Require exact target-vault simulation | Frozen | Local estimates cannot represent all hard guards |
| Re-read after confirmation | Frozen | Prevents plans from compounding projected state |
| Build operator console before production adapters | Current sequence | Makes evidence and decisions reviewable without changing the core |
| Choose first production adapter | Open | Requires ICP and venue evidence |
| Add gas-aware optimization | Open | Requires production fee and routing context |

## Appendix D — Glossary

- **Accounting numeraire:** the single unit used to compare portfolio values.
- **Adaptive fallback:** a bounded planner invoked after a recoverable fast-path failure.
- **Authoritative state:** state read from the integrated vault or its designated accounting source.
- **Drift:** distance between current weights and permitted target ranges under the integration's defined metric.
- **Executable liquidity:** output evidenced for a concrete input through the real venue path, not an advisory spot price.
- **Fast path:** the complete simple rebalance validated and simulated as one coherent batch.
- **Recoverable failure:** an allowlisted failure for which resizing, reordering, or choosing a safe subset may produce a valid transaction.
- **Simulation gate:** execution of exact proposed calldata against target-vault state without committing it.
- **Target range:** permitted minimum and maximum weight for an asset.
- **Typed no-trade:** a deliberate refusal with a stable reason and supporting evidence.

## Appendix E — PRD governance

This document is the product and engineering source of truth from version 1.2 onward. Changes to frozen decisions require a new accepted decision record and a PRD version change. Benchmark artifacts and implementation commits are evidence for the PRD; they do not silently redefine it. The prior v1.1 PDF remains in the repository for history.
