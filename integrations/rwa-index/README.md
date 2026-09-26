# RWA Index M1–M4 integration

This adapter-first harness targets the existing RWA Index vault; it does not redeploy a Setpoint-owned copy.

## External deployment

| Item | Robinhood Chain testnet address |
|---|---|
| Vault | `0x357CD10343829DBd5889c7b0B2fBc4388fC4875B` |
| Oracle | `0x2F2316d6D4a8952730a71BfCD9fa0Af5A0138AB9` |
| Manager | `0xbB91Fe38652991f0E9735dc139601bD637ae4d66` |
| Pool syncer | `0x1f954000e202EBbB82Da88D53000b3eF0Cd34aeA` |
| Oracle feeder / syncer owner | `0x156aB5483E47eCd1aFb1260d1093c96F1b9596b7` |

The harness discovers the vault's base asset, swap adapter, Synthra factory, fee tier, basket, and pools from contract state instead of trusting duplicated pool configuration.

## Freshness and pool preparation

At the first verified run, every deployed oracle price had timestamp `1780265370` (`2026-05-31T22:09:30Z`), while the fork block timestamp was in September 2026. Both `totalAssets()` and `totalDrift()` reverted with `StalePrice` as designed.

To isolate freshness from market-data sourcing, the harness reads those nonzero deployed values, calls `setPrices` through the actual `PRICE_FEEDER_ROLE` holder on Anvil, and then calls `PoolPriceSyncer.syncToPrice` through its actual owner. It rejects missing pools, zero liquidity, role/address mismatches, and a post-sync square-root-price error above the syncer's own 50 bps tolerance.

This is explicitly fork-only preparation. It is not a live price update and does not claim that the retained values are current equity prices.

## Candidate used for M1

M1 is compatibility proof, not the final Setpoint solver. The deterministic candidate builder finds the largest oracle-valued overweight and underweight positions, sells half of the transferable excess into the base asset, and buys the underweight asset with the sell leg's guaranteed minimum output. This produces the existing vault's exact tuple shape:

```solidity
struct Trade {
    address tokenIn;
    address tokenOut;
    uint256 amountIn;
    uint256 minAmountOut;
}
```

The builder tries progressively smaller fractions only when the real vault simulation rejects a candidate. Every attempted candidate and failure reason is retained in the artifact. A passing `eth_call` is re-simulated immediately before the fork transaction, and the resulting state is read from the vault rather than projected.

## Success conditions

The command exits successfully only when all of the following hold:

- the stale state was observed and rejected before refresh;
- deployed authorization and addresses match configuration;
- every basket pool exists, has active liquidity, and synchronizes within tolerance;
- authoritative state and all deployed guards are readable;
- the selected `Trade[]` passes `rebalance` simulation as the real manager;
- the same call succeeds as a local-fork transaction;
- `totalDrift()` strictly decreases; and
- post-rebalance NAV satisfies the deployed `maxRebalanceLoss` floor.

## M2 truthful static baseline

Run:

```bash
pnpm m2:baseline
```

The baseline mirrors the external project's static planner and the PRD control-group definition. For each exact onchain target it computes oracle-valued overweights and underweights, chunks each desired transfer by `maxTradeFraction`, orders all USDC sales before purchases, and uses the deployed slippage floor for `minAmountOut`. It never reads pool depth or quote impact when choosing sizes and does not back off after a failed simulation.

Every successful cycle is followed by a new authoritative vault read before another cycle can be considered. Target-region completion is defined as `totalDrift() <= driftThreshold`, using the deployed 5% threshold. Exact target weights are reported as zero-width ranges.

### Scenario construction

- **Moderate/deeper toy:** approximately 10% target weight moves from AMD to TSLA.
- **Moderate/thin toy:** the same approximate shift moves from AMD to NFLX.
- **Asymmetric:** the shift out of AMD is split across TSLA and NFLX.
- **Large target change:** NFLX rises to 49%; static sizing proposes three buy chunks after its sells.
- **Defensive:** cash target rises from 0% to 20%, with each stock target set to 16%.
- **Stale oracle:** uses untouched deployment timestamps and must return `STALE_ORACLE` without proposing trades.

The first four target-change scenarios declare a 2% cash target. This is an explicit, identical scenario-policy input that prevents ordinary DEX fees from being confused with the intended deep/thin comparison. It does not change the baseline algorithm or vault guards. All scenario changes use the deployed `setStrategy` function on the disposable fork.

“Deep” and “thin” are only relative labels within these toy pools. The runner records active liquidity and token inventory as context, but does not present either as production executable depth.

### Artifacts

Each `artifacts/baseline/<scenario>.json` contains the fork identifier, guards, before/after state, exact target ranges, proposed `Trade[]`, leg count, attempted turnover, simulation outcome, classified revert, realized state deltas, successful/attempted cycle counts, cumulative turnover, and target-region status.

`artifacts/baseline-summary.json` aggregates the matrix. The latest JSON evidence is versioned and recreated by the command; local Anvil logs are ignored.

## M3 Solver v1 adapter

Run:

```bash
pnpm m3:solver
```

`setpoint-adapter.ts` maps the external deployment into the chain-independent types in `src/core/`. It discovers the same deployed basket and execution path as M1/M2, reads authoritative NAV and drift, and derives absolute per-leg capacity from the deployed `maxTradeFraction`. Exact RWA targets become acceptable ranges of ±0.25 percentage points, clipped to `[0%, 100%]`.

The runner uses the exact shared M2 scenario definitions. Each iteration reads confirmed state, asks Solver v1 for one deterministic USDC-hub step, and executes only a plan that passed the real vault's `rebalance(Trade[])` simulation. It then throws away that plan and starts the next iteration with another authoritative read.

Typed terminal outcomes include stale/missing inputs, invalid or impossible policy, unsupported assets, invalid NAV, paused state, low drift, reached range, no feasible plan, insufficient balance, and simulation rejection. Raw vault reverts are retained in rejected-alternative records and mapped to typed simulation codes.

### M3 artifact shape

Each `artifacts/solver-v1/<scenario>.json` records:

- source fork and deployed guards;
- exact scenario policy and the explicit target-range tolerance;
- every confirmed solver input;
- proposed trades, expected range drift, turnover, active constraints, rejected alternatives, and simulation result;
- fork transaction hash and actual post-execution vault state for successful steps; and
- terminal typed result, target-region status, actual drift progress, and limitations.

`artifacts/solver-v1-summary.json` aggregates the matrix and records milestone checks and claim boundaries. The latest JSON evidence is versioned; Anvil logs remain ignored.

### Deliberate M3 limits

- Pool depth and inventory do not influence sizing.
- There is no DEX quote curve, price-impact model, gas model, or non-USDC route search.
- Basic deterministic halving applies only to size, balance, minOut construction, and drift-improvement failures.
- `INSUFFICIENT_OUTPUT` stops safely; liquidity-aware resizing is M4.
- Results are fork observations, not a claim that Solver v1 outperforms the M2 baseline.

## M4 executable-liquidity integration

Run:

```bash
pnpm m4:adaptive
```

### Why adapter `quote()` is not used

The upstream `SynthraSwapAdapter.quote()` is a `slot0` spot calculation and does not execute through pool liquidity. M4 samples the actual `swap()` path with `eth_call` instead. Each curve is produced from a temporary Anvil snapshot with a temporary vault allowance; mock-USDC probe balance is minted only inside that snapshot. The snapshot is reverted before solving.

Each sample records the pair, venue, pool, fee, input, real adapter output, oracle output, numeraire input/output value, impact, estimated fee, quote loss, min-out compatibility, state ID, block, timestamp, expiry, and validity reason. The curve reports both maximum tested size and maximum sampled size compatible with the vault's oracle floor.

### Adaptive sizing and scoring

Solver v2 considers only current-state samples and caps them by target-band distance, max leg value, balance/cash, cash buffer, turnover policy, impact policy, and min-out compatibility. Feasible candidates are ordered lexicographically:

1. smallest expected target-band drift;
2. lowest quote loss;
3. lowest turnover;
4. largest min-out safety margin;
5. fewest legs; and
6. stable candidate ID.

There are no opaque weighted scores. A real `INSUFFICIENT_OUTPUT` rejects the binding sampled leg and all same-or-larger alternatives for that curve; retry count is bounded.

### Fair comparison

M2 and M4 start from the same post-`setStrategy` snapshot for every scenario. The common primary terminal criterion is the ±0.25 percentage-point target region. The deployed 5% trigger is reported separately and is not changed. During the comparison only, both algorithms may continue below it until target bands, hard failure/no-trade, or the common cycle cap.

Artifacts are split as follows:

- `artifacts/liquidity/`: every curve used for an adaptive decision;
- `artifacts/solver-v2/`: full Setpoint cycle records;
- `artifacts/comparison/`: paired baseline/Setpoint records from identical scenario state; and
- `artifacts/m4-summary.json`: aggregate metrics and fairness declarations.

The current artifacts contain negative results as well as successful steps. In particular, the baseline reaches target bands faster in the normal toy scenarios. For the large target change, Solver v2 executes two safe steps but then the NFLX pool has no sampled buy size compatible with the 98% oracle floor. No broad performance claim is supported.

## M4.1 multi-leg batch planner

Run:

```bash
pnpm m4:batch
```

M4.1 uses the same fork preparation, scenario definitions, M2 planner, target bands, guards, and terminal criteria as M4. The M2 source hash is checked against the versioned M4 summary before M4.1 artifacts are accepted.

For a confirmed state, the planner:

1. samples each materially relevant stock→USDC and USDC→stock direction through the deployed adapter's real `swap()` path;
2. aims out-of-band weights toward their band midpoint while leaving already acceptable weights alone unless they must fund an outstanding one-sided correction;
3. derives each leg's maximum min-out-compatible sampled size and constructs sells before buys;
4. funds buys only from starting USDC plus conservative sell `minAmountOut`, preserving the required cash floor;
5. evaluates a bounded set consisting of the maximal batch and one local reduction/removal per directional leg;
6. orders those batches by expected target-band drift, quote loss, turnover, minimum safety margin, leg count, then deterministic ID;
7. requires real vault simulation, and on `INSUFFICIENT_OUTPUT` reduces only the tightest safety-margin leg; and
8. after execution, discards the plan, re-reads confirmed vault state, and rebuilds all curves and decisions.

Every accepted leg records desired, selected, and maximum safe amounts, its binding constraint, curve/sample, expected output, `minAmountOut`, quote loss, and safety margin. Terminal no-trade records retain unavailable and removed legs rather than hiding them.

Artifacts are isolated from M4:

- `artifacts/liquidity-m4-1/`
- `artifacts/solver-v2-batch/`
- `artifacts/comparison-m4-1/`
- `artifacts/m4-1-summary.json`

The command validates scenario count, equivalent initial state/NAV, simulation approval for every executed batch, confirmed post-state presence, and the unchanged M2 planner hash.
