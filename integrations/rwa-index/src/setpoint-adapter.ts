import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hash,
  type Hex
} from "viem";
import type {
  AssetPolicy,
  PricePoint,
  SimulationAdapter,
  SimulationFailureCode,
  SimulationResult,
  SolveInput,
  TargetRange,
  TokenAddress,
  Trade as SetpointTrade,
  VaultPolicy
} from "../../../src/core/types.js";
import { WAD } from "../../../src/core/policy.js";
import { classifyRevert, type RevertClass } from "./baseline.js";
import {
  erc20Abi,
  factoryAbi,
  oracleAbi,
  poolAbi,
  swapAdapterAbi,
  syncerAbi,
  vaultAbi
} from "./abi.js";
import { loadConfig } from "./config.js";
import { readPortfolio } from "./state.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

export interface RwaDeployment {
  assets: readonly Address[];
  baseAsset: Address;
  oracle: Address;
  adapter: Address;
  factory: Address;
  fee: number;
}

export interface RwaGuardState {
  driftThreshold: bigint;
  maxTradeFraction: bigint;
  slippageTolerance: bigint;
  maxStaleness: bigint;
  maxRebalanceLoss: bigint;
  paused: boolean;
}

export interface RawOraclePoint {
  token: Address;
  priceWad: bigint;
  updatedAt: bigint;
}

export interface PreparedPool {
  token: Address;
  pool: Address;
  activeLiquidity: bigint;
  stockInventory: bigint;
  baseInventory: bigint;
  stockInventoryOracleValue: bigint;
  targetErrorBps: bigint;
}

export interface ExecutableSwapProbe {
  amountIn: bigint;
  expectedOut?: bigint;
  failureReason?: string;
}

export class RwaIndexSetpointAdapter implements SimulationAdapter {
  readonly config = loadConfig();
  readonly rpcUrl: string;
  readonly chain;
  readonly client;
  readonly testClient;
  private deployment?: RwaDeployment;
  private guards?: RwaGuardState;

  constructor(rpcUrl = process.env.RWA_FORK_RPC_URL ?? "http://127.0.0.1:8545") {
    this.rpcUrl = rpcUrl;
    this.chain = defineChain({
      id: this.config.chainId,
      name: this.config.network,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } }
    });
    const transport = http(rpcUrl);
    this.client = createPublicClient({ chain: this.chain, transport });
    this.testClient = createTestClient({ chain: this.chain, mode: "anvil", transport });
  }

  async validate(): Promise<{ deployment: RwaDeployment; guards: RwaGuardState }> {
    const { vault, oracle, manager, poolSyncer, syncerOwner } = this.config.contracts;
    assert(await this.client.getChainId() === this.config.chainId, `expected chain ${this.config.chainId}`);
    await Promise.all([this.requireCode("vault", vault), this.requireCode("oracle", oracle), this.requireCode("pool syncer", poolSyncer)]);
    const [assets, baseAsset, actualOracle, adapter, syncerContractOwner, guards] = await Promise.all([
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "assets" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "asset" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "oracle" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "swapAdapter" }),
      this.client.readContract({ address: poolSyncer, abi: syncerAbi, functionName: "owner" }),
      this.readGuards()
    ]);
    assert(actualOracle.toLowerCase() === oracle.toLowerCase(), "vault oracle differs from configuration");
    assert(syncerContractOwner.toLowerCase() === syncerOwner.toLowerCase(), "syncer owner differs from configuration");
    assert(!guards.paused, "vault is paused");
    await Promise.all([this.requireCode("base asset", baseAsset), this.requireCode("swap adapter", adapter)]);
    assert(await this.client.readContract({ address: baseAsset, abi: erc20Abi, functionName: "decimals" }) === 18, "base asset must use 18 decimals");
    for (const asset of assets) {
      await this.requireCode("basket asset", asset);
      assert(await this.client.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }) === 18, `${asset} must use 18 decimals`);
    }
    const [feederRole, managerAuthorized] = await Promise.all([
      this.client.readContract({ address: oracle, abi: oracleAbi, functionName: "PRICE_FEEDER_ROLE" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "hasRole", args: [keccak256(toBytes("MANAGER_ROLE")), manager] })
    ]);
    assert(await this.client.readContract({ address: oracle, abi: oracleAbi, functionName: "hasRole", args: [feederRole, syncerOwner] }), "syncer owner lacks PRICE_FEEDER_ROLE");
    assert(managerAuthorized, "configured manager lacks MANAGER_ROLE");
    const [factory, fee] = await Promise.all([
      this.client.readContract({ address: adapter, abi: swapAdapterAbi, functionName: "factory" }),
      this.client.readContract({ address: adapter, abi: swapAdapterAbi, functionName: "defaultFee" })
    ]);
    await this.requireCode("Synthra factory", factory);
    this.deployment = { assets, baseAsset, oracle, adapter, factory, fee };
    this.guards = guards;
    return { deployment: this.deployment, guards };
  }

  async sourceBlock() {
    return this.client.getBlock();
  }

  async snapshot(): Promise<Hex> {
    return this.testClient.snapshot();
  }

  async revert(id: Hex): Promise<void> {
    await this.testClient.revert({ id });
  }

  async rawOraclePrices(): Promise<RawOraclePoint[]> {
    const { assets, oracle } = this.requireDeployment();
    return Promise.all(assets.map(async (token) => {
      const [priceWad, updatedAt] = await this.client.readContract({ address: oracle, abi: oracleAbi, functionName: "getPrice", args: [token] });
      return { token, priceWad, updatedAt };
    }));
  }

  async prepareOracleAndPools(): Promise<PreparedPool[]> {
    const deployment = this.requireDeployment();
    const { oracle, poolSyncer, syncerOwner } = this.config.contracts;
    const prices = await this.rawOraclePrices();
    assert(prices.every(({ priceWad }) => priceWad > 0n), "cannot refresh a zero oracle value");
    const operator = await this.prepareAccount(syncerOwner);
    const refresh = await this.client.simulateContract({
      account: syncerOwner,
      address: oracle,
      abi: oracleAbi,
      functionName: "setPrices",
      args: [deployment.assets, prices.map(({ priceWad }) => priceWad)]
    });
    await this.wait(await operator.writeContract(refresh.request));

    const result: PreparedPool[] = [];
    for (const price of prices) {
      const pool = await this.client.readContract({
        address: deployment.factory,
        abi: factoryAbi,
        functionName: "getPool",
        args: [price.token, deployment.baseAsset, deployment.fee]
      });
      assert(pool !== ZERO_ADDRESS, `missing pool for ${price.token}`);
      const target = await this.client.readContract({
        address: poolSyncer,
        abi: syncerAbi,
        functionName: "previewTargetSqrt",
        args: [price.token, deployment.baseAsset, price.priceWad]
      });
      const sync = await this.client.simulateContract({
        account: syncerOwner,
        address: poolSyncer,
        abi: syncerAbi,
        functionName: "syncToPrice",
        args: [pool, price.token, deployment.baseAsset, price.priceWad]
      });
      await this.wait(await operator.writeContract(sync.request));
      const [slot0, activeLiquidity, stockInventory, baseInventory] = await Promise.all([
        this.client.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }),
        this.client.readContract({ address: pool, abi: poolAbi, functionName: "liquidity" }),
        this.client.readContract({ address: price.token, abi: erc20Abi, functionName: "balanceOf", args: [pool] }),
        this.client.readContract({ address: deployment.baseAsset, abi: erc20Abi, functionName: "balanceOf", args: [pool] })
      ]);
      const targetErrorBps = absDiff(slot0[0], target) * 10_000n / target;
      assert(activeLiquidity > 0n, `pool ${pool} has no active liquidity`);
      assert(targetErrorBps <= 50n, `pool ${pool} remains outside sync tolerance`);
      result.push({
        token: price.token,
        pool,
        activeLiquidity,
        stockInventory,
        baseInventory,
        stockInventoryOracleValue: stockInventory * price.priceWad / WAD,
        targetErrorBps
      });
    }
    return result;
  }

  async setStrategy(weights: readonly bigint[], cashTarget: bigint): Promise<Hash> {
    const deployment = this.requireDeployment();
    assert(weights.length === deployment.assets.length, "weights do not match basket length");
    assert(weights.reduce((sum, weight) => sum + weight, cashTarget) === WAD, "weights plus cash target must equal WAD");
    const { manager, vault } = this.config.contracts;
    const wallet = await this.prepareAccount(manager);
    const simulation = await this.client.simulateContract({
      account: manager,
      address: vault,
      abi: vaultAbi,
      functionName: "setStrategy",
      args: [[...deployment.assets], [...weights], cashTarget]
    });
    const hash = await wallet.writeContract(simulation.request);
    await this.wait(hash);
    return hash;
  }

  async readSolveInput(rangeTolerance = 25n * 10n ** 14n): Promise<SolveInput> {
    const deployment = this.requireDeployment();
    const guards = this.requireGuards();
    const external = await readPortfolio(
      this.client,
      this.config.contracts.vault,
      deployment.oracle,
      deployment.baseAsset,
      deployment.assets,
      this.config.symbols
    );
    // Anvil may reuse local block numbers after evm_revert. Reading `latest` avoids
    // asking its fork cache for an invalidated explicit block while preserving the
    // authoritative block hash/timestamp for this single-process harness.
    const block = await this.client.getBlock();
    const prices: PricePoint[] = external.assets.map((asset) => ({
      token: asset.address as TokenAddress,
      priceWad: asset.price,
      updatedAt: asset.updatedAt,
      source: `RWA Index AgentOracle ${deployment.oracle}`
    }));
    const assets: AssetPolicy[] = external.assets.map((asset) => ({
      token: asset.address as TokenAddress,
      target: around(asset.targetWeight, rangeTolerance),
      maxWeight: WAD,
      enabled: true
    }));
    const policy: VaultPolicy = {
      baseAsset: deployment.baseAsset as TokenAddress,
      assets,
      cashTarget: around(external.cashTarget, rangeTolerance),
      driftTrigger: guards.driftThreshold,
      maxLegValue: external.nav * guards.maxTradeFraction / WAD,
      maxNavLoss: guards.maxRebalanceLoss,
      slippageTolerance: guards.slippageTolerance,
      maxPriceAge: guards.maxStaleness,
      paused: guards.paused
    };
    return {
      vault: this.config.contracts.vault as TokenAddress,
      state: {
        stateId: `${this.config.chainId}:${block.number}:${block.hash}`,
        blockNumber: block.number,
        blockTimestamp: block.timestamp,
        nav: external.nav,
        baseAssetBalance: external.cash,
        baseAssetWeight: external.nav === 0n ? 0n : external.cash * WAD / external.nav,
        drift: external.drift,
        positions: external.assets.map((asset) => ({
          token: asset.address as TokenAddress,
          balance: asset.balance,
          value: asset.value,
          weight: asset.weight
        }))
      },
      policy,
      prices
    };
  }

  async simulate(trades: readonly SetpointTrade[]): Promise<SimulationResult> {
    try {
      await this.client.simulateContract({
        account: this.config.contracts.manager,
        address: this.config.contracts.vault,
        abi: vaultAbi,
        functionName: "rebalance",
        args: [[...trades]]
      });
      return { passed: true };
    } catch (error) {
      const reason = errorText(error);
      return { passed: false, failureCode: mapFailure(classifyRevert(reason)), reason };
    }
  }

  async execute(trades: readonly SetpointTrade[]): Promise<Hash> {
    const { manager, vault } = this.config.contracts;
    const wallet = await this.prepareAccount(manager);
    const simulation = await this.client.simulateContract({
      account: manager,
      address: vault,
      abi: vaultAbi,
      functionName: "rebalance",
      args: [[...trades]]
    });
    const hash = await wallet.writeContract(simulation.request);
    await this.wait(hash);
    return hash;
  }

  /**
   * Execute the real deployed adapter path with eth_call for each size. A fork
   * snapshot is used only to grant temporary allowance and, for mock USDC,
   * temporary probe inventory. Every mutation is reverted before returning.
   */
  async sampleExecutableSwaps(
    tokenIn: Address,
    tokenOut: Address,
    amounts: readonly bigint[]
  ): Promise<ExecutableSwapProbe[]> {
    const deployment = this.requireDeployment();
    const snapshot = await this.snapshot();
    try {
      const maximum = amounts.reduce((largest, amount) => amount > largest ? amount : largest, 0n);
      if (maximum === 0n) return amounts.map((amountIn) => ({ amountIn, failureReason: "zero input" }));
      const current = await this.client.readContract({ address: tokenIn, abi: erc20Abi, functionName: "balanceOf", args: [this.config.contracts.vault] });
      if (tokenIn.toLowerCase() === deployment.baseAsset.toLowerCase() && current < maximum) {
        const minter = await this.prepareAccount(this.config.contracts.manager);
        const mint = await this.client.simulateContract({
          account: this.config.contracts.manager,
          address: tokenIn,
          abi: erc20Abi,
          functionName: "mint",
          args: [this.config.contracts.vault, maximum - current]
        });
        await this.wait(await minter.writeContract(mint.request));
      }
      const vaultWallet = await this.prepareAccount(this.config.contracts.vault);
      const approve = await this.client.simulateContract({
        account: this.config.contracts.vault,
        address: tokenIn,
        abi: erc20Abi,
        functionName: "approve",
        args: [deployment.adapter, maximum]
      });
      await this.wait(await vaultWallet.writeContract(approve.request));

      const probes: ExecutableSwapProbe[] = [];
      for (const amountIn of amounts) {
        try {
          const simulation = await this.client.simulateContract({
            account: this.config.contracts.vault,
            address: deployment.adapter,
            abi: swapAdapterAbi,
            functionName: "swap",
            args: [tokenIn, tokenOut, amountIn, 1n]
          });
          probes.push({ amountIn, expectedOut: simulation.result });
        } catch (error) {
          probes.push({ amountIn, failureReason: errorText(error) });
        }
      }
      return probes;
    } finally {
      await this.revert(snapshot);
    }
  }

  async readGuards(): Promise<RwaGuardState> {
    const vault = this.config.contracts.vault;
    const [driftThreshold, maxTradeFraction, slippageTolerance, maxStaleness, maxRebalanceLoss, paused] = await Promise.all([
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "driftThreshold" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "maxTradeFraction" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "slippageTolerance" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "maxStaleness" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "maxRebalanceLoss" }),
      this.client.readContract({ address: vault, abi: vaultAbi, functionName: "paused" })
    ]);
    return { driftThreshold, maxTradeFraction, slippageTolerance, maxStaleness, maxRebalanceLoss, paused };
  }

  private async prepareAccount(address: Address) {
    await this.testClient.impersonateAccount({ address });
    await this.testClient.setBalance({ address, value: 100n * WAD });
    return createWalletClient({ account: address, chain: this.chain, transport: http(this.rpcUrl) });
  }

  private async wait(hash: Hash): Promise<void> {
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    assert(receipt.status === "success", `transaction ${hash} reverted`);
  }

  private async requireCode(label: string, address: Address): Promise<void> {
    const code = await this.client.getCode({ address });
    assert(code && code !== "0x", `${label} has no code at ${address}`);
  }

  private requireDeployment(): RwaDeployment {
    if (!this.deployment) throw new Error("adapter.validate() must run first");
    return this.deployment;
  }

  private requireGuards(): RwaGuardState {
    if (!this.guards) throw new Error("adapter.validate() must run first");
    return this.guards;
  }
}

function around(target: bigint, tolerance: bigint): TargetRange {
  return {
    min: target > tolerance ? target - tolerance : 0n,
    max: target + tolerance > WAD ? WAD : target + tolerance
  };
}

function mapFailure(reason: RevertClass): SimulationFailureCode {
  const mapping: Record<RevertClass, SimulationFailureCode> = {
    STALE_ORACLE: "STALE_PRICE",
    TRADE_TOO_LARGE: "TRADE_TOO_LARGE",
    SLIPPAGE_TOO_LOOSE: "SLIPPAGE_TOO_LOOSE",
    INSUFFICIENT_OUTPUT: "INSUFFICIENT_OUTPUT",
    INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
    DRIFT_NOT_IMPROVED: "DRIFT_NOT_IMPROVED",
    EXCESSIVE_VALUE_LOSS: "EXCESSIVE_VALUE_LOSS",
    UNAUTHORIZED: "UNAUTHORIZED",
    INVALID_ASSET: "UNSUPPORTED_ASSET",
    UNKNOWN_REVERT: "UNKNOWN_REVERT"
  };
  return mapping[reason];
}

function absDiff(a: bigint, b: bigint): bigint {
  return a > b ? a - b : b - a;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
