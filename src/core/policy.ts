import type {
  AssetPolicy,
  NoTradeReason,
  PortfolioState,
  PricePoint,
  SolveInput,
  TargetRange,
  TokenAddress
} from "./types.js";

export const WAD = 10n ** 18n;

export type RangeClassification = "BELOW_RANGE" | "IN_RANGE" | "ABOVE_RANGE";

export interface PolicyIssue {
  reason: NoTradeReason;
  detail: string;
}

export function classifyWeight(weight: bigint, range: TargetRange): RangeClassification {
  if (weight < range.min) return "BELOW_RANGE";
  if (weight > range.max) return "ABOVE_RANGE";
  return "IN_RANGE";
}

export function validateSolveInput(input: SolveInput): PolicyIssue[] {
  const { state, policy, prices } = input;
  const issues: PolicyIssue[] = [];
  if (state.nav <= 0n) issues.push({ reason: "INVALID_NAV", detail: "NAV must be positive" });
  if (state.baseAssetBalance < 0n) issues.push({ reason: "INVALID_POLICY", detail: "base-asset balance cannot be negative" });
  if (policy.paused) issues.push({ reason: "VAULT_PAUSED", detail: "vault is paused" });
  if (!validRange(policy.cashTarget)) issues.push({ reason: "INVALID_POLICY", detail: "invalid cash target range" });
  if (policy.maxLegValue <= 0n) issues.push({ reason: "INVALID_POLICY", detail: "maxLegValue must be positive" });
  if (policy.driftTrigger < 0n || policy.driftTrigger > WAD) {
    issues.push({ reason: "INVALID_POLICY", detail: "driftTrigger must be in [0, WAD]" });
  }
  if (policy.maxNavLoss < 0n || policy.maxNavLoss > WAD) {
    issues.push({ reason: "INVALID_POLICY", detail: "maxNavLoss must be in [0, WAD]" });
  }
  if (policy.slippageTolerance < 0n || policy.slippageTolerance >= WAD) {
    issues.push({ reason: "INVALID_POLICY", detail: "slippageTolerance must be in [0, WAD)" });
  }
  if (policy.maxPriceAge < 0n) issues.push({ reason: "INVALID_POLICY", detail: "maxPriceAge cannot be negative" });
  if (policy.maxTurnover !== undefined && (policy.maxTurnover < 0n || policy.maxTurnover > WAD)) {
    issues.push({ reason: "INVALID_POLICY", detail: "maxTurnover must be in [0, WAD]" });
  }
  if (policy.minimumExpectedImprovement !== undefined
    && (policy.minimumExpectedImprovement < 0n || policy.minimumExpectedImprovement > WAD)) {
    issues.push({ reason: "INVALID_POLICY", detail: "minimumExpectedImprovement must be in [0, WAD]" });
  }
  if (policy.minimumCashBuffer !== undefined
    && (policy.minimumCashBuffer < 0n || (state.nav > 0n && policy.minimumCashBuffer > state.nav))) {
    issues.push({ reason: "INVALID_POLICY", detail: "minimumCashBuffer must be between zero and NAV" });
  }
  if (policy.minimumCashBuffer !== undefined && state.nav > 0n
    && policy.minimumCashBuffer > state.nav * policy.cashTarget.max / WAD) {
    issues.push({ reason: "INVALID_POLICY", detail: "minimumCashBuffer exceeds the cash target maximum" });
  }

  const policyTokens = new Set<string>();
  for (const asset of policy.assets) {
    const key = asset.token.toLowerCase();
    if (key === policy.baseAsset.toLowerCase()) {
      issues.push({ reason: "INVALID_POLICY", detail: "base asset cannot also be a basket asset" });
    }
    if (policyTokens.has(key)) issues.push({ reason: "INVALID_POLICY", detail: `duplicate asset policy ${asset.token}` });
    policyTokens.add(key);
    if (!asset.enabled) continue;
    if (!validRange(asset.target) || asset.target.max > asset.maxWeight || asset.maxWeight > WAD) {
      issues.push({ reason: "INVALID_POLICY", detail: `invalid target or max weight for ${asset.token}` });
    }
  }

  const enabled = policy.assets.filter(({ enabled }) => enabled);
  const minimumSum = enabled.reduce((sum, asset) => sum + asset.target.min, policy.cashTarget.min);
  const maximumSum = enabled.reduce((sum, asset) => sum + asset.target.max, policy.cashTarget.max);
  if (minimumSum > WAD || maximumSum < WAD) {
    issues.push({ reason: "INVALID_POLICY", detail: "target ranges cannot contain a portfolio summing to WAD" });
  }

  const positions = new Map<string, PortfolioState["positions"][number]>();
  for (const position of state.positions) {
    const key = position.token.toLowerCase();
    if (positions.has(key)) issues.push({ reason: "INVALID_POLICY", detail: `duplicate portfolio position ${position.token}` });
    positions.set(key, position);
    const policyAsset = policy.assets.find(({ token }) => token.toLowerCase() === position.token.toLowerCase());
    if (!policyAsset?.enabled) issues.push({ reason: "UNSUPPORTED_ASSET", detail: `position is not allowlisted: ${position.token}` });
    if (position.balance < 0n || position.value < 0n || position.weight < 0n) {
      issues.push({ reason: "INVALID_POLICY", detail: `negative position field for ${position.token}` });
    }
  }
  for (const asset of enabled) {
    if (!positions.has(asset.token.toLowerCase())) {
      issues.push({ reason: "INVALID_POLICY", detail: `missing portfolio position for ${asset.token}` });
    }
  }

  const priceMap = new Map<string, PricePoint>();
  for (const price of prices) {
    const key = price.token.toLowerCase();
    if (priceMap.has(key)) issues.push({ reason: "INVALID_POLICY", detail: `duplicate price ${price.token}` });
    priceMap.set(key, price);
  }
  for (const asset of enabled) {
    const price = priceMap.get(asset.token.toLowerCase());
    if (!price || price.priceWad <= 0n) {
      issues.push({ reason: "MISSING_PRICE", detail: `missing or zero price for ${asset.token}` });
      continue;
    }
    if (state.blockTimestamp > price.updatedAt && state.blockTimestamp - price.updatedAt > policy.maxPriceAge) {
      issues.push({ reason: "STALE_PRICE", detail: `stale price for ${asset.token}` });
    }
  }

  return issues;
}

export function targetRegionReached(state: PortfolioState, assets: readonly AssetPolicy[], cashTarget: TargetRange): boolean {
  if (classifyWeight(state.baseAssetWeight, cashTarget) !== "IN_RANGE") return false;
  return assets.filter(({ enabled }) => enabled).every((asset) => {
    const position = state.positions.find(({ token }) => token.toLowerCase() === asset.token.toLowerCase());
    return position !== undefined && classifyWeight(position.weight, asset.target) === "IN_RANGE";
  });
}

export function rangeDrift(
  nav: bigint,
  baseValue: bigint,
  positions: ReadonlyMap<string, bigint>,
  assets: readonly AssetPolicy[],
  cashTarget: TargetRange
): bigint {
  if (nav <= 0n) return 0n;
  let raw = distanceToRange(baseValue * WAD / nav, cashTarget);
  for (const asset of assets.filter(({ enabled }) => enabled)) {
    const value = positions.get(asset.token.toLowerCase()) ?? 0n;
    raw += distanceToRange(value * WAD / nav, asset.target);
  }
  return raw / 2n;
}

export function policyForToken(assets: readonly AssetPolicy[], token: TokenAddress): AssetPolicy | undefined {
  return assets.find((asset) => asset.token.toLowerCase() === token.toLowerCase());
}

export function priceForToken(prices: readonly PricePoint[], token: TokenAddress): PricePoint | undefined {
  return prices.find((price) => price.token.toLowerCase() === token.toLowerCase());
}

function validRange(range: TargetRange): boolean {
  return range.min >= 0n && range.max >= range.min && range.max <= WAD;
}

function distanceToRange(weight: bigint, range: TargetRange): bigint {
  if (weight < range.min) return range.min - weight;
  if (weight > range.max) return weight - range.max;
  return 0n;
}
