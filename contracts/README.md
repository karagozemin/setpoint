# Setpoint Sandbox contracts

This Foundry workspace is the Setpoint-owned execution environment for Robinhood Chain Testnet (`46630`). It is deliberately separate from the pinned external RWA Index source under `third_party/`.

## Topology

```text
wallet ── createVault() ──> factory ── deploy/seed ──> owner vault
                                                  │
owner vault ── guarded swaps ──> route adapter ──┼─> sUSDG/sALPHA pool
                                                  ├─> sUSDG/sBETA pool
                                                  ├─> sUSDG/sGAMMA pool
                                                  └─> sUSDG/sDELTA pool
owner/updater ── prices + timestamps ──> oracle ─────> vault accounting
```

All assets are 18-decimal testnet-only ERC-20s. Pools charge 30 bps and use different seeded depths. A wallet receives one vault with 10,000 sUSDG of initial oracle value in a deliberately drifted 55/25/10/7/3 allocation. The default target is 20% for cash and each risk asset.

## Guards

- immutable wallet owner;
- targets sum to exactly 100%, with a 70% per-risk-asset cap;
- only registered base/risk routes;
- 2% minimum drift trigger and strict post-trade drift improvement;
- 30% NAV maximum value per leg;
- 3% oracle slippage floor;
- 24-hour maximum oracle age; and
- 2% maximum batch NAV loss.

## Verify

```bash
forge fmt --check
forge build --sizes
forge test -vv
forge test --gas-report
```

The current suite has ten tests, including 256 fuzz cases, unauthorized owner/updater checks, stale-oracle refusal, route refusal, real token swaps, and the constant-product non-decrease invariant.

## Deploy and operate

Run these from the repository root:

```bash
export SETPOINT_SANDBOX_DEPLOYER_KEY=0x... # local shell only
export RH_TESTNET_RPC=https://rpc.testnet.chain.robinhood.com # optional
pnpm sandbox:deploy
pnpm sandbox:oracle-status
pnpm sandbox:refresh-oracle
pnpm sandbox:smoke
```

`sandbox:deploy` first performs a non-broadcast simulation/gas estimate, then broadcasts, writes `deployments/setpoint-sandbox-rh-testnet.json`, and runs the public smoke test. It exits before simulation or broadcast if the deployer key is absent. Never commit, print, or paste a private key into a command argument or tracked file.

If a separate updater is configured, export its public address as `SETPOINT_SANDBOX_ORACLE_UPDATER` during deployment and use `SETPOINT_SANDBOX_ORACLE_UPDATER_KEY` only in the local environment when refreshing.
