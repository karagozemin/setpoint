#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "${project_root}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${project_root}/.env"
  set +a
fi

if [[ -z "${SETPOINT_SANDBOX_DEPLOYER_KEY:-}" && -n "${PRIVATE_KEY:-}" ]]; then
  SETPOINT_SANDBOX_DEPLOYER_KEY="${PRIVATE_KEY}"
  export SETPOINT_SANDBOX_DEPLOYER_KEY
fi
if [[ "${SETPOINT_SANDBOX_DEPLOYER_KEY:-}" =~ ^[0-9a-fA-F]{64}$ ]]; then
  SETPOINT_SANDBOX_DEPLOYER_KEY="0x${SETPOINT_SANDBOX_DEPLOYER_KEY}"
  export SETPOINT_SANDBOX_DEPLOYER_KEY
fi

rpc_url="${RH_TESTNET_RPC:-https://rpc.testnet.chain.robinhood.com}"

if [[ -z "${SETPOINT_SANDBOX_DEPLOYER_KEY:-}" ]]; then
  echo "Missing SETPOINT_SANDBOX_DEPLOYER_KEY. Broadcast was not attempted." >&2
  echo "Set it locally, then run: pnpm sandbox:deploy" >&2
  exit 1
fi
if [[ ! "${SETPOINT_SANDBOX_DEPLOYER_KEY}" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
  echo "Sandbox deployer key must be a 32-byte hex value; broadcast was not attempted." >&2
  exit 1
fi

for command_name in forge pnpm cast; do
  command -v "${command_name}" >/dev/null 2>&1 || { echo "missing required command: ${command_name}" >&2; exit 1; }
done

chain_id="$(cast chain-id --rpc-url "${rpc_url}")"
if [[ "${chain_id}" != "46630" ]]; then
  echo "Refusing broadcast: expected Robinhood Chain Testnet (46630), received chain ${chain_id}." >&2
  exit 1
fi

deployer_address="$(cast wallet address --private-key "${SETPOINT_SANDBOX_DEPLOYER_KEY}")"
balance_wei="$(cast balance "${deployer_address}" --rpc-url "${rpc_url}")"
gas_price_wei="$(cast gas-price --rpc-url "${rpc_url}")"
gas_budget=13000000
required_wei="$((gas_budget * gas_price_wei))"
if (( balance_wei < required_wei )); then
  echo "Insufficient Robinhood Chain Testnet gas balance; broadcast was not attempted." >&2
  echo "Deployer: ${deployer_address}" >&2
  echo "Balance: $(cast from-wei "${balance_wei}" ether) ETH" >&2
  echo "Minimum at current gas price (${gas_price_wei} wei): $(cast from-wei "${required_wei}" ether) ETH for ${gas_budget} gas" >&2
  exit 1
fi

cd "${project_root}/contracts"
echo "Dry-run simulation and gas estimate on chain 46630…"
RH_TESTNET_RPC="${rpc_url}" forge script script/DeploySandbox.s.sol:DeploySandbox --rpc-url "${rpc_url}"
echo "Broadcasting Setpoint Sandbox to Robinhood Chain Testnet…"
RH_TESTNET_RPC="${rpc_url}" forge script script/DeploySandbox.s.sol:DeploySandbox --rpc-url "${rpc_url}" --broadcast
cd "${project_root}"
pnpm exec tsx scripts/sandbox-record-deployment.ts
pnpm sandbox:smoke
