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
deployer ── immutable reference prices ──> oracle ──> vault accounting
any caller ── approved timestamps only ──┘
```

All assets are 18-decimal testnet-only ERC-20s. Pools charge 30 bps and each starts with 50,000,000 sUSDG of base depth. A wallet receives one vault with 10,000 sUSDG of initial oracle value in a deliberately drifted 55/25/10/7/3 allocation. The factory stops after 32 vaults / 320,000 sUSDG of aggregate seeded NAV. The default target is 20% for cash and each risk asset.

## Guards

- immutable wallet owner;
- targets sum to exactly 100%, with a 70% per-risk-asset cap;
- only registered base/risk routes;
- 2% minimum drift trigger and strict post-trade drift improvement;
- 30% NAV maximum value per leg;
- 3% oracle slippage floor;
- 24-hour maximum oracle age; and
- 2% maximum batch NAV loss;
- one vault per address plus a 32-vault global seed ceiling; and
- immutable initialized oracle values with permissionless timestamp-only refresh.

## Verify

```bash
forge fmt --check
forge build --sizes
forge test -vv
forge test --gas-report
```

The current suite has 14 tests, including 256 fuzz cases, repeated creation rejection, multiple-wallet global-budget exhaustion, aggregate pool-availability bounds, unauthorized owner/updater checks, immutable reference prices, permissionless timestamp refresh, stale-oracle refusal, route refusal, real token swaps, and the constant-product non-decrease invariant.

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

The oracle heartbeat is 24 hours. Initialized reference prices cannot change, and `refreshPrices` lets any caller renew only approved timestamps. The GitHub Action runs every six hours; `sandbox:refresh-oracle` provides the same permissionless recovery path after checking chain ID, simulation, and receipt. `sandbox:oracle-status` verifies freshness and equality with the immutable references. If no caller refreshes for 24 hours, the vault still fails closed with `STALE_PRICE`.

The global seed ceiling bounds the total adversarial inventory that can touch shared pools. Every pool's base depth is more than 156 times the maximum aggregate seeded NAV, and deployment smoke checks require a worst-case full-budget quote in either direction to remain within the 3% oracle floor. This is bounded Sybil impact, not human-identity enforcement: once all 32 slots are consumed, further creation is deliberately unavailable until a new deployment.
