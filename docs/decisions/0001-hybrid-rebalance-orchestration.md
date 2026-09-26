# Decision 0001: Hybrid rebalance orchestration

Status: accepted for M4.2  
Date: 2026-09-26

## Context

Setpoint originally treated liquidity-aware adaptive sizing as the default execution strategy. The equivalent-state M2, M4, and M4.1 benchmarks showed that this adds unnecessary decomposition when a straightforward coherent rebalance already passes the vault's real safety checks. In the deep, thin, asymmetric, and defensive scenarios, the simple M2 batch was superior or equivalent in completion speed. In the large-target scenario, however, the simple 10-leg batch failed before execution while M4.1 found and executed a safe subset.

## Decision

Setpoint will use a hybrid strategy:

1. Build the simplest coherent rebalance from confirmed vault state.
2. Apply Setpoint policy and executable-liquidity preflight checks.
3. Simulate the exact batch against the target vault.
4. If it is safe and executable, select `FAST_PATH` without invoking adaptive planning.
5. If it fails for an explicitly recoverable liquidity, output, balance, or size reason, invoke the existing M4.1 planner as `ADAPTIVE_FALLBACK`.
6. Fail closed for stale or missing prices, invalid policy, paused/unauthorized execution, unsupported assets, missing accounting state, and other non-recoverable failures.
7. After every confirmed execution, discard the old plan and repeat from newly confirmed state.

## Product meaning

Setpoint is not trying to outperform simple execution when simple execution already works. It is the safety and orchestration layer between vault policy and execution: it preflights ordinary rebalances, rescues viable progress when a batch would otherwise fail, refuses unsafe residual trades, and always re-solves from confirmed state.

This refines the execution strategy without changing the core product or its boundaries. It does not add custody, vault accounting, a DEX, cross-vault netting, AI execution logic, CoW/0x adapters, or UI.

