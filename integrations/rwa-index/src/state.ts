import type { Address, PublicClient } from "viem";
import { erc20Abi, oracleAbi, vaultAbi } from "./abi.js";
import { WAD, type AssetState, type PortfolioState } from "./math.js";

export async function readPortfolio(
  client: PublicClient,
  vault: Address,
  oracle: Address,
  baseAsset: Address,
  assets: readonly Address[],
  symbols: Record<Address, string>
): Promise<PortfolioState> {
  const [blockNumber, nav, drift, cash, cashTarget] = await Promise.all([
    client.getBlockNumber(),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "totalAssets" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "totalDrift" }),
    client.readContract({ address: baseAsset, abi: erc20Abi, functionName: "balanceOf", args: [vault] }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "cashTarget" })
  ]);

  const assetStates: AssetState[] = [];
  for (const address of assets) {
    const [balance, value, targetWeight, priceResult] = await Promise.all([
      client.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [vault] }),
      client.readContract({ address: vault, abi: vaultAbi, functionName: "assetValue", args: [address] }),
      client.readContract({ address: vault, abi: vaultAbi, functionName: "targetWeight", args: [address] }),
      client.readContract({ address: oracle, abi: oracleAbi, functionName: "getPrice", args: [address] })
    ]);
    assetStates.push({
      address,
      symbol: symbols[address] ?? symbols[address.toLowerCase() as Address] ?? address,
      balance,
      price: priceResult[0],
      updatedAt: priceResult[1],
      value,
      weight: nav === 0n ? 0n : (value * WAD) / nav,
      targetWeight
    });
  }

  return { blockNumber, nav, drift, cash, cashTarget, assets: assetStates };
}
