# Build log

## 2026-09-26 — M3 Setpoint Solver v1

### Implemented

- Added chain-independent canonical types for portfolio state, policy, ranges, prices, trades, plans, simulations, rejected alternatives, and typed no-trade outcomes.
- Added target-range classification and feasibility validation before candidate generation.
- Added a deterministic one-step USDC-hub solver with hard-constraint-first ordering, address-based tie-breaking, available-balance checks, optional turnover/improvement/cash policies, and a mandatory simulation gate.
- Added simple deterministic halving only for M3-eligible failures. `INSUFFICIENT_OUTPUT` is intentionally not resized because that requires the M4 liquidity/depth model.
- Added an RWA Index adapter that reads the deployed vault's actual state, targets, prices, and guards and simulates the exact `rebalance(Trade[])` interface.
- Extracted the exact M2 scenario policies into a shared module so M2 and M3 cannot silently diverge.
- Added an isolated M3 runner and artifacts. After each executed step it discards the old plan, reads confirmed fork state, and solves again.
- Added nine solver tests; the combined M2/M3 suite now contains 17 passing tests.

### Commands

```bash
pnpm typecheck
pnpm test
pnpm m3:solver
```

Generated output:

- `artifacts/solver-v1/stale-oracle.json`
- `artifacts/solver-v1/moderate-drift-deep-toy.json`
- `artifacts/solver-v1/moderate-drift-thin-toy.json`
- `artifacts/solver-v1/asymmetric-liquidity.json`
- `artifacts/solver-v1/large-target-change.json`
- `artifacts/solver-v1/defensive-cash-target.json`
- `artifacts/solver-v1-summary.json`

### Solver behavior

For each confirmed state:

1. Validate NAV, pause state, allowlist, positions, prices, freshness, target feasibility, and policy bounds.
2. Stop with a typed result when the configured target region is reached or authoritative drift is at/below the deployed trigger.
3. Restore cash into its acceptable range first when necessary.
4. Otherwise choose the largest out-of-range source and destination, with token address as the deterministic tie-break.
5. Cap each leg by the deployed absolute 10%-NAV value, available balance, cash policy, and range distance.
6. Construct the deployed 98%-of-oracle `minAmountOut` floor.
7. Accept a plan only after the real external vault simulation passes.
8. Execute only on Anvil, assert actual strict drift reduction and the NAV floor, then re-read and re-solve.

RWA exact targets are adapted to ranges of target ±0.25 percentage points. This tolerance is an explicit M3 integration policy, not a vault contract change. The deployed 5% drift trigger remains authoritative and can stop solving before every asset is inside that tighter range.

### Verified scenario matrix

Final validation fork:

- block: `124692520`
- block hash: `0xb68ec12972f8e4e230f31d1aee4c7790ac84c93e3c151de4785eb30a08d5e803`
- chain ID: `46630`

| Scenario | Initial drift | Final drift | Executed steps | Terminal result |
|---|---:|---:|---:|---|
| Stale oracle | unavailable | unavailable | 0 | `STALE_PRICE` before simulation |
| Moderate, relatively deep toy | 11.417713% | 1.479128% | 2 | `DRIFT_BELOW_TRIGGER` |
| Moderate, thin toy | 11.425554% | 1.538422% | 2 | `DRIFT_BELOW_TRIGGER` |
| Asymmetric liquidity | 11.043267% | 4.755752% | 2 | `DRIFT_BELOW_TRIGGER` |
| Large target change | 31.025554% | 19.506853% | 2 | `SIMULATION_REJECTED` / `INSUFFICIENT_OUTPUT` |
| Defensive 20% cash target | 20.000000% | 3.986560% | 4 | `DRIFT_BELOW_TRIGGER` |

The large-target scenario made two simulation-approved, executed steps and reduced authoritative drift before a later candidate hit the adapter output floor. The solver stopped without executing that rejected candidate. This establishes safe progress, not an M2-vs-M3 performance claim.

### Errors encountered and corrections

- The first full matrix run completed the deep scenario, then Anvil returned “block not found” after a snapshot revert reused a local block number. The adapter now identifies confirmed state from Anvil's authoritative latest block object instead of querying an invalidated explicit local block. The unchanged matrix then completed.
- Expected drift initially mixed the vault's exact-target `totalDrift()` with Setpoint's range-distance projection. Plan expectation fields now use range drift consistently; artifacts separately retain authoritative vault drift before and after execution.
- Basic backoff initially divided an already-rounded `minAmountOut`. It now recomputes the oracle floor from the reduced input to avoid a one-wei slippage-floor violation.

### Assumptions and fork-only behavior

- The RWA integration uses a ±0.25 percentage-point acceptable range around each deployed exact target.
- The vault's `totalAssets()`, `totalDrift()`, balances, targets, guard values, and oracle are authoritative; Setpoint does not reproduce vault accounting.
- The stale solver test replays the original deployed oracle timestamps onto a valid post-refresh portfolio input so validation can fail before simulation. M1/M2 independently record the actual vault stale-read revert.
- Oracle re-timestamping, pool synchronization, manager/syncer impersonation, gas funding, strategy changes, and rebalance execution occur only on disposable Anvil.
- Pool inventory is recorded for context but is not consumed by Solver v1.

### Deliberately deferred / remaining blockers

- No M3 implementation blocker remains; the scenario matrix and artifact schema checks complete reproducibly.
- M4 must add executable depth/quote inputs, cost-aware sizing, and liquidity-aware retry for `INSUFFICIENT_OUTPUT` before any comparative performance claim.
- Gas and expected execution cost remain `null` in M3 plans.
- Exact historical replay still requires an archival Robinhood Chain endpoint; the public RPC supports the latest-state path used here.

## 2026-09-26 — M2 truthful static baseline

### Implemented

- Added a deterministic static baseline matching the RWA Index planner boundary: oracle-valued deltas, 10%-NAV maximum legs, sells before buys, and vault-consistent minimum outputs.
- Kept liquidity/depth entirely outside baseline sizing.
- Added a six-scenario runner using isolated Anvil snapshots of one recorded source fork.
- Added actual-state re-reads after successful cycles; no expected state is reused as confirmed state.
- Persisted per-scenario and aggregate machine-readable artifacts.
- Added typed revert classification for stale price, size, slippage, adapter output, balance, drift, NAV loss, authorization, and asset failures.
- Added eight tests for caps, minimum output, delta detection, sequencing, determinism, recomputation, revert classification, and stale prices.

### Commands

```bash
pnpm typecheck
pnpm test
pnpm m2:baseline
```

Generated output:

- `artifacts/baseline/stale-oracle.json`
- `artifacts/baseline/moderate-drift-deep-toy.json`
- `artifacts/baseline/moderate-drift-thin-toy.json`
- `artifacts/baseline/asymmetric-liquidity.json`
- `artifacts/baseline/large-target-change.json`
- `artifacts/baseline/defensive-cash-target.json`
- `artifacts/baseline-summary.json`

### Baseline algorithm

For each confirmed state:

1. Calculate each stock's target value from vault NAV and its exact onchain target weight.
2. Split every excess/deficit into static chunks no larger than `NAV * maxTradeFraction`.
3. Convert overweight stock chunks to mock USDC first.
4. Spend mock USDC on underweight chunks second.
5. Set each `minAmountOut` to oracle-implied output times `(1 - slippageTolerance)`.
6. Simulate the whole batch against the external vault.
7. On success, execute only on Anvil and re-read the vault. On failure, record the reason and stop without depth-aware resizing.

Target-region completion uses the deployed trigger: `totalDrift() <= 5%`.

### Verified scenario matrix

Final validation fork:

- block: `124684453`
- block hash: `0x87b14680e6386f5622ed1765d10c258f34f5b84ac768d4ff88095d47c8636698`
- chain ID: `46630`

| Scenario | Initial drift | Final drift | Legs | Attempted turnover / NAV | Result |
|---|---:|---:|---:|---:|---|
| Stale oracle | unavailable | unavailable | 0 | 0% | Expected `STALE_ORACLE` no-trade |
| Moderate, relatively deep toy | 11.417713% | 0.075394% | 6 | 20.835426% | Reached region in one successful cycle |
| Moderate, thin toy | 11.425554% | 0.143624% | 6 | 20.851107% | Reached region in one successful cycle |
| Asymmetric liquidity | 11.043267% | 0.072184% | 6 | 20.086533% | Reached region in one successful cycle |
| Large target change | 31.025554% | 31.025554% | 10 | 60.051107% | Simulation failed: `INSUFFICIENT_OUTPUT`; no turnover executed |
| Defensive 20% cash target | 20.000000% | 0.063295% | 5 | 20.000000% | Reached region in one successful cycle |

The thin scenario passed; it simply retained more residual drift and incurred more NAV loss than the relatively deep toy scenario. This is an observation about this recorded toy-pool state, not a Setpoint performance claim. The large change demonstrates a concrete static-sizing failure against the adapter's output floor.

### Errors encountered and corrections

- The first scenario actor address used invalid mixed-case checksum formatting; it was corrected before any benchmark result was accepted.
- The initial large-target vector summed to 90%, so `setStrategy` correctly rejected it. The final vector plus cash target sums exactly to WAD.
- Initial exploratory reallocation scenarios used a 0% cash target. Their static buys consumed the full oracle-valued sale proceeds and failed with `ERC20InsufficientBalance` after DEX fees. The final deep/thin/asymmetric matrix uses an explicit 2% policy cash target for both baseline and future solver runs so liquidity effects are not conflated with a zero-cash funding shortfall.

### Assumptions and fork-only behavior

- Scenario policy changes use the deployed manager and `setStrategy` through Anvil impersonation.
- Existing stale price values are re-timestamped, then the real testnet syncer aligns the toy pools as in M1.
- Snapshot/revert isolates every non-stale scenario at the same prepared fork state.
- Pool token inventory is only a reproducible context proxy; it is not treated as a production quote curve or claimed market depth.
- All writes and scenario target changes exist only on the disposable fork.

### Remaining blockers and next work

- There is no M2 blocker: the control-group artifacts are reproducible with one command.
- The public RPC remains non-archival, so exact old-block replay requires an archival endpoint.
- M3/M4 must use these exact scenario inputs, guards, fork preparation, and metrics when implementing adaptive sizing.
- No comparative or Setpoint performance claim is made in M2.

## 2026-09-26 — M0/M1 external-vault harness

### Implemented

- Read all 35 pages of `Setpoint_PRD_v1_1.pdf` and kept the M0/M1 scope at the vault integration boundary.
- Initialized the previously unversioned folder as a git repository.
- Added RWA Index as a pinned submodule at upstream commit `b2456ca5400ba9ec36d81691554b889fb9250513`.
- Added a minimal TypeScript/viem harness and a single shell entry point that owns the disposable Anvil lifecycle.
- Added address/chain/upstream configuration for the external deployment.
- Verified deployed bytecode, chain ID, vault/oracle/adapter links, manager role, feeder role, and syncer ownership.
- Reproduced the deployed stale-oracle condition before mutation.
- Refreshed oracle timestamps on the fork through the authorized feeder without changing price values.
- Resolved and synchronized all five deployed fee-100 Synthra pools through the deployed pool syncer.
- Read real vault NAV, balances, target weights, cash target, drift, pause state, and guard parameters.
- Built, simulated, and fork-executed the vault's existing `rebalance(Trade[])` flow.
- Added generated JSON evidence with source block, prices, pool state, constraints, candidate attempts, trades, transaction receipt, before/after state, and invariant checks.

### Commands

```bash
git submodule update --init --recursive
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm m1:rwa-index
```

Output:

- `artifacts/rwa-index-m1-latest.json`
- `artifacts/anvil.log`

The latest JSON evidence is versioned; local Anvil logs are regenerated and ignored by git.

### Verified run

Source fork:

- block: `124678866`
- block hash: `0xac3f535eee43d8b2cec5fe29c73d610f093eb3c4bf905a78006adebe87ef09ed`
- chain ID: `46630`

Observed deployed constraints:

- maximum leg value: 10% of pre-batch NAV
- minimum output floor: 98% of oracle-implied output
- maximum price age: 86,400 seconds
- maximum batch NAV loss: 2%
- drift must strictly decrease
- vault paused: false

The current live state was already close to its equal-weight target. The first candidate therefore made a small correction rather than fabricating a large imbalance:

1. sell AMD into mock USDC;
2. buy NFLX with the sell leg's guaranteed minimum proceeds.

Measured fork result:

- `rebalance(Trade[2])` simulation: passed
- fork transaction: `0xb3a76d76ebfb5c1194e08fb0a3e6b9dbe7eae74fed0f274c67ca2a787e0e2381`
- drift: `0.057839%` → `0.045318%`
- NAV: `69.349575584908354972` → `69.349573584742543824` mock-USDC WAD
- strict drift decrease: passed
- 2% NAV floor: passed

These are local-fork results from the recorded source block, not live-chain transactions or benchmark claims.

### Errors and operational findings

- Before refresh, authoritative NAV/drift reads reverted with `StalePrice(TSLA)`. This is the expected deployed guard, not bypassed behavior.
- The public Robinhood testnet RPC is slow for sequential storage reads; the first end-to-end run took longer than a 30-second command-output window but completed normally.
- The upstream repository documents the public RPC as non-archival. Latest-state forking works; old explicit block numbers may fail once pruned.
- No private keys were required and no live-chain write was attempted.

### Assumptions

- All basket and base tokens in this deployment use 18 decimals. The harness verifies every token before applying WAD arithmetic.
- The vault's own oracle/NAV functions are authoritative. The harness does not recreate ERC-4626 share accounting.
- Reusing the deployed nonzero price values with fresh fork timestamps is sufficient for M1 because this milestone tests the stale guard and vault execution interface, not live market-data quality.
- Existing syncer inventory remains sufficient to move each toy pool to its retained oracle value. The harness fails loudly if that ceases to be true.

### Mocked or fork-only behavior

- Account impersonation for the oracle feeder/syncer owner and manager.
- Native gas funding for those impersonated accounts.
- Re-timestamping old oracle values on Anvil.
- Testnet-only pool synchronization using the deployed syncer.
- The base asset itself is the RWA Index project's mintable mock USDC.
- The final rebalance transaction exists only on the disposable fork.

### Remaining blockers and next work

- There is no M1 blocker: the exit criterion is met.
- Exact replay at an old block depends on an archival Robinhood Chain RPC. The default reproducible path therefore records and uses latest available state.
- M2 now supplies the truthful static baseline. The M3/M4 Setpoint solver and comparative benchmark remain unimplemented.
- Pool depth is toy-sized and must not be represented as production liquidity.
