import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Address } from "viem";

interface RawConfig {
  name: string;
  network: string;
  chainId: number;
  sourceRpcUrl: string;
  upstream: { repository: string; commit: string };
  contracts: Record<"vault" | "oracle" | "manager" | "poolSyncer" | "syncerOwner", Address>;
  symbols: Record<Address, string>;
}

export function loadConfig(): RawConfig {
  const path = resolve(process.cwd(), "config/rwa-index.json");
  return JSON.parse(readFileSync(path, "utf8")) as RawConfig;
}
