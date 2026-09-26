import { defineChain, type Address } from "viem";

export const ROBINHOOD_RPC_URL = "https://rpc.testnet.chain.robinhood.com";
export const ROBINHOOD_EXPLORER_URL = "https://explorer.testnet.chain.robinhood.com";

export const robinhoodTestnet = defineChain({
  id: 46_630,
  name: "Robinhood Chain testnet",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ROBINHOOD_RPC_URL] } },
  blockExplorers: { default: { name: "Blockscout", url: ROBINHOOD_EXPLORER_URL } },
  testnet: true,
});

export const rwaIndexLiveConfig = {
  name: "RWA Index",
  network: "Robinhood Chain testnet",
  chainId: 46_630,
  vault: "0x357CD10343829DBd5889c7b0B2fBc4388fC4875B" as Address,
  oracle: "0x2F2316d6D4a8952730a71BfCD9fa0Af5A0138AB9" as Address,
  manager: "0xbB91Fe38652991f0E9735dc139601bD637ae4d66" as Address,
  baseAsset: "0xFF00eA84190AeD0B1AbEF4fbC45E51258f2799BA" as Address,
  swapAdapter: "0x6E498DB59449aF170A9525a69456154F226a4E03" as Address,
  symbols: {
    "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E": "TSLA",
    "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02": "AMZN",
    "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0": "PLTR",
    "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93": "NFLX",
    "0x71178BAc73cBeb415514eB542a8995b82669778d": "AMD",
  } as Record<Address, string>,
} as const;

export function explorerAddress(address: Address): string {
  return `${ROBINHOOD_EXPLORER_URL}/address/${address}`;
}

export function explorerTransaction(hash: `0x${string}`): string {
  return `${ROBINHOOD_EXPLORER_URL}/tx/${hash}`;
}
