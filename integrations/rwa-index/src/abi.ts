export const vaultAbi = [
  { type: "function", name: "assets", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "oracle", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "swapAdapter", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalDrift", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "assetValue", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "targetWeight", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "cashTarget", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "driftThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxTradeFraction", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "slippageTolerance", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxStaleness", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxRebalanceLoss", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "hasRole", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "bool" }] },
  {
    type: "function",
    name: "rebalance",
    stateMutability: "nonpayable",
    inputs: [{
      name: "trades",
      type: "tuple[]",
      components: [
        { name: "tokenIn", type: "address" },
        { name: "tokenOut", type: "address" },
        { name: "amountIn", type: "uint256" },
        { name: "minAmountOut", type: "uint256" }
      ]
    }],
    outputs: []
  },
  { type: "error", name: "StalePrice", inputs: [{ name: "token", type: "address" }] },
  { type: "error", name: "TradeTooLarge", inputs: [] },
  { type: "error", name: "SlippageTooLoose", inputs: [] },
  { type: "error", name: "DriftNotImproved", inputs: [] },
  { type: "error", name: "ExcessiveValueLoss", inputs: [] },
  { type: "error", name: "NotAuthorized", inputs: [] }
] as const;

export const oracleAbi = [
  { type: "function", name: "PRICE_FEEDER_ROLE", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "hasRole", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "getPrice", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ name: "price", type: "uint256" }, { name: "updatedAt", type: "uint256" }] },
  { type: "function", name: "setPrices", stateMutability: "nonpayable", inputs: [{ name: "tokens", type: "address[]" }, { name: "prices", type: "uint256[]" }], outputs: [] }
] as const;

export const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }
] as const;

export const swapAdapterAbi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "defaultFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] }
] as const;

export const factoryAbi = [
  { type: "function", name: "getPool", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }], outputs: [{ type: "address" }] }
] as const;

export const poolAbi = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" }
    ]
  },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] }
] as const;

export const syncerAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "previewTargetSqrt", stateMutability: "pure", inputs: [{ type: "address" }, { type: "address" }, { type: "uint256" }], outputs: [{ type: "uint160" }] },
  { type: "function", name: "syncToPrice", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }], outputs: [] }
] as const;
