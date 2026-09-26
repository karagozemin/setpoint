#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_rpc="${RWA_SOURCE_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
fork_host="${RWA_FORK_HOST:-127.0.0.1}"
fork_port="${RWA_FORK_PORT:-8545}"
fork_rpc="http://${fork_host}:${fork_port}"
anvil_log="${project_root}/artifacts/m4-1-anvil.log"

for command_name in anvil cast pnpm; do
  command -v "${command_name}" >/dev/null 2>&1 || {
    echo "missing required command: ${command_name}" >&2
    exit 1
  }
done

mkdir -p \
  "${project_root}/artifacts/liquidity-m4-1" \
  "${project_root}/artifacts/solver-v2-batch" \
  "${project_root}/artifacts/comparison-m4-1"

anvil_args=(
  --fork-url "${source_rpc}"
  --chain-id 46630
  --host "${fork_host}"
  --port "${fork_port}"
  --no-rate-limit
)
if [[ -n "${RWA_FORK_BLOCK_NUMBER:-}" ]]; then
  anvil_args+=(--fork-block-number "${RWA_FORK_BLOCK_NUMBER}")
fi

anvil "${anvil_args[@]}" >"${anvil_log}" 2>&1 &
anvil_pid=$!
cleanup() {
  kill "${anvil_pid}" >/dev/null 2>&1 || true
  wait "${anvil_pid}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

ready=false
for _ in $(seq 1 100); do
  if cast chain-id --rpc-url "${fork_rpc}" >/dev/null 2>&1; then
    ready=true
    break
  fi
  if ! kill -0 "${anvil_pid}" >/dev/null 2>&1; then
    echo "Anvil exited before becoming ready. See ${anvil_log}" >&2
    exit 1
  fi
  sleep 0.1
done
if [[ "${ready}" != true ]]; then
  echo "Anvil did not become ready. See ${anvil_log}" >&2
  exit 1
fi

actual_chain_id="$(cast chain-id --rpc-url "${fork_rpc}")"
if [[ "${actual_chain_id}" != "46630" ]]; then
  echo "unexpected fork chain ID: ${actual_chain_id}" >&2
  exit 1
fi

export RWA_FORK_RPC_URL="${fork_rpc}"
export SETPOINT_SOLVER_VARIANT="batch"
cd "${project_root}"
pnpm exec tsx integrations/rwa-index/src/adaptive-runner.ts
