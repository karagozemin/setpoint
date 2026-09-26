import { WAD } from "./math.js";

export interface RwaScenarioDefinition {
  id: string;
  title: string;
  rationale: string;
  weights: bigint[];
  cashTarget: bigint;
  liquidityClass: "relatively-deep-toy" | "thin-toy" | "asymmetric-toy" | "large-change" | "defensive";
  focusAssets: string[];
  maxCycles: number;
}

/** Shared scenario policy for M2 baseline and M3+ Setpoint runs. */
export function rwaScenarioDefinitions(): RwaScenarioDefinition[] {
  const p = (percent: number) => BigInt(percent) * WAD / 100n;
  const bps = (basisPoints: number) => BigInt(basisPoints) * WAD / 10_000n;
  return [
    {
      id: "moderate-drift-deep-toy",
      title: "Moderate drift against relatively deep toy liquidity",
      rationale: "Moves approximately 10% target weight from AMD to TSLA while declaring a 2% operational cash target. TSLA and AMD have the largest oracle-valued pool inventory proxies in this deployment.",
      weights: [bps(2940), bps(1960), bps(1960), bps(1960), bps(980)],
      cashTarget: p(2),
      liquidityClass: "relatively-deep-toy",
      focusAssets: ["TSLA", "AMD"],
      maxCycles: 8
    },
    {
      id: "moderate-drift-thin-toy",
      title: "Moderate drift against thin toy liquidity",
      rationale: "Moves approximately 10% target weight from AMD to NFLX with the same 2% operational cash target. NFLX has the smallest oracle-valued pool inventory proxy in this deployment.",
      weights: [bps(1960), bps(1960), bps(1960), bps(2940), bps(980)],
      cashTarget: p(2),
      liquidityClass: "thin-toy",
      focusAssets: ["NFLX", "AMD"],
      maxCycles: 8
    },
    {
      id: "asymmetric-liquidity",
      title: "Asymmetric liquidity across desired buys",
      rationale: "Moves approximately 10% target weight out of AMD and splits it between relatively deeper TSLA and thinner NFLX, with the same 2% operational cash target.",
      weights: [bps(2450), bps(1960), bps(1960), bps(2450), bps(980)],
      cashTarget: p(2),
      liquidityClass: "asymmetric-toy",
      focusAssets: ["TSLA", "NFLX", "AMD"],
      maxCycles: 8
    },
    {
      id: "large-target-change",
      title: "Target change too large for one safe static batch",
      rationale: "Raises NFLX to 49%, reduces TSLA, AMZN, and PLTR to 9.8% each, keeps AMD near 20%, and declares the same 2% cash target. Static 10%-NAV chunks are submitted without depth-aware resizing.",
      weights: [bps(980), bps(980), bps(980), bps(4900), bps(1960)],
      cashTarget: p(2),
      liquidityClass: "large-change",
      focusAssets: ["NFLX"],
      maxCycles: 8
    },
    {
      id: "defensive-cash-target",
      title: "Defensive cash-target increase",
      rationale: "Changes the mandate from fully invested to 20% cash and 16% per stock, requiring sells only.",
      weights: [p(16), p(16), p(16), p(16), p(16)],
      cashTarget: p(20),
      liquidityClass: "defensive",
      focusAssets: ["TSLA", "AMZN", "PLTR", "NFLX", "AMD"],
      maxCycles: 8
    }
  ];
}
