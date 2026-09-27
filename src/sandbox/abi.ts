import { parseAbi } from "viem";

export const sandboxFactoryAbi = parseAbi([
  "function getVault(address owner) view returns (address)",
  "function createVault() returns (address vault)",
  "function baseAsset() view returns (address)",
  "function oracle() view returns (address)",
  "function swapAdapter() view returns (address)",
  "function assets() view returns (address[])",
  "event VaultCreated(address indexed owner, address indexed vault, uint256 initialNav)",
]);

export const sandboxVaultAbi = parseAbi([
  "struct Trade { address tokenIn; address tokenOut; uint256 amountIn; uint256 minAmountOut; }",
  "function owner() view returns (address)",
  "function baseAsset() view returns (address)",
  "function oracle() view returns (address)",
  "function swapAdapter() view returns (address)",
  "function assets() view returns (address[])",
  "function targetWeight(address token) view returns (uint256)",
  "function cashTarget() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function totalDrift() view returns (uint256)",
  "function driftThreshold() view returns (uint256)",
  "function maxTradeFraction() view returns (uint256)",
  "function slippageTolerance() view returns (uint256)",
  "function maxPriceAge() view returns (uint256)",
  "function maxRebalanceLoss() view returns (uint256)",
  "function setTargets(uint256[] weights, uint256 cashTarget)",
  "function rebalance((address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut)[] trades)",
  "event TargetsUpdated(address indexed owner, uint256 cashTarget, address[] assets, uint256[] weights)",
  "event Rebalanced(address indexed owner, uint256 driftBefore, uint256 driftAfter, uint256 navBefore, uint256 navAfter, uint256 legs)",
  "error NotOwner()",
  "error BadWeights()",
  "error UnsupportedAsset(address token)",
  "error StalePrice(address token)",
  "error TradeTooLarge()",
  "error SlippageTooLoose()",
  "error DriftBelowThreshold()",
  "error DriftNotImproved()",
  "error ExcessiveValueLoss()",
]);

export const sandboxOracleAbi = parseAbi([
  "function getPrice(address token) view returns (uint256 priceWad, uint256 updatedAt)",
  "function updater() view returns (address)",
  "function decimals() view returns (uint8)",
  "function setPrices(address[] tokens, uint256[] prices)",
  "event PriceUpdated(address indexed token, uint256 priceWad, uint256 updatedAt)",
]);

export const sandboxAdapterAbi = parseAbi([
  "function quote(address tokenIn, address tokenOut, uint256 amountIn) view returns (uint256 amountOut)",
  "function poolFor(address token) view returns (address)",
]);

export const sandboxPoolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function feeBps() view returns (uint16)",
  "function reserves() view returns (uint256 reserve0, uint256 reserve1)",
  "function quote(address tokenIn, uint256 amountIn) view returns (uint256 amountOut)",
]);

export const sandboxTokenAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
