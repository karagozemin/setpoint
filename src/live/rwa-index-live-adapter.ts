import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  stringToHex,
  type Address,
  type EIP1193Provider,
  type PublicClient,
} from "viem";
import { buildStaticBaseline, classifyRevert } from "../../integrations/rwa-index/src/baseline.js";
import { erc20Abi, oracleAbi, vaultAbi } from "../../integrations/rwa-index/src/abi.js";
import type { PortfolioState as ExternalPortfolioState } from "../../integrations/rwa-index/src/math.js";
import type { SimulationFailureCode, Trade } from "../core/types.js";
import { WAD } from "../core/policy.js";
import { ROBINHOOD_RPC_URL, robinhoodTestnet, rwaIndexLiveConfig } from "./config.js";
import type { ExecutionResult, LiveAnalysisResult, LiveAssetState, LiveVaultState, ProposedAllocation } from "./types.js";

const MANAGER_ROLE = keccak256(stringToHex("MANAGER_ROLE"));
const MAX_SETPOINT_ASSET_WEIGHT = 80n * 10n ** 16n;

export interface LiveReadOptions {
  account?: Address | null;
}

export interface AllocationValidation {
  valid: boolean;
  errors: string[];
}

export class UnsupportedVaultError extends Error {
  constructor(address: string) {
    super(`No live Setpoint adapter is registered for ${address}.`);
    this.name = "UnsupportedVaultError";
  }
}

export class RWAIndexLiveAdapter {
  readonly client: PublicClient;

  constructor(client?: PublicClient) {
    this.client = client ?? createPublicClient({
      chain: robinhoodTestnet,
      transport: http(ROBINHOOD_RPC_URL, { batch: { wait: 12 }, retryCount: 0, timeout: 8_000 }),
    });
  }

  supportsVault(address: string): boolean {
    try {
      return getAddress(address) === getAddress(rwaIndexLiveConfig.vault);
    } catch {
      return false;
    }
  }

  async readVaultState(vaultAddress = rwaIndexLiveConfig.vault, options: LiveReadOptions = {}): Promise<LiveVaultState> {
    if (!this.supportsVault(vaultAddress)) throw new UnsupportedVaultError(vaultAddress);
    const vault = getAddress(vaultAddress);
    // The public Robinhood endpoint rejects explicit block-number eth_call even
    // at its reported head. These latest reads are issued in batched windows;
    // the observed block is retained as provenance, never as an archival claim.
    const [block, chainId, assets, baseAsset, oracle, swapAdapter, cashTarget, paused, driftThreshold, maxTradeFraction, slippageTolerance, maxStaleness, maxRebalanceLoss] = await Promise.all([
      this.client.getBlock({ blockTag: "latest" }),
      this.client.getChainId(),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "assets" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "asset" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "oracle" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "swapAdapter" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "cashTarget" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "paused" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "driftThreshold" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "maxTradeFraction" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "slippageTolerance" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "maxStaleness" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "maxRebalanceLoss" }),
    ]);
    if (!block.hash) throw new Error("The RPC returned a block without a hash.");
    const blockNumber = block.number;
    if (chainId !== rwaIndexLiveConfig.chainId) throw new Error(`RPC chain mismatch: expected ${rwaIndexLiveConfig.chainId}, received ${chainId}.`);
    if (getAddress(baseAsset) !== getAddress(rwaIndexLiveConfig.baseAsset)) throw new Error("The live vault base asset does not match the registered integration.");
    if (getAddress(oracle) !== getAddress(rwaIndexLiveConfig.oracle)) throw new Error("The live vault oracle does not match the registered integration.");
    if (getAddress(swapAdapter) !== getAddress(rwaIndexLiveConfig.swapAdapter)) throw new Error("The live vault swap adapter does not match the registered integration.");

    const [cashBalance, baseSymbol, baseDecimals, assetRows] = await Promise.all([
      this.client.readContract({ address: baseAsset, abi: erc20Abi, functionName: "balanceOf", args: [vault] }),
      this.client.readContract({ address: baseAsset, abi: erc20Abi, functionName: "symbol" }),
      this.client.readContract({ address: baseAsset, abi: erc20Abi, functionName: "decimals" }),
      Promise.all(assets.map(async (address) => {
        const [balance, symbol, decimals, targetWeight, price] = await Promise.all([
          this.client.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [vault] }),
          this.client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
          this.client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
          this.client.readContract({ address: vault, abi: vaultAbi, functionName: "targetWeight", args: [address] }),
          this.client.readContract({ address: oracle, abi: oracleAbi, functionName: "getPrice", args: [address] }),
        ]);
        return { address, balance, symbol, decimals, targetWeight, price };
      })),
    ]);
    if (baseDecimals !== 18 || assetRows.some(({ decimals }) => decimals !== 18)) {
      throw new Error("This adapter only supports the deployed integration's verified 18-decimal assets.");
    }

    const staleAssets = assetRows
      .filter(({ price }) => block.timestamp > price[1] && block.timestamp - price[1] > maxStaleness)
      .map(({ address }) => address);
    let nav: bigint | null = null;
    let drift: bigint | null = null;
    if (staleAssets.length === 0) {
      [nav, drift] = await Promise.all([
        this.client.readContract({ address: vault, abi: vaultAbi, functionName: "totalAssets" }),
        this.client.readContract({ address: vault, abi: vaultAbi, functionName: "totalDrift" }),
      ]);
    }

    const liveAssets: LiveAssetState[] = assetRows.map(({ address, balance, symbol, decimals, targetWeight, price }) => {
      const age = block.timestamp > price[1] ? block.timestamp - price[1] : 0n;
      const stale = age > maxStaleness;
      const value = stale || nav === null ? null : balance * price[0] / WAD;
      return {
        address,
        symbol: rwaIndexLiveConfig.symbols[address] ?? symbol,
        decimals,
        balance,
        priceWad: price[0],
        priceUpdatedAt: price[1],
        priceAge: age,
        priceStatus: stale ? "STALE" : "CURRENT",
        value,
        weight: value === null || nav === null || nav === 0n ? null : value * WAD / nav,
        targetWeight,
      };
    });

    const account = options.account ? getAddress(options.account) : null;
    const [managerRole, agentSession] = account ? await Promise.all([
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "hasRole", args: [MANAGER_ROLE, account] }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "isAgentAuthorized", args: [account] }),
    ]) : [false, false];

    return {
      provenance: "LIVE_RPC",
      integration: "RWA_INDEX",
      network: rwaIndexLiveConfig.network,
      chainId,
      blockNumber,
      blockHash: block.hash,
      blockTimestamp: block.timestamp,
      readAt: Date.now(),
      vault,
      oracle,
      swapAdapter,
      baseAsset,
      baseSymbol,
      cashBalance,
      cashTarget,
      nav,
      drift,
      assets: liveAssets,
      staleAssets,
      guards: { paused, driftThreshold, maxTradeFraction, slippageTolerance, maxStaleness, maxRebalanceLoss },
      configuredManager: rwaIndexLiveConfig.manager,
      authorization: { account, managerRole, agentSession, canExecute: managerRole || agentSession },
    };
  }

  validateAllocation(state: LiveVaultState, allocation: ProposedAllocation): AllocationValidation {
    const errors: string[] = [];
    let sum = allocation.cashWeight;
    if (allocation.cashWeight < 0n || allocation.cashWeight > WAD) errors.push("Cash allocation must be between 0% and 100%.");
    for (const asset of state.assets) {
      const weight = allocation.assetWeights[asset.address.toLowerCase()];
      if (weight === undefined) {
        errors.push(`${asset.symbol} is missing from the allocation.`);
        continue;
      }
      if (weight < 0n) errors.push(`${asset.symbol} cannot have a negative allocation.`);
      if (weight > MAX_SETPOINT_ASSET_WEIGHT) errors.push(`${asset.symbol} exceeds Setpoint's 80% per-asset policy bound.`);
      sum += weight;
    }
    const allowed = new Set(state.assets.map(({ address }) => address.toLowerCase()));
    for (const token of Object.keys(allocation.assetWeights)) {
      if (!allowed.has(token.toLowerCase())) errors.push(`Unsupported asset in allocation: ${token}.`);
    }
    if (sum !== WAD) errors.push(`Total allocation must equal 100%; received ${formatPercent(sum)}.`);
    return { valid: errors.length === 0, errors };
  }

  async analyzeRebalance(allocation: ProposedAllocation, options: LiveReadOptions = {}): Promise<LiveAnalysisResult> {
    const state = await this.readVaultState(rwaIndexLiveConfig.vault, options);
    const validation = this.validateAllocation(state, allocation);
    if (!validation.valid) return noTrade(state, "INVALID_POLICY", validation.errors, []);
    if (state.guards.paused) return noTrade(state, "VAULT_PAUSED", ["The vault pause guard is active."], []);
    if (state.staleAssets.length > 0) {
      return noTrade(state, "STALE_PRICE", state.assets.filter(({ priceStatus }) => priceStatus === "STALE").map(({ symbol, priceAge }) => `${symbol} price is ${formatDuration(priceAge)} old; the vault maximum is ${formatDuration(state.guards.maxStaleness)}.`), []);
    }
    if (state.nav === null || state.drift === null || state.nav <= 0n) return noTrade(state, "INVALID_NAV", ["The authoritative vault NAV is unavailable."], []);

    const externalState: ExternalPortfolioState = {
      blockNumber: state.blockNumber,
      nav: state.nav,
      drift: state.drift,
      cash: state.cashBalance,
      cashTarget: allocation.cashWeight,
      assets: state.assets.map((asset) => ({
        address: asset.address,
        symbol: asset.symbol,
        balance: asset.balance,
        price: asset.priceWad,
        updatedAt: asset.priceUpdatedAt,
        value: asset.value ?? 0n,
        weight: asset.weight ?? 0n,
        targetWeight: allocation.assetWeights[asset.address.toLowerCase()] ?? 0n,
      })),
    };
    const trades = buildStaticBaseline(externalState, state.baseAsset, {
      maxTradeFraction: state.guards.maxTradeFraction,
      slippageTolerance: state.guards.slippageTolerance,
    }) as Trade[];
    if (trades.length === 0) return noTrade(state, "TARGET_REGION_REACHED", ["The proposed allocation produces no non-zero rebalance legs."], []);

    const calldata = encodeFunctionData({ abi: vaultAbi, functionName: "rebalance", args: [trades] });
    try {
      await this.client.simulateContract({
        account: state.configuredManager,
        address: state.vault,
        abi: vaultAbi,
        functionName: "rebalance",
        args: [trades],
      });
      return {
        mode: "FAST_PATH",
        title: "REBALANCE READY",
        summary: "Full rebalance passed the external vault's exact execution simulation.",
        reason: "FAST_PATH_EXACT_SIMULATION_PASSED",
        details: ["The simple coherent batch passed policy validation and eth_call at the displayed block."],
        state,
        trades,
        simulation: { attempted: true, passed: true, caller: state.configuredManager },
        calldata,
        canExecute: state.authorization.canExecute,
        adaptiveFallbackAvailable: false,
      };
    } catch (error) {
      const parsed = parseSimulationFailure(error);
      return {
        ...noTrade(state, "SIMULATION_REJECTED", [parsed.reason, "The deployed adapter exposes no safe public quote interface, so live adaptive sizing is unavailable. No historical liquidity curve was substituted."], trades),
        simulation: { attempted: true, passed: false, caller: state.configuredManager, failureCode: parsed.code, reason: parsed.reason },
        calldata,
      };
    }
  }

  async execute(result: LiveAnalysisResult, provider: EIP1193Provider, account: Address): Promise<ExecutionResult> {
    if (result.mode !== "FAST_PATH" || !result.simulation.passed || !result.calldata) throw new Error("Only a current, simulation-approved FAST_PATH plan can execute.");
    const before = await this.readVaultState(result.state.vault, { account });
    if (!before.authorization.canExecute) throw new Error("The connected wallet is not authorized by the external vault.");
    await this.client.simulateContract({ account, address: before.vault, abi: vaultAbi, functionName: "rebalance", args: [result.trades] });
    const wallet = createWalletClient({ account, chain: robinhoodTestnet, transport: custom(provider) });
    const hash = await wallet.writeContract({ account, address: before.vault, abi: vaultAbi, functionName: "rebalance", args: [result.trades], chain: robinhoodTestnet });
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    const after = await this.readVaultState(before.vault, { account });
    return { hash, blockNumber: receipt.blockNumber, before, after };
  }
}

function noTrade(state: LiveVaultState, reason: string, details: string[], trades: Trade[]): LiveAnalysisResult {
  return {
    mode: "NO_TRADE",
    title: "EXECUTION REFUSED",
    summary: reason === "STALE_PRICE" ? "Execution refused because authoritative accounting prices are stale." : "Setpoint could not prove this rebalance safe to execute.",
    reason,
    details,
    state,
    trades,
    simulation: { attempted: false, passed: false, caller: state.configuredManager },
    calldata: trades.length > 0 ? encodeFunctionData({ abi: vaultAbi, functionName: "rebalance", args: [trades] }) : null,
    canExecute: false,
    adaptiveFallbackAvailable: false,
  };
}

function parseSimulationFailure(error: unknown): { code: SimulationFailureCode; reason: string } {
  let reason = error instanceof Error ? error.message : "Unknown eth_call failure";
  if (error instanceof BaseError) {
    const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) reason = reverted.data?.errorName ?? reverted.shortMessage;
    else reason = error.shortMessage;
  }
  const classified = classifyRevert(reason);
  const map: Record<typeof classified, SimulationFailureCode> = {
    STALE_ORACLE: "STALE_PRICE",
    TRADE_TOO_LARGE: "TRADE_TOO_LARGE",
    SLIPPAGE_TOO_LOOSE: "SLIPPAGE_TOO_LOOSE",
    INSUFFICIENT_OUTPUT: "INSUFFICIENT_OUTPUT",
    INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
    DRIFT_NOT_IMPROVED: "DRIFT_NOT_IMPROVED",
    EXCESSIVE_VALUE_LOSS: "EXCESSIVE_VALUE_LOSS",
    UNAUTHORIZED: "UNAUTHORIZED",
    INVALID_ASSET: "UNSUPPORTED_ASSET",
    UNKNOWN_REVERT: "UNKNOWN_REVERT",
  };
  return { code: map[classified], reason };
}

function formatDuration(seconds: bigint): string {
  if (seconds >= 86_400n) return `${seconds / 86_400n}d`;
  if (seconds >= 3_600n) return `${seconds / 3_600n}h`;
  return `${seconds}s`;
}

function formatPercent(wad: bigint): string {
  return `${Number(wad) / 1e16}%`;
}
