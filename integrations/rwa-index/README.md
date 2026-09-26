# RWA Index M1 integration

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
