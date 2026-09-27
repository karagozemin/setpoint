// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {ISetpointOracle} from "./interfaces/ISetpointOracle.sol";
import {ISetpointSwapAdapter} from "./interfaces/ISetpointSwapAdapter.sol";

/// @notice Wallet-owned Setpoint execution vault for Robinhood Chain testnet.
contract SetpointSandboxVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant WAD = 1e18;
    uint256 public constant MAX_ASSET_WEIGHT = 70e16;

    struct Trade {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
    }

    address public immutable owner;
    address public immutable factory;
    address public immutable baseAsset;
    ISetpointOracle public immutable oracle;
    ISetpointSwapAdapter public immutable swapAdapter;
    address[] private _assets;
    mapping(address => bool) public isAsset;
    mapping(address => uint256) public targetWeight;
    uint256 public cashTarget;

    uint256 public immutable driftThreshold;
    uint256 public immutable maxTradeFraction;
    uint256 public immutable slippageTolerance;
    uint256 public immutable maxPriceAge;
    uint256 public immutable maxRebalanceLoss;

    error NotOwner();
    error BadWeights();
    error UnsupportedAsset(address token);
    error StalePrice(address token);
    error TradeTooLarge();
    error SlippageTooLoose();
    error DriftBelowThreshold();
    error DriftNotImproved();
    error ExcessiveValueLoss();
    error EmptyTrades();

    event TargetsUpdated(address indexed owner, uint256 cashTarget, address[] assets, uint256[] weights);
    event Rebalanced(
        address indexed owner,
        uint256 driftBefore,
        uint256 driftAfter,
        uint256 navBefore,
        uint256 navAfter,
        uint256 legs
    );

    constructor(
        address owner_,
        address baseAsset_,
        ISetpointOracle oracle_,
        ISetpointSwapAdapter swapAdapter_,
        address[] memory assets_,
        uint256[] memory weights_,
        uint256 cashTarget_
    ) {
        require(owner_ != address(0) && assets_.length >= 3 && assets_.length <= 5, "bad config");
        owner = owner_;
        factory = msg.sender;
        baseAsset = baseAsset_;
        oracle = oracle_;
        swapAdapter = swapAdapter_;
        driftThreshold = 2e16;
        maxTradeFraction = 30e16;
        slippageTolerance = 3e16;
        maxPriceAge = 24 hours;
        maxRebalanceLoss = 2e16;
        _setTargets(assets_, weights_, cashTarget_);
        for (uint256 i; i < assets_.length; ++i) {
            _assets.push(assets_[i]);
            isAsset[assets_[i]] = true;
        }
    }

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    function assets() external view returns (address[] memory) {
        return _assets;
    }

    function setTargets(uint256[] calldata weights, uint256 cashTarget_) external onlyOwner {
        _setTargets(_assets, weights, cashTarget_);
        emit TargetsUpdated(owner, cashTarget_, _assets, weights);
    }

    function totalAssets() public view returns (uint256 nav) {
        nav = IERC20(baseAsset).balanceOf(address(this));
        for (uint256 i; i < _assets.length; ++i) {
            nav += _value(_assets[i], IERC20(_assets[i]).balanceOf(address(this)));
        }
    }

    function totalDrift() public view returns (uint256) {
        uint256 nav = totalAssets();
        if (nav == 0) return 0;
        uint256 raw = _abs(IERC20(baseAsset).balanceOf(address(this)) * WAD / nav, cashTarget);
        for (uint256 i; i < _assets.length; ++i) {
            address token = _assets[i];
            raw += _abs(_value(token, IERC20(token).balanceOf(address(this))) * WAD / nav, targetWeight[token]);
        }
        return raw / 2;
    }

    function rebalance(Trade[] calldata trades) external onlyOwner nonReentrant {
        if (trades.length == 0) revert EmptyTrades();
        uint256 navBefore = totalAssets();
        uint256 driftBefore = totalDrift();
        if (driftBefore <= driftThreshold) revert DriftBelowThreshold();
        uint256 maxTradeValue = navBefore * maxTradeFraction / WAD;
        for (uint256 i; i < trades.length; ++i) {
            Trade calldata trade = trades[i];
            _validateRoute(trade.tokenIn, trade.tokenOut);
            uint256 valueIn = trade.tokenIn == baseAsset ? trade.amountIn : _value(trade.tokenIn, trade.amountIn);
            if (valueIn > maxTradeValue) revert TradeTooLarge();
            uint256 oracleOut = _oracleOut(trade.tokenIn, trade.tokenOut, trade.amountIn);
            if (trade.minAmountOut < oracleOut * (WAD - slippageTolerance) / WAD) revert SlippageTooLoose();
            IERC20(trade.tokenIn).forceApprove(address(swapAdapter), trade.amountIn);
            swapAdapter.swap(trade.tokenIn, trade.tokenOut, trade.amountIn, trade.minAmountOut);
        }
        uint256 driftAfter = totalDrift();
        if (driftAfter >= driftBefore) revert DriftNotImproved();
        uint256 navAfter = totalAssets();
        if (navAfter < navBefore * (WAD - maxRebalanceLoss) / WAD) revert ExcessiveValueLoss();
        emit Rebalanced(owner, driftBefore, driftAfter, navBefore, navAfter, trades.length);
    }

    function _setTargets(address[] memory assets_, uint256[] memory weights, uint256 cashTarget_) internal {
        if (assets_.length != weights.length || cashTarget_ > WAD) revert BadWeights();
        uint256 sum = cashTarget_;
        for (uint256 i; i < weights.length; ++i) {
            if (weights[i] > MAX_ASSET_WEIGHT) revert BadWeights();
            if (_assets.length != 0 && !isAsset[assets_[i]]) revert UnsupportedAsset(assets_[i]);
            targetWeight[assets_[i]] = weights[i];
            sum += weights[i];
        }
        if (sum != WAD) revert BadWeights();
        cashTarget = cashTarget_;
    }

    function _validateRoute(address tokenIn, address tokenOut) internal view {
        if (!((tokenIn == baseAsset && isAsset[tokenOut]) || (tokenOut == baseAsset && isAsset[tokenIn]))) {
            revert UnsupportedAsset(tokenIn == baseAsset ? tokenOut : tokenIn);
        }
    }

    function _value(address token, uint256 amount) internal view returns (uint256) {
        (uint256 price, uint256 updatedAt) = oracle.getPrice(token);
        if (block.timestamp > updatedAt && block.timestamp - updatedAt > maxPriceAge) revert StalePrice(token);
        return amount * price / WAD;
    }

    function _oracleOut(address tokenIn, address tokenOut, uint256 amountIn) internal view returns (uint256) {
        uint256 valueIn = tokenIn == baseAsset ? amountIn : _value(tokenIn, amountIn);
        if (tokenOut == baseAsset) return valueIn;
        (uint256 priceOut, uint256 updatedAt) = oracle.getPrice(tokenOut);
        if (block.timestamp > updatedAt && block.timestamp - updatedAt > maxPriceAge) revert StalePrice(tokenOut);
        return valueIn * WAD / priceOut;
    }

    function _abs(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : b - a;
    }

    function _checkOwner() internal view {
        if (msg.sender != owner) revert NotOwner();
    }
}
