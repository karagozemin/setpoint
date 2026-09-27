# Decision 0003: wallet-owned testnet sandbox as the primary product path

- Status: accepted
- Date: 2026-09-27

## Context

The external integration registry proved that Setpoint could normalize real vault state, but most funded external deployments deliberately restrict rebalance authority to keepers, managers, agents, or signed-intent lanes. A public judge could inspect meaningful state but could not complete the core action.

Giving a random wallet authority over an external vault would be false and unsafe. Keeping an empty public deployment as the primary demo would also misrepresent product readiness.

## Decision

Setpoint owns a clearly labeled Robinhood Chain Testnet sandbox protocol and makes it the first surface in `/app`.

- `SetpointSandboxFactory` creates one immutable-owner vault per wallet.
- The factory seeds only testnet sandbox assets in a bounded, drifted allocation.
- Timestamped oracle data and real constant-product pool reserves are onchain.
- The swap adapter allows only registered sUSDG/risk routes.
- Targets are owner-written onchain state.
- The live adapter converts current vault and pool state into the existing hybrid-core inputs; it does not fork the solver.
- Exact owner simulation, wallet confirmation, transaction receipt, and confirmed post-state are mandatory.
- External integrations remain a separate monitoring layer and `/evidence` remains historical.

## Consequences

The product can demonstrate a real wallet-owned rebalance without claiming third-party authority or production value. The repository now owns smart-contract security and oracle-operation responsibilities for this sandbox. A deployment is not considered live until the checked record contains real addresses and transaction hashes and the public smoke test passes.

The sandbox is not a production fund, permissionless production oracle, general DEX, custody service, or claim that external protocols are Setpoint customers.
