# Setpoint PRD v1.1 → v1.2 changelog

## Changed

- Reframed Setpoint from an adaptive-first solver to a **hybrid safety and execution orchestration layer**.
- Made the simple coherent full rebalance the default `FAST_PATH` when exact-size validation and real vault simulation pass.
- Limited adaptive planning to `ADAPTIVE_FALLBACK` after explicitly recoverable failures.
- Added the accepted M0–M4.2 implementation evidence, including the normal, large-target, and stale-oracle outcomes.
- Replaced the blanket “beat the baseline” framing with a measurable rescue/de-risking standard while preserving the M2 baseline unchanged.
- Added the recoverable/fail-closed failure taxonomy, mode-selection contract, and post-confirmation re-planning rule.
- Updated architecture, functional requirements, benchmarks, metrics, testing, demo narrative, risks, kill criteria, and definition of done around hybrid orchestration.
- Defined M5 as a thin operator console over existing artifacts and core outputs; no UI-side solver or retail trading surface.
- Narrowed open decisions to the production ICP subtype, first production adapter, multi-venue quote abstraction, gas-aware optimization, and production policy administration.

## Preserved

- Non-custodial operation and authoritative upstream vault accounting.
- One accounting numeraire for the first integration.
- Exact target-vault simulation and fail-closed safety behavior.
- RWA Index as an external technical integration, not a customer or partner.
- Explicit exclusions: no new DEX, vault, custody layer, cross-vault netting, AI/LLM execution logic, CoW/0x adapters, or benchmark manipulation.

## Superseded

- PRD v1.1's assumption that adaptive sizing is the default path.
- PRD v1.1 language implying release depends on broadly outperforming static execution.
- The prior milestone sequence that treated the hybrid decision and accepted M0–M4.2 work as future or unresolved.

PRD v1.1 remains in the repository as a historical artifact. PRD v1.2 is the current source of truth.
