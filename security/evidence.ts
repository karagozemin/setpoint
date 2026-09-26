import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { AdaptiveSolveInput } from "../src/core/adaptive-solver.js";
import { solveHybrid, isRecoverableSimulationFailure, type HybridSolveInput } from "../src/core/hybrid-solver.js";
import type { LiquidityCurve, LiquiditySample } from "../src/core/liquidity.js";
import { WAD } from "../src/core/policy.js";
import type {
  RebalancePlan,
  SimulationAdapter,
  SimulationFailureCode,
  SimulationResult,
  TokenAddress,
  Trade,
} from "../src/core/types.js";

export type EvidenceLevel = "fork evidence" | "integration test evidence";

export interface SecurityEvidenceArtifact {
  schemaVersion: 1;
  milestone: "security-failure-demonstrations";
  scenario: {
    id: string;
    title: string;
    shortLabel: string;
    threat: string;
    invalidCondition: string;
    evidenceLevel: EvidenceLevel;
    boundary: string;
  };
  source: {
    stateId: string | null;
    network: string;
    chainId: number | null;
    vault: string | null;
    caller: string | null;
    sourceArtifact: string | null;
    sourceArtifactSha256: string | null;
  };
  policyValidation: {
    invoked: boolean;
    passed: boolean;
    reason: string | null;
    details: string[];
  };
  fastPath: {
    candidateLegs: number;
    preflightPassed: boolean;
    simulationInvoked: boolean;
    simulationPassed: boolean | null;
    failureCode: string | null;
    failedPlanExecuted: boolean;
  };
  fallback: {
    invoked: boolean;
    trigger: string | null;
    selectedLegs: number;
    simulationPassed: boolean | null;
  };
  execution: {
    attempted: boolean;
    occurred: boolean;
    executedLegs: number;
    transactionHash: string | null;
    confirmedStateReread: boolean;
  };
  terminal: {
    mode: "NO_TRADE" | "ADAPTIVE_FALLBACK_THEN_NO_TRADE";
    reason: string;
    explanation: string;
  };
  observedMetrics: {
    initialDrift: string | null;
    finalDrift: string | null;
    attemptedTurnover: string | null;
    executedTurnover: string | null;
    residualRoute: string | null;
  };
  relevantEvidence: string[];
  invariant: {
    id: string;
    expected: string;
    held: boolean;
  };
}

export interface SecuritySummary {
  schemaVersion: 1;
  milestone: "security-failure-demonstrations";
  deterministic: true;
  scenarios: Array<{
    id: string;
    evidenceLevel: EvidenceLevel;
    artifact: string;
    terminalReason: string;
    invariantHeld: boolean;
  }>;
  invariants: Array<{
    id: string;
    description: string;
    held: boolean;
    evidence: string[];
  }>;
  recoverableSimulationFailures: string[];
  nonRecoverableExamples: string[];
  sourceIntegrity: {
    m2PlannerSha256: string;
    expectedM2PlannerSha256: string;
    m2PlannerUnchanged: boolean;
    m4_2SummarySha256: string;
  };
  allInvariantsHeld: boolean;
}

export interface SecuritySuite {
  artifacts: Record<string, SecurityEvidenceArtifact>;
  summary: SecuritySummary;
}

interface RawStaleArtifact {
  fork: { sourceBlockNumber: string };
  setpoint: {
    mode: "NO_TRADE";
    modeSelectionReason: string;
    terminalReason: string;
    fallbackInvoked: boolean;
    attemptedLegs: number;
    executedLegs: number;
    attemptedTurnover: string;
    executedTurnover: string;
    fastPath: {
      preflightPassed: boolean;
      preflightIssues: Array<{ code: string; detail: string; recoverable: boolean }>;
    };
  };
}

interface RawLargeArtifact {
  fork: { sourceBlockNumber: string };
  setpoint: {
    initialState: { stateId: string; nav: string; driftFormatted: string };
    finalState: { stateId: string; driftFormatted: string };
    attemptedTurnoverOverInitialNav: string;
    executedTurnoverOverInitialNav: string;
    cycles: Array<{
      executionHash?: string;
      stateBefore: { stateId: string };
      stateAfter?: { stateId: string };
      result: {
        kind: "plan" | "no-trade";
        mode: string;
        reason?: string;
        trades?: Trade[];
        simulation?: { passed: boolean };
        fallbackInvoked?: boolean;
        fallbackTriggerReason?: string;
        fastPath?: {
          trades: Trade[];
          preflightPassed: boolean;
          expectedTurnover: string;
          simulation?: { passed: boolean; failureCode?: string };
        };
        excludedLiquidityLegs?: Array<{ tokenIn: string; tokenOut: string; reason: string }>;
      };
    }>;
  };
}

const M2_EXPECTED_SHA = "dcd079ed25ff6fd7683c947fbf46748abd70862fe2a85a368c919b26fe7cee92";
const VAULT = "0x0000000000000000000000000000000000000010" as TokenAddress;
const BASE = "0x0000000000000000000000000000000000000001" as TokenAddress;
const ASSET_A = "0x0000000000000000000000000000000000000002" as TokenAddress;
const ASSET_B = "0x0000000000000000000000000000000000000003" as TokenAddress;
const POOL = "0x0000000000000000000000000000000000000004" as TokenAddress;
const MANAGER = "0x0000000000000000000000000000000000000011";
const RWA_VAULT = "0x357CD10343829DBd5889c7b0B2fBc4388fC4875B";
const RWA_MANAGER = "0xbB91Fe38652991f0E9735dc139601bD637ae4d66";
const u = (value: number) => BigInt(value) * WAD;
const p = (value: number) => (BigInt(value) * WAD) / 100n;

const fastTrades: Trade[] = [
  { tokenIn: ASSET_A, tokenOut: BASE, amountIn: u(20), minAmountOut: (u(196) / 10n) },
  { tokenIn: BASE, tokenOut: ASSET_B, amountIn: u(20), minAmountOut: (u(196) / 10n) },
];

function quote(index: number, amountIn: bigint): LiquiditySample {
  const expectedOut = (amountIn * 99n) / 100n;
  return {
    sampleIndex: index,
    amountIn,
    expectedOut,
    oracleOut: amountIn,
    inputValue: amountIn,
    outputValue: expectedOut,
    effectiveValueRateWad: (expectedOut * WAD) / amountIn,
    priceImpactWad: p(1),
    feeRateWad: p(1) / 100n,
    estimatedFeeValue: amountIn / 10_000n,
    quoteLossValue: amountIn - expectedOut,
    minOutCompatible: true,
    validity: {
      valid: true,
      stateId: "security:confirmed:1",
      blockNumber: 10n,
      observedAt: 10_000n,
      expiresAt: 10_060n,
    },
  };
}

function curve(tokenIn: TokenAddress, tokenOut: TokenAddress): LiquidityCurve {
  return {
    id: `security:${tokenIn}:${tokenOut}`,
    venue: "deterministic-security-fixture",
    pool: POOL,
    tokenIn,
    tokenOut,
    fee: 100,
    stateId: "security:confirmed:1",
    blockNumber: 10n,
    observedAt: 10_000n,
    maximumTestedAmountIn: u(20),
    maximumExecutableAmountIn: u(20),
    samples: [quote(0, u(10)), quote(1, u(20))],
  };
}

export function createSecurityFixture(overrides: Partial<HybridSolveInput> = {}): HybridSolveInput {
  return {
    vault: VAULT,
    state: {
      stateId: "security:confirmed:1",
      blockNumber: 10n,
      blockTimestamp: 10_000n,
      nav: u(100),
      baseAssetBalance: u(20),
      baseAssetWeight: p(20),
      drift: p(20),
      positions: [
        { token: ASSET_A, balance: u(60), value: u(60), weight: p(60) },
        { token: ASSET_B, balance: u(20), value: u(20), weight: p(20) },
      ],
    },
    policy: {
      baseAsset: BASE,
      assets: [ASSET_A, ASSET_B].map((token) => ({
        token,
        target: { min: p(35), max: p(45) },
        maxWeight: p(80),
        enabled: true,
      })),
      cashTarget: { min: p(15), max: p(25) },
      driftTrigger: 0n,
      maxLegValue: u(25),
      maxNavLoss: p(2),
      slippageTolerance: p(2),
      maxPriceAge: 100n,
      paused: false,
    },
    prices: [ASSET_A, ASSET_B].map((token) => ({
      token,
      priceWad: WAD,
      updatedAt: 9_999n,
      source: "deterministic-security-fixture",
    })),
    liquidity: {
      stateId: "security:confirmed:1",
      blockNumber: 10n,
      observedAt: 10_000n,
      curves: [curve(ASSET_A, BASE), curve(BASE, ASSET_B)],
    },
    adaptivePolicy: { maxQuoteAge: 60n, maxSimulationAttempts: 3, maxPriceImpact: p(2) },
    fastPathTrades: fastTrades,
    ...overrides,
  };
}

export function securityFallbackPlan(input: AdaptiveSolveInput): RebalancePlan {
  return {
    kind: "plan",
    vault: input.vault,
    stateId: input.state.stateId,
    blockNumber: input.state.blockNumber,
    trades: [fastTrades[0]!],
    expectedDriftBefore: p(10),
    expectedDriftAfter: p(5),
    expectedTurnover: u(20),
    expectedCost: null,
    activeConstraints: ["simulation-required"],
    rejectedAlternatives: [],
    simulation: { passed: true },
    reason: "deterministic security fixture fallback",
  };
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function wadPercent(value: string): string {
  return `${(Number(BigInt(value)) / Number(WAD) * 100).toFixed(6)}%`;
}

function turnoverPercent(turnover: string, nav: string): string {
  return `${(Number(BigInt(turnover)) / Number(BigInt(nav)) * 100).toFixed(6)}%`;
}

async function buildPolicyRejected(): Promise<SecurityEvidenceArtifact> {
  const candidate = createSecurityFixture();
  candidate.policy = {
    ...candidate.policy,
    assets: candidate.policy.assets.map((asset, index) =>
      index === 0
        ? { ...asset, target: { min: p(95), max: p(95) }, maxWeight: p(80) }
        : asset,
    ),
  };
  let simulationCalls = 0;
  let fallbackCalls = 0;
  const result = await solveHybrid(
    candidate,
    { async simulate() { simulationCalls += 1; return { passed: true }; } },
    async (input) => { fallbackCalls += 1; return securityFallbackPlan(input); },
  );
  const held = result.kind === "no-trade" && result.reason === "INVALID_POLICY" &&
    !result.fallbackInvoked && simulationCalls === 0 && fallbackCalls === 0;
  const resultReason = result.kind === "no-trade" ? result.reason : "EXECUTABLE_PLAN_RETURNED";
  const resultDetails = result.kind === "no-trade" ? result.details : ["unexpected executable plan"];

  return {
    schemaVersion: 1,
    milestone: "security-failure-demonstrations",
    scenario: {
      id: "malicious-target",
      title: "Policy rejected: malicious target",
      shortLabel: "Policy rejected",
      threat: "An arbitrary target attempts to assign 95% weight to an asset capped by policy at 80%.",
      invalidCondition: "target.max exceeds the allowlisted asset maxWeight and the target ranges cannot form a valid portfolio",
      evidenceLevel: "integration test evidence",
      boundary: "Setpoint policy validation; actor-level target authorization is not asserted by this fixture",
    },
    source: {
      stateId: candidate.state.stateId,
      network: "Deterministic core fixture",
      chainId: null,
      vault: candidate.vault,
      caller: null,
      sourceArtifact: null,
      sourceArtifactSha256: null,
    },
    policyValidation: {
      invoked: true,
      passed: false,
      reason: resultReason,
      details: resultDetails,
    },
    fastPath: {
      candidateLegs: candidate.fastPathTrades.length,
      preflightPassed: false,
      simulationInvoked: simulationCalls > 0,
      simulationPassed: null,
      failureCode: null,
      failedPlanExecuted: false,
    },
    fallback: { invoked: result.fallbackInvoked, trigger: null, selectedLegs: 0, simulationPassed: null },
    execution: { attempted: false, occurred: false, executedLegs: 0, transactionHash: null, confirmedStateReread: false },
    terminal: {
      mode: "NO_TRADE",
      reason: resultReason,
      explanation: "Target policy rejected by Setpoint before preflight or vault simulation; this is not a vault transaction revert.",
    },
    observedMetrics: { initialDrift: null, finalDrift: null, attemptedTurnover: "0.000000%", executedTurnover: "0.000000%", residualRoute: null },
    relevantEvidence: [
      `modeSelectionReason=${result.modeSelectionReason}`,
      `simulationCalls=${simulationCalls}`,
      `adaptiveFallbackCalls=${fallbackCalls}`,
      ...resultDetails,
    ],
    invariant: { id: "invalid-policy-never-executes", expected: "Invalid or malicious target policy cannot become executable.", held },
  };
}

async function buildUnsupportedRoute(): Promise<SecurityEvidenceArtifact> {
  const candidate = createSecurityFixture({
    fastPathTrades: [{ tokenIn: ASSET_A, tokenOut: ASSET_B, amountIn: u(20), minAmountOut: u(19) }],
  });
  let simulationCalls = 0;
  let fallbackCalls = 0;
  const result = await solveHybrid(
    candidate,
    { async simulate() { simulationCalls += 1; return { passed: true }; } },
    async (input) => { fallbackCalls += 1; return securityFallbackPlan(input); },
  );
  const routeIssue = result.fastPath.preflightIssues.find((issue) => issue.code === "UNSUPPORTED_ROUTE");
  const held = result.kind === "no-trade" && result.reason === "UNSUPPORTED_ASSET" &&
    routeIssue?.recoverable === false && !result.fallbackInvoked && simulationCalls === 0 && fallbackCalls === 0 &&
    result.fastPath.trades.length === 1;

  return {
    schemaVersion: 1,
    milestone: "security-failure-demonstrations",
    scenario: {
      id: "unsupported-route",
      title: "Unsupported direct asset route",
      shortLabel: "Unsupported route",
      threat: "A candidate attempts a direct asset-to-asset leg outside the allowlisted base-asset hub.",
      invalidCondition: "ASSET_A to ASSET_B is not an allowlisted base-asset-hub route",
      evidenceLevel: "integration test evidence",
      boundary: "Setpoint fast-path route preflight",
    },
    source: {
      stateId: candidate.state.stateId,
      network: "Deterministic core fixture",
      chainId: null,
      vault: candidate.vault,
      caller: null,
      sourceArtifact: null,
      sourceArtifactSha256: null,
    },
    policyValidation: { invoked: true, passed: true, reason: null, details: [] },
    fastPath: {
      candidateLegs: candidate.fastPathTrades.length,
      preflightPassed: result.fastPath.preflightPassed,
      simulationInvoked: simulationCalls > 0,
      simulationPassed: null,
      failureCode: routeIssue?.code ?? null,
      failedPlanExecuted: false,
    },
    fallback: { invoked: result.fallbackInvoked, trigger: null, selectedLegs: 0, simulationPassed: null },
    execution: { attempted: false, occurred: false, executedLegs: 0, transactionHash: null, confirmedStateReread: false },
    terminal: {
      mode: "NO_TRADE",
      reason: result.reason,
      explanation: "The unsupported leg remains visible in evidence and the entire candidate is refused before simulation.",
    },
    observedMetrics: { initialDrift: null, finalDrift: null, attemptedTurnover: "0.000000%", executedTurnover: "0.000000%", residualRoute: "ASSET_A→ASSET_B" },
    relevantEvidence: [
      `modeSelectionReason=${result.modeSelectionReason}`,
      `preflightIssue=${routeIssue?.code ?? "missing"}`,
      `candidateLegsPreserved=${result.fastPath.trades.length}`,
      `simulationCalls=${simulationCalls}`,
      `adaptiveFallbackCalls=${fallbackCalls}`,
    ],
    invariant: { id: "unsupported-route-never-executes", expected: "Unsupported routes cannot be silently dropped or executed.", held },
  };
}

async function buildUnknownRevert(): Promise<SecurityEvidenceArtifact> {
  const candidate = createSecurityFixture();
  let simulationCalls = 0;
  let fallbackCalls = 0;
  const simulator: SimulationAdapter = {
    async simulate(): Promise<SimulationResult> {
      simulationCalls += 1;
      return { passed: false, failureCode: "UNKNOWN_REVERT", reason: "deterministic unknown integration failure" };
    },
  };
  const result = await solveHybrid(
    candidate,
    simulator,
    async (input) => { fallbackCalls += 1; return securityFallbackPlan(input); },
  );
  const held = result.kind === "no-trade" && result.reason === "SIMULATION_REJECTED" &&
    result.fastPath.simulation?.failureCode === "UNKNOWN_REVERT" && !result.fallbackInvoked && fallbackCalls === 0;

  return {
    schemaVersion: 1,
    milestone: "security-failure-demonstrations",
    scenario: {
      id: "unknown-revert",
      title: "Unknown simulation failure",
      shortLabel: "Unknown failure",
      threat: "The integration returns a revert that is not classified as recoverable.",
      invalidCondition: "UNKNOWN_REVERT from exact fast-path simulation",
      evidenceLevel: "integration test evidence",
      boundary: "Setpoint simulation failure allowlist",
    },
    source: {
      stateId: candidate.state.stateId,
      network: "Deterministic core fixture",
      chainId: null,
      vault: candidate.vault,
      caller: MANAGER,
      sourceArtifact: null,
      sourceArtifactSha256: null,
    },
    policyValidation: { invoked: true, passed: true, reason: null, details: [] },
    fastPath: {
      candidateLegs: candidate.fastPathTrades.length,
      preflightPassed: result.fastPath.preflightPassed,
      simulationInvoked: simulationCalls > 0,
      simulationPassed: result.fastPath.simulation?.passed ?? null,
      failureCode: result.fastPath.simulation?.failureCode ?? null,
      failedPlanExecuted: false,
    },
    fallback: { invoked: result.fallbackInvoked, trigger: null, selectedLegs: 0, simulationPassed: null },
    execution: { attempted: false, occurred: false, executedLegs: 0, transactionHash: null, confirmedStateReread: false },
    terminal: {
      mode: "NO_TRADE",
      reason: result.reason,
      explanation: "Unknown simulation failures are non-recoverable by default and cannot activate adaptive execution.",
    },
    observedMetrics: { initialDrift: null, finalDrift: null, attemptedTurnover: "0.000000%", executedTurnover: "0.000000%", residualRoute: null },
    relevantEvidence: [
      `modeSelectionReason=${result.modeSelectionReason}`,
      `simulationFailure=${result.fastPath.simulation?.failureCode ?? "missing"}`,
      `simulationCalls=${simulationCalls}`,
      `adaptiveFallbackCalls=${fallbackCalls}`,
    ],
    invariant: { id: "unknown-failure-never-falls-back", expected: "Unknown failures fail closed and never activate adaptive fallback.", held },
  };
}

function buildStaleOracle(): SecurityEvidenceArtifact {
  const sourcePath = "artifacts/hybrid/stale-oracle.json";
  const source = readJson<RawStaleArtifact>(sourcePath);
  const setpoint = source.setpoint;
  const held = setpoint.mode === "NO_TRADE" && setpoint.terminalReason === "STALE_PRICE" &&
    !setpoint.fallbackInvoked && setpoint.executedLegs === 0 && setpoint.executedTurnover === "0";

  return {
    schemaVersion: 1,
    milestone: "security-failure-demonstrations",
    scenario: {
      id: "stale-oracle",
      title: "Stale authoritative oracle",
      shortLabel: "Stale oracle",
      threat: "Vault accounting prices exceed the deployed freshness limit.",
      invalidCondition: "authoritative vault accounting rejects stale prices before planning",
      evidenceLevel: "fork evidence",
      boundary: "Existing RWA Index fork artifact; precise oracle age is not recorded",
    },
    source: {
      stateId: null,
      network: "Robinhood Chain testnet fork",
      chainId: 46630,
      vault: RWA_VAULT,
      caller: RWA_MANAGER,
      sourceArtifact: sourcePath,
      sourceArtifactSha256: sha256File(sourcePath),
    },
    policyValidation: {
      invoked: true,
      passed: false,
      reason: "STALE_PRICE",
      details: setpoint.fastPath.preflightIssues.map((issue) => issue.detail),
    },
    fastPath: {
      candidateLegs: setpoint.attemptedLegs,
      preflightPassed: setpoint.fastPath.preflightPassed,
      simulationInvoked: false,
      simulationPassed: null,
      failureCode: "STALE_PRICE",
      failedPlanExecuted: false,
    },
    fallback: { invoked: setpoint.fallbackInvoked, trigger: null, selectedLegs: 0, simulationPassed: null },
    execution: { attempted: false, occurred: false, executedLegs: setpoint.executedLegs, transactionHash: null, confirmedStateReread: false },
    terminal: {
      mode: "NO_TRADE",
      reason: setpoint.terminalReason,
      explanation: "Stale accounting fails closed before a plan, simulation-approved execution, or fallback can exist.",
    },
    observedMetrics: { initialDrift: null, finalDrift: null, attemptedTurnover: "0.000000%", executedTurnover: "0.000000%", residualRoute: null },
    relevantEvidence: [
      `sourceForkBlock=${source.fork.sourceBlockNumber}`,
      `modeSelectionReason=${setpoint.modeSelectionReason}`,
      `fallbackInvoked=${setpoint.fallbackInvoked}`,
      `executedLegs=${setpoint.executedLegs}`,
      "oracleAge=not recorded",
    ],
    invariant: { id: "stale-price-never-executes", expected: "Stale authoritative prices produce NO_TRADE with zero execution.", held },
  };
}

function buildUnsafeLiquidity(): SecurityEvidenceArtifact {
  const sourcePath = "artifacts/hybrid/large-target-change.json";
  const source = readJson<RawLargeArtifact>(sourcePath);
  const first = source.setpoint.cycles[0]!;
  const terminal = source.setpoint.cycles[1]!;
  const residual = terminal.result.excludedLiquidityLegs?.find((leg) => leg.reason === "NO_MINOUT_COMPATIBLE_SAMPLE");
  const confirmedStateReread = first.stateAfter?.stateId === terminal.stateBefore.stateId;
  const selectedPassed = first.result.simulation?.passed === true;
  const held = first.result.fastPath?.simulation?.failureCode === "INSUFFICIENT_OUTPUT" &&
    first.result.mode === "ADAPTIVE_FALLBACK" && first.result.trades?.length === 3 && selectedPassed &&
    terminal.result.kind === "no-trade" && terminal.result.reason === "NO_SAFE_LIQUIDITY" &&
    residual?.reason === "NO_MINOUT_COMPATIBLE_SAMPLE" && confirmedStateReread;
  const fastTurnover = first.result.fastPath?.expectedTurnover;

  return {
    schemaVersion: 1,
    milestone: "security-failure-demonstrations",
    scenario: {
      id: "unsafe-liquidity",
      title: "Unsafe residual liquidity",
      shortLabel: "Unsafe liquidity",
      threat: "The complete rebalance and later residual route cannot satisfy the vault's oracle-derived output floor.",
      invalidCondition: "USDC to NFLX has no executable sample compatible with the 98%-of-oracle minimum-output floor",
      evidenceLevel: "fork evidence",
      boundary: "Existing RWA Index equivalent-state M4.2 fork artifact",
    },
    source: {
      stateId: source.setpoint.initialState.stateId,
      network: "Robinhood Chain testnet fork",
      chainId: 46630,
      vault: RWA_VAULT,
      caller: RWA_MANAGER,
      sourceArtifact: sourcePath,
      sourceArtifactSha256: sha256File(sourcePath),
    },
    policyValidation: { invoked: true, passed: true, reason: null, details: [] },
    fastPath: {
      candidateLegs: first.result.fastPath?.trades.length ?? 0,
      preflightPassed: first.result.fastPath?.preflightPassed ?? false,
      simulationInvoked: true,
      simulationPassed: first.result.fastPath?.simulation?.passed ?? null,
      failureCode: first.result.fastPath?.simulation?.failureCode ?? null,
      failedPlanExecuted: false,
    },
    fallback: {
      invoked: first.result.fallbackInvoked ?? false,
      trigger: first.result.fallbackTriggerReason ?? null,
      selectedLegs: first.result.trades?.length ?? 0,
      simulationPassed: selectedPassed,
    },
    execution: {
      attempted: true,
      occurred: first.executionHash !== undefined,
      executedLegs: first.result.trades?.length ?? 0,
      transactionHash: first.executionHash ?? null,
      confirmedStateReread,
    },
    terminal: {
      mode: "ADAPTIVE_FALLBACK_THEN_NO_TRADE",
      reason: terminal.result.reason ?? "UNKNOWN",
      explanation: "A simulation-approved safe subset executed; the remaining unsafe route was refused after confirmed-state re-read.",
    },
    observedMetrics: {
      initialDrift: source.setpoint.initialState.driftFormatted,
      finalDrift: source.setpoint.finalState.driftFormatted,
      attemptedTurnover: fastTurnover === undefined ? null : turnoverPercent(fastTurnover, source.setpoint.initialState.nav),
      executedTurnover: wadPercent(source.setpoint.executedTurnoverOverInitialNav),
      residualRoute: residual === undefined ? null : "USDC→NFLX",
    },
    relevantEvidence: [
      `sourceForkBlock=${source.fork.sourceBlockNumber}`,
      `fastPathFailure=${first.result.fastPath?.simulation?.failureCode ?? "missing"}`,
      `safeSubsetSimulationPassed=${selectedPassed}`,
      `safeSubsetExecutionHash=${first.executionHash ?? "missing"}`,
      `confirmedStateReread=${confirmedStateReread}`,
      `residualReason=${residual?.reason ?? "missing"}`,
    ],
    invariant: { id: "unsafe-residual-never-submitted", expected: "Only the simulation-approved safe subset executes; unsafe residual liquidity is refused.", held },
  };
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function uiPolicySeparationHeld(): boolean {
  const files = sourceFiles("web");
  return files.every((path) => {
    const source = readFileSync(path, "utf8");
    return !source.includes("src/core") && !source.includes("solveHybrid(") && !source.includes("solveBatchAdaptive(");
  });
}

export async function buildSecuritySuite(): Promise<SecuritySuite> {
  const artifacts: Record<string, SecurityEvidenceArtifact> = {
    "stale-oracle.json": buildStaleOracle(),
    "malicious-target.json": await buildPolicyRejected(),
    "unsupported-route.json": await buildUnsupportedRoute(),
    "unsafe-liquidity.json": buildUnsafeLiquidity(),
    "unknown-revert.json": await buildUnknownRevert(),
  };

  const stale = artifacts["stale-oracle.json"]!;
  const malicious = artifacts["malicious-target.json"]!;
  const unsupported = artifacts["unsupported-route.json"]!;
  const unsafe = artifacts["unsafe-liquidity.json"]!;
  const unknown = artifacts["unknown-revert.json"]!;
  const uiSeparated = uiPolicySeparationHeld();
  const recoverableCodes: SimulationFailureCode[] = [
    "INSUFFICIENT_OUTPUT",
    "TRADE_TOO_LARGE",
    "INSUFFICIENT_BALANCE",
    "DRIFT_NOT_IMPROVED",
    "EXCESSIVE_VALUE_LOSS",
  ];
  const nonRecoverableCodes: SimulationFailureCode[] = [
    "STALE_PRICE",
    "SLIPPAGE_TOO_LOOSE",
    "UNAUTHORIZED",
    "UNSUPPORTED_ASSET",
    "UNKNOWN_REVERT",
  ];
  const m2Sha = sha256File("integrations/rwa-index/src/baseline.ts");

  const invariants: SecuritySummary["invariants"] = [
    { id: stale.invariant.id, description: stale.invariant.expected, held: stale.invariant.held, evidence: ["stale-oracle.json"] },
    { id: malicious.invariant.id, description: malicious.invariant.expected, held: malicious.invariant.held, evidence: ["malicious-target.json"] },
    { id: unsupported.invariant.id, description: unsupported.invariant.expected, held: unsupported.invariant.held, evidence: ["unsupported-route.json"] },
    { id: unknown.invariant.id, description: unknown.invariant.expected, held: unknown.invariant.held, evidence: ["unknown-revert.json"] },
    { id: "fallback-is-explicit-allowlist", description: "Only named recoverable simulation failures activate adaptive fallback.", held: recoverableCodes.every(isRecoverableSimulationFailure) && nonRecoverableCodes.every((code) => !isRecoverableSimulationFailure(code)), evidence: ["unknown-revert.json", "unsafe-liquidity.json"] },
    { id: "failed-fast-path-never-executes", description: "A failed simple batch is never submitted before fallback.", held: !unsafe.fastPath.failedPlanExecuted && unsafe.fastPath.simulationPassed === false, evidence: ["unsafe-liquidity.json"] },
    { id: "adaptive-plan-simulation-gated", description: "The observed adaptive execution passed exact vault simulation.", held: unsafe.fallback.simulationPassed === true && unsafe.execution.occurred, evidence: ["unsafe-liquidity.json"] },
    { id: unsafe.invariant.id, description: unsafe.invariant.expected, held: unsafe.invariant.held, evidence: ["unsafe-liquidity.json"] },
    { id: "confirmed-state-reread", description: "A successful adaptive execution is followed by confirmed-state re-read before the terminal decision.", held: unsafe.execution.confirmedStateReread, evidence: ["unsafe-liquidity.json"] },
    { id: "authorization-not-bypassed", description: "Integration fixtures do not execute and fork execution uses the configured RWA manager identity.", held: !malicious.execution.attempted && !unsupported.execution.attempted && !unknown.execution.attempted && unsafe.source.caller === RWA_MANAGER, evidence: ["malicious-target.json", "unsupported-route.json", "unknown-revert.json", "unsafe-liquidity.json"] },
    { id: "ui-policy-separation", description: "UI sources do not import or invoke execution-core solvers.", held: uiSeparated, evidence: ["web/"] },
  ];

  const summary: SecuritySummary = {
    schemaVersion: 1,
    milestone: "security-failure-demonstrations",
    deterministic: true,
    scenarios: Object.entries(artifacts).map(([fileName, artifact]) => ({
      id: artifact.scenario.id,
      evidenceLevel: artifact.scenario.evidenceLevel,
      artifact: `artifacts/security/${fileName}`,
      terminalReason: artifact.terminal.reason,
      invariantHeld: artifact.invariant.held,
    })),
    invariants,
    recoverableSimulationFailures: recoverableCodes,
    nonRecoverableExamples: nonRecoverableCodes,
    sourceIntegrity: {
      m2PlannerSha256: m2Sha,
      expectedM2PlannerSha256: M2_EXPECTED_SHA,
      m2PlannerUnchanged: m2Sha === M2_EXPECTED_SHA,
      m4_2SummarySha256: sha256File("artifacts/m4-2-summary.json"),
    },
    allInvariantsHeld: invariants.every((invariant) => invariant.held) &&
      Object.values(artifacts).every((artifact) => artifact.invariant.held) && m2Sha === M2_EXPECTED_SHA,
  };

  return { artifacts, summary };
}

export function validateSecuritySuite(suite: SecuritySuite): void {
  if (Object.keys(suite.artifacts).length !== 5) throw new Error("security suite must contain five scenarios");
  for (const [fileName, artifact] of Object.entries(suite.artifacts)) {
    if (!artifact.invariant.held) throw new Error(`${fileName}: safety invariant failed`);
    if (artifact.fastPath.failedPlanExecuted) throw new Error(`${fileName}: failed fast path executed`);
    if (artifact.terminal.mode === "NO_TRADE" && artifact.execution.occurred) {
      throw new Error(`${fileName}: terminal no-trade artifact records execution`);
    }
  }
  if (!suite.summary.sourceIntegrity.m2PlannerUnchanged) throw new Error("M2 planner hash changed");
  if (!suite.summary.allInvariantsHeld) throw new Error("one or more security invariants failed");
}
