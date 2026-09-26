import type { Address, EIP1193Provider } from "viem";
import { getAddress } from "viem";
import { ROBINHOOD_EXPLORER_URL, ROBINHOOD_RPC_URL, rwaIndexLiveConfig } from "../../src/live/config";

declare global {
  interface Window {
    ethereum?: EIP1193Provider & {
      on?: (event: string, listener: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
    };
  }
}

export interface WalletState {
  provider: EIP1193Provider | null;
  account: Address | null;
  chainId: number | null;
}

export async function readWallet(): Promise<WalletState> {
  const provider = window.ethereum ?? null;
  if (!provider) return { provider: null, account: null, chainId: null };
  const [accounts, chainHex] = await Promise.all([
    provider.request({ method: "eth_accounts" }) as Promise<string[]>,
    provider.request({ method: "eth_chainId" }) as Promise<string>,
  ]);
  return {
    provider,
    account: accounts[0] ? getAddress(accounts[0]) : null,
    chainId: Number.parseInt(chainHex, 16),
  };
}

export async function connectWallet(): Promise<WalletState> {
  const provider = window.ethereum;
  if (!provider) throw new Error("No injected wallet found. Install MetaMask, Rabby, or another EIP-1193 wallet.");
  await provider.request({ method: "eth_requestAccounts" });
  return readWallet();
}

export async function switchToRobinhood(provider: EIP1193Provider): Promise<void> {
  const chainId = `0x${rwaIndexLiveConfig.chainId.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? Number(error.code) : null;
    if (code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId,
        chainName: "Robinhood Chain testnet",
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: [ROBINHOOD_RPC_URL],
        blockExplorerUrls: [ROBINHOOD_EXPLORER_URL],
      }],
    });
  }
}
