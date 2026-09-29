import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  getAddress,
  http,
  parseAbiItem,
  zeroAddress,
  type Address,
  type EIP1193Provider,
  type PublicClient,
} from "viem";
import { buildStaticBaseline, classifyRevert } from "../../integrations/rwa-index/src/baseline.js";
import { solveHybrid, type HybridSolveInput } from "../core/hybrid-solver.js";
import type { LiquidityCurve, LiquiditySample, LiquiditySnapshot } from "../core/liquidity.js";
import { WAD } from "../core/policy.js";
import type { SimulationAdapter, SimulationFailureCode, Trade } from "../core/types.js";
import { ROBINHOOD_RPC_URL, robinhoodTestnet } from "../live/config.js";
import { sandboxAdapterAbi, sandboxFactoryAbi, sandboxOracleAbi, sandboxPoolAbi, sandboxTokenAbi, sandboxVaultAbi } from "./abi.js";
import { sandboxDeployment, sandboxSymbols } from "./config.js";
import type { SandboxActivity, SandboxAnalysis, SandboxAssetState, SandboxExecution, SandboxVaultState } from "./types.js";

const SAMPLE_FRACTIONS = [10n, 25n, 50n, 75n, 100n] as const;

export class SandboxNotDeployedError extends Error {
  constructor() { super("Setpoint Sandbox is not deployed on Robinhood Chain Testnet yet."); }
}

export class SetpointSandboxLiveAdapter {
  readonly client: PublicClient;

  constructor(client?: PublicClient) {
    this.client = client ?? createPublicClient({
      chain: robinhoodTestnet,
      transport: http(ROBINHOOD_RPC_URL, { batch: { wait: 12 }, retryCount: 1, timeout: 10_000 }),
    });
  }

  deployed(): boolean { return sandboxDeployment.status === "DEPLOYED" && sandboxDeployment.factory !== null; }

  async vaultFor(owner: Address): Promise<Address | null> {
    const factory = this.factory();
    const read = this.client.readContract;
    const vault = await read({ address: factory, abi: sandboxFactoryAbi, functionName: "getVault", args: [owner] });
    return vault === zeroAddress ? null : getAddress(vault);
  }

  async createVault(
    provider: EIP1193Provider,
    owner: Address,
    onSubmitted?: (hash: `0x${string}`) => void,
  ): Promise<{ hash: `0x${string}`; vault: Address }> {
    const factory = this.factory();
    const wallet = createWalletClient({ account: owner, chain: robinhoodTestnet, transport: custom(provider) });
    await this.client.simulateContract({ account: owner, address: factory, abi: sandboxFactoryAbi, functionName: "createVault" });
    const hash = await wallet.writeContract({ account: owner, address: factory, abi: sandboxFactoryAbi, functionName: "createVault", chain: robinhoodTestnet });
    onSubmitted?.(hash);
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Vault creation transaction reverted.");
    const vault = await this.vaultFor(owner);
    if (!vault) throw new Error("Factory transaction confirmed but no wallet vault was registered.");
    return { hash, vault };
  }

  async readState(owner: Address, explicitVault?: Address): Promise<SandboxVaultState> {
    const factory = this.factory();
    const vault = explicitVault ?? await this.vaultFor(owner);
    if (!vault) throw new Error("This wallet has not created a Setpoint Sandbox vault.");
    const block = await this.client.getBlock({ blockTag: "latest" });
    if (!block.hash) throw new Error("RPC returned a block without a hash.");
    const read = this.client.readContract;
    const [chainId, vaultOwner, baseAsset, oracle, swapAdapter, assets, cashTarget, driftThreshold, maxTradeFraction, slippageTolerance, maxPriceAge, maxRebalanceLoss] = await Promise.all([
      this.client.getChainId(),
      read({ address: vault, abi: sandboxVaultAbi, functionName: "owner", blockHash: block.hash }),
      read({ address: vault, abi: sandboxVaultAbi, functionName: "baseAsset", blockHash: block.hash }),
      read({ address: vault, abi: sandboxVaultAbi, functionName: "oracle", blockHash: block.hash }),
      read({ address: vault, abi: sandboxVaultAbi, functionName: "swapAdapter", blockHash: block.hash }),
      read({ address: vault, abi: sandboxVaultAbi, functionName: "assets", blockHash: block.hash }),
      read({ address: vault, abi: sandboxVaultAbi, functionName: "cashTarget", blockHash: block.hash }),
      read({ address: vault, abi: sandboxVaultAbi, functionName: "driftThreshold", blockHash: block.hash }),
      read({ address: vault, abi: sandboxVaultAbi, functionName: "maxTradeFraction", blockHash: block.hash }),
      read({ address: vault, abi: sandboxVaultAbi, functionName: "slippageTolerance", blockHash: block.hash }),
      read({ address: vault, abi: sandboxVaultAbi, functionName: "maxPriceAge", blockHash: block.hash }),
      read({ address: vault, abi: sandboxVaultAbi, functionName: "maxRebalanceLoss", blockHash: block.hash }),
    ]);
    if (chainId !== sandboxDeployment.chainId) throw new Error(`RPC chain mismatch: expected ${sandboxDeployment.chainId}, received ${chainId}.`);
    if (getAddress(vaultOwner) !== getAddress(owner)) throw new Error("Connected wallet does not own this sandbox vault.");
    if (sandboxDeployment.oracle && getAddress(oracle) !== sandboxDeployment.oracle) throw new Error("Vault oracle does not match the deployment record.");
    if (sandboxDeployment.swapAdapter && getAddress(swapAdapter) !== sandboxDeployment.swapAdapter) throw new Error("Vault adapter does not match the deployment record.");

    const [baseBalance, oracleUpdater] = await Promise.all([
      read({ address: baseAsset, abi: sandboxTokenAbi, functionName: "balanceOf", args: [vault], blockHash: block.hash }),
      read({ address: oracle, abi: sandboxOracleAbi, functionName: "updater", blockHash: block.hash }),
    ]);
    const rawRows = await Promise.all(assets.map(async (asset, index): Promise<SandboxAssetState> => {
      const [balance, symbol, targetWeight, price, pool] = await Promise.all([
        read({ address: asset, abi: sandboxTokenAbi, functionName: "balanceOf", args: [vault], blockHash: block.hash }),
        read({ address: asset, abi: sandboxTokenAbi, functionName: "symbol", blockHash: block.hash }),
        read({ address: vault, abi: sandboxVaultAbi, functionName: "targetWeight", args: [asset], blockHash: block.hash }),
        read({ address: oracle, abi: sandboxOracleAbi, functionName: "getPrice", args: [asset], blockHash: block.hash }),
        read({ address: swapAdapter, abi: sandboxAdapterAbi, functionName: "poolFor", args: [asset], blockHash: block.hash }),
      ]);
      const [token0, reserves, feeBps] = await Promise.all([
        read({ address: pool, abi: sandboxPoolAbi, functionName: "token0", blockHash: block.hash }),
        read({ address: pool, abi: sandboxPoolAbi, functionName: "reserves", blockHash: block.hash }),
        read({ address: pool, abi: sandboxPoolAbi, functionName: "feeBps", blockHash: block.hash }),
      ]);
      const value = balance * price[0] / WAD;
      const age = block.timestamp > price[1] ? block.timestamp - price[1] : 0n;
      const baseIs0 = getAddress(token0) === getAddress(baseAsset);
      return {
        address: getAddress(asset), pool: getAddress(pool), symbol: sandboxSymbols[index] ?? symbol,
        balance, value, weight: 0n, targetWeight,
        priceWad: price[0], updatedAt: price[1], priceAge: age,
        reserveBase: baseIs0 ? reserves[0] : reserves[1], reserveAsset: baseIs0 ? reserves[1] : reserves[0], feeBps,
      };
    }));
    // Read accounting from raw balances and timestamped oracle observations so a
    // stale feed remains diagnosable. The vault intentionally reverts its own
    // totalAssets()/totalDrift() views when a price is stale.
    const nav = rawRows.reduce((total, row) => total + row.value, baseBalance);
    const rows = rawRows.map((row) => ({ ...row, weight: nav === 0n ? 0n : row.value * WAD / nav }));
    const baseWeight = nav === 0n ? 0n : baseBalance * WAD / nav;
    const absoluteDifference = (left: bigint, right: bigint) => left > right ? left - right : right - left;
    const drift = nav === 0n ? 0n : rows.reduce(
      (total, row) => total + absoluteDifference(row.weight, row.targetWeight),
      absoluteDifference(baseWeight, cashTarget),
    ) / 2n;
    const stateId = [
      "sandbox-v1", chainId, vault, baseBalance, cashTarget, nav, drift,
      ...rows.flatMap((row) => [row.address, row.balance, row.targetWeight, row.priceWad, row.updatedAt, row.reserveBase, row.reserveAsset]),
    ].map(String).join(":");
    const portfolio = {
      stateId, blockNumber: block.number, blockTimestamp: block.timestamp, nav,
      baseAssetBalance: baseBalance, baseAssetWeight: nav === 0n ? 0n : baseBalance * WAD / nav, drift,
      positions: rows.map((row) => ({ token: row.address, balance: row.balance, value: row.value, weight: row.weight })),
    };
    const band = 5n * 10n ** 15n;
    const range = (target: bigint) => ({ min: target > band ? target - band : 0n, max: target + band < WAD ? target + band : WAD });
    const prices = rows.map((row) => ({ token: row.address, priceWad: row.priceWad, updatedAt: row.updatedAt, source: `SetpointSandboxOracle:${oracle}` }));
    const policy = {
      baseAsset: getAddress(baseAsset),
      assets: rows.map((row) => ({ token: row.address, target: range(row.targetWeight), maxWeight: 70n * 10n ** 16n, enabled: true })),
      cashTarget: range(cashTarget), driftTrigger: driftThreshold, maxLegValue: nav * maxTradeFraction / WAD,
      maxNavLoss: maxRebalanceLoss, slippageTolerance, maxPriceAge, maxTurnover: 60n * 10n ** 16n,
      minimumExpectedImprovement: 1n * 10n ** 15n, minimumCashBuffer: nav / 100n, paused: false,
    };
    return {
      provenance: "LIVE_RPC", chainId, blockNumber: block.number, blockHash: block.hash,
      blockTimestamp: block.timestamp, stateId, readAt: Date.now(), owner: getAddress(vaultOwner), vault,
      factory, baseAsset: getAddress(baseAsset), oracle: getAddress(oracle), oracleUpdater: getAddress(oracleUpdater), swapAdapter: getAddress(swapAdapter),
      baseBalance, baseWeight: portfolio.baseAssetWeight, nav, drift, cashTarget, assets: rows, prices, policy, portfolio,
      oracleFresh: rows.every((row) => row.priceAge <= maxPriceAge),
    };
  }

  async refreshOracle(
    provider: EIP1193Provider,
    owner: Address,
    state: SandboxVaultState,
    onSubmitted?: (hash: `0x${string}`) => void,
  ): Promise<`0x${string}`> {
    if (getAddress(state.owner) !== getAddress(owner)) throw new Error("Connected wallet does not own this sandbox vault.");
    const tokens = [state.baseAsset, ...state.assets.map(({ address }) => address)];
    const wallet = createWalletClient({ account: owner, chain: robinhoodTestnet, transport: custom(provider) });
    await this.client.simulateContract({ account: owner, address: state.oracle, abi: sandboxOracleAbi, functionName: "refreshPrices", args: [tokens] });
    const hash = await wallet.writeContract({ account: owner, address: state.oracle, abi: sandboxOracleAbi, functionName: "refreshPrices", args: [tokens], chain: robinhoodTestnet });
    onSubmitted?.(hash);
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Oracle heartbeat transaction reverted.");
    return hash;
  }

  async setTargets(
    provider: EIP1193Provider,
    owner: Address,
    weights: bigint[],
    cashTarget: bigint,
    onSubmitted?: (hash: `0x${string}`) => void,
  ): Promise<`0x${string}`> {
    const vault = await this.requireVault(owner);
    const wallet = createWalletClient({ account: owner, chain: robinhoodTestnet, transport: custom(provider) });
    await this.client.simulateContract({ account: owner, address: vault, abi: sandboxVaultAbi, functionName: "setTargets", args: [weights, cashTarget] });
    const hash = await wallet.writeContract({ account: owner, address: vault, abi: sandboxVaultAbi, functionName: "setTargets", args: [weights, cashTarget], chain: robinhoodTestnet });
    onSubmitted?.(hash);
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Target update transaction reverted.");
    return hash;
  }

  async recentActivity(owner: Address, vault: Address): Promise<SandboxActivity[]> {
    const fromBlock = sandboxDeployment.deploymentBlock ?? 0n;
    const [created, targets, rebalances] = await Promise.all([
      this.client.getLogs({ address: this.factory(), event: parseAbiItem("event VaultCreated(address indexed owner, address indexed vault, uint256 initialNav)"), args: { owner }, fromBlock, toBlock: "latest" }),
      this.client.getLogs({ address: vault, event: parseAbiItem("event TargetsUpdated(address indexed owner, uint256 cashTarget, address[] assets, uint256[] weights)"), args: { owner }, fromBlock, toBlock: "latest" }),
      this.client.getLogs({ address: vault, event: parseAbiItem("event Rebalanced(address indexed owner, uint256 driftBefore, uint256 driftAfter, uint256 navBefore, uint256 navAfter, uint256 legs)"), args: { owner }, fromBlock, toBlock: "latest" }),
    ]);
    return [
      ...created.map((log) => ({ kind: "CREATED" as const, transactionHash: log.transactionHash, blockNumber: log.blockNumber })),
      ...targets.map((log) => ({ kind: "TARGETS_UPDATED" as const, transactionHash: log.transactionHash, blockNumber: log.blockNumber })),
      ...rebalances.map((log) => ({ kind: "REBALANCED" as const, transactionHash: log.transactionHash, blockNumber: log.blockNumber })),
    ].sort((a, b) => a.blockNumber > b.blockNumber ? -1 : a.blockNumber < b.blockNumber ? 1 : 0).slice(0, 12);
  }

  async analyze(owner: Address): Promise<SandboxAnalysis> {
    const state = await this.readState(owner);
    const fastPathTrades = buildStaticBaseline({
      blockNumber: state.blockNumber, nav: state.nav, drift: state.drift, cash: state.baseBalance, cashTarget: state.cashTarget,
      assets: state.assets.map((asset) => ({ address: asset.address, symbol: asset.symbol, balance: asset.balance, price: asset.priceWad, updatedAt: asset.updatedAt, value: asset.value, weight: asset.weight, targetWeight: asset.targetWeight })),
    }, state.baseAsset, { maxTradeFraction: state.policy.maxLegValue * WAD / state.nav, slippageTolerance: state.policy.slippageTolerance }) as Trade[];
    const liquidity = await this.sampleLiquidity(state, fastPathTrades);
    const input: HybridSolveInput = { vault: state.vault, state: state.portfolio, policy: state.policy, prices: state.prices, liquidity, adaptivePolicy: { maxQuoteAge: 60n, maxSimulationAttempts: 5, maxPriceImpact: state.policy.slippageTolerance }, fastPathTrades };
    const simulator = this.simulator(state, owner);
    const result = await solveHybrid(input, simulator);
    const trades = result.kind === "plan" ? result.trades : [];
    return { mode: result.mode, result, state, liquidity, trades, simulationPassed: result.kind === "plan" && result.simulation.passed, calldata: trades.length ? encodeFunctionData({ abi: sandboxVaultAbi, functionName: "rebalance", args: [trades] }) : null };
  }

  async execute(
    analysis: SandboxAnalysis,
    provider: EIP1193Provider,
    owner: Address,
    onSubmitted?: (hash: `0x${string}`) => void,
  ): Promise<SandboxExecution> {
    if (analysis.result.kind !== "plan" || !analysis.simulationPassed || analysis.trades.length === 0) throw new Error("Only a current simulation-approved plan can execute.");
    const before = await this.readState(owner);
    if (before.stateId !== analysis.state.stateId) throw new Error("Chain state changed after analysis. Analyze again.");
    const simulation = await this.simulator(before, owner).simulate(analysis.trades, before.portfolio);
    if (!simulation.passed) throw new Error(simulation.reason ?? "Final exact simulation rejected the plan.");
    const wallet = createWalletClient({ account: owner, chain: robinhoodTestnet, transport: custom(provider) });
    const hash = await wallet.writeContract({ account: owner, address: before.vault, abi: sandboxVaultAbi, functionName: "rebalance", args: [analysis.trades], chain: robinhoodTestnet });
    onSubmitted?.(hash);
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Rebalance transaction reverted.");
    const after = await this.readState(owner);
    return { hash, blockNumber: receipt.blockNumber, before, after };
  }

  private async sampleLiquidity(state: SandboxVaultState, fastPath: Trade[]): Promise<LiquiditySnapshot> {
    const read = this.client.readContract;
    const curves: LiquidityCurve[] = [];
    for (const asset of state.assets) {
      for (const [tokenIn, tokenOut] of [[state.baseAsset, asset.address], [asset.address, state.baseAsset]] as const) {
        const fastAmounts = fastPath.filter((trade) => trade.tokenIn.toLowerCase() === tokenIn.toLowerCase() && trade.tokenOut.toLowerCase() === tokenOut.toLowerCase()).map(({ amountIn }) => amountIn);
        const desiredValue = state.nav * 30n / 100n;
        const desiredAmount = tokenIn === state.baseAsset ? desiredValue : desiredValue * WAD / asset.priceWad;
        const amounts = [...new Set([...SAMPLE_FRACTIONS.map((fraction) => desiredAmount * fraction / 100n), ...fastAmounts].filter((value) => value > 0n).map(String))].map(BigInt).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
        const samples: LiquiditySample[] = [];
        for (const [index, amountIn] of amounts.entries()) {
          const expectedOut = await read({ address: state.swapAdapter, abi: sandboxAdapterAbi, functionName: "quote", args: [tokenIn, tokenOut, amountIn], blockHash: state.blockHash });
          const oracleOut = tokenIn === state.baseAsset ? amountIn * WAD / asset.priceWad : amountIn * asset.priceWad / WAD;
          const inputValue = tokenIn === state.baseAsset ? amountIn : amountIn * asset.priceWad / WAD;
          const outputValue = tokenOut === state.baseAsset ? expectedOut : expectedOut * asset.priceWad / WAD;
          const loss = inputValue > outputValue ? inputValue - outputValue : 0n;
          samples.push({
            sampleIndex: index, amountIn, expectedOut, oracleOut, inputValue, outputValue,
            effectiveValueRateWad: inputValue === 0n ? 0n : outputValue * WAD / inputValue,
            priceImpactWad: oracleOut === 0n || expectedOut >= oracleOut ? 0n : (oracleOut - expectedOut) * WAD / oracleOut,
            feeRateWad: BigInt(asset.feeBps) * 10n ** 14n, estimatedFeeValue: inputValue * BigInt(asset.feeBps) / 10_000n,
            quoteLossValue: loss, minOutCompatible: expectedOut >= oracleOut * (WAD - state.policy.slippageTolerance) / WAD,
            validity: { valid: true, stateId: state.stateId, blockNumber: state.blockNumber, observedAt: state.blockTimestamp, expiresAt: state.blockTimestamp + 60n },
          });
        }
        const compatible = samples.filter(({ minOutCompatible }) => minOutCompatible);
        curves.push({ id: `${asset.symbol}:${tokenIn === state.baseAsset ? "BUY" : "SELL"}`, venue: "Setpoint Sandbox CPMM", pool: asset.pool, tokenIn, tokenOut, fee: asset.feeBps, stateId: state.stateId, blockNumber: state.blockNumber, observedAt: state.blockTimestamp, maximumTestedAmountIn: samples.at(-1)?.amountIn ?? 0n, maximumExecutableAmountIn: compatible.at(-1)?.amountIn ?? 0n, samples });
      }
    }
    return { stateId: state.stateId, blockNumber: state.blockNumber, observedAt: state.blockTimestamp, curves };
  }

  private simulator(state: SandboxVaultState, owner: Address): SimulationAdapter {
    return { simulate: async (trades) => {
      try {
        await this.client.simulateContract({ account: owner, address: state.vault, abi: sandboxVaultAbi, functionName: "rebalance", args: [[...trades]] });
        return { passed: true };
      } catch (error) {
        const parsed = simulationFailure(error);
        return { passed: false, failureCode: parsed.code, reason: parsed.reason };
      }
    } };
  }

  private async requireVault(owner: Address): Promise<Address> {
    const vault = await this.vaultFor(owner);
    if (!vault) throw new Error("This wallet has not created a Setpoint Sandbox vault.");
    return vault;
  }

  private factory(): Address {
    if (!sandboxDeployment.factory) throw new SandboxNotDeployedError();
    return sandboxDeployment.factory;
  }
}

function simulationFailure(error: unknown): { code: SimulationFailureCode; reason: string } {
  let reason = error instanceof Error ? error.message : "Unknown eth_call failure";
  if (error instanceof BaseError) {
    const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
    reason = reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName ?? reverted.shortMessage : error.shortMessage;
  }
  const classified = classifyRevert(reason);
  const codes: Record<typeof classified, SimulationFailureCode> = {
    STALE_ORACLE: "STALE_PRICE", TRADE_TOO_LARGE: "TRADE_TOO_LARGE", SLIPPAGE_TOO_LOOSE: "SLIPPAGE_TOO_LOOSE",
    INSUFFICIENT_OUTPUT: "INSUFFICIENT_OUTPUT", INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE", DRIFT_NOT_IMPROVED: "DRIFT_NOT_IMPROVED",
    EXCESSIVE_VALUE_LOSS: "EXCESSIVE_VALUE_LOSS", UNAUTHORIZED: "UNAUTHORIZED", INVALID_ASSET: "UNSUPPORTED_ASSET", UNKNOWN_REVERT: "UNKNOWN_REVERT",
  };
  return { code: codes[classified], reason };
}
