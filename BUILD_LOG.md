# Build log

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

Both are regenerated on each run and intentionally ignored by git.

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
- This is not yet the M2 truthful static baseline or the M3/M4 Setpoint solver. No comparative performance claim should be made from this harness result.
- Pool depth is toy-sized and must not be represented as production liquidity.
