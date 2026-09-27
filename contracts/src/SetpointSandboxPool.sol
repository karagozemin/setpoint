// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

/// @notice Minimal constant-product sUSDG/risk-asset pool with real token reserves.
/// Liquidity is deployment-managed; swaps are callable only through the route adapter.
contract SetpointSandboxPool is Ownable {
    using SafeERC20 for IERC20;

    address public immutable token0;
    address public immutable token1;
    uint16 public immutable feeBps;
    address public adapter;

    error UnsupportedToken();
    error NotAdapter();
    error AdapterAlreadySet();
    error InsufficientLiquidity();
    error Slippage();
    event AdapterSet(address indexed adapter);
    event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1);
    event Swap(address indexed sender, address indexed tokenIn, uint256 amountIn, uint256 amountOut, address recipient);

    constructor(address token0_, address token1_, uint16 feeBps_, address owner_) Ownable(owner_) {
        require(token0_ != address(0) && token1_ != address(0) && token0_ != token1_, "bad pair");
        require(feeBps_ <= 1000, "fee too high");
        token0 = token0_;
        token1 = token1_;
        feeBps = feeBps_;
    }

    function setAdapter(address adapter_) external onlyOwner {
        if (adapter != address(0)) revert AdapterAlreadySet();
        require(adapter_ != address(0), "zero adapter");
        adapter = adapter_;
        emit AdapterSet(adapter_);
    }

    function addLiquidity(uint256 amount0, uint256 amount1) external onlyOwner {
        IERC20(token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(token1).safeTransferFrom(msg.sender, address(this), amount1);
        emit LiquidityAdded(msg.sender, amount0, amount1);
    }

    function reserves() public view returns (uint256 reserve0, uint256 reserve1) {
        return (IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
    }

    function quote(address tokenIn, uint256 amountIn) external view returns (uint256 amountOut) {
        if (amountIn == 0) return 0;
        (uint256 reserve0, uint256 reserve1) = reserves();
        if (tokenIn == token0) return _amountOut(amountIn, reserve0, reserve1);
        if (tokenIn == token1) return _amountOut(amountIn, reserve1, reserve0);
        revert UnsupportedToken();
    }

    /// @dev The adapter transfers amountIn before calling. Pre-swap input reserve is
    /// reconstructed from the current balance, while output reserve is unchanged.
    function executeSwap(address tokenIn, uint256 amountIn, uint256 minAmountOut, address recipient)
        external
        returns (uint256 amountOut)
    {
        if (msg.sender != adapter) revert NotAdapter();
        address tokenOut;
        uint256 reserveIn;
        uint256 reserveOut;
        if (tokenIn == token0) {
            tokenOut = token1;
            reserveIn = IERC20(token0).balanceOf(address(this)) - amountIn;
            reserveOut = IERC20(token1).balanceOf(address(this));
        } else if (tokenIn == token1) {
            tokenOut = token0;
            reserveIn = IERC20(token1).balanceOf(address(this)) - amountIn;
            reserveOut = IERC20(token0).balanceOf(address(this));
        } else {
            revert UnsupportedToken();
        }
        amountOut = _amountOut(amountIn, reserveIn, reserveOut);
        if (amountOut < minAmountOut) revert Slippage();
        if (amountOut >= reserveOut) revert InsufficientLiquidity();
        IERC20(tokenOut).safeTransfer(recipient, amountOut);
        emit Swap(recipient, tokenIn, amountIn, amountOut, recipient);
    }

    function _amountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal view returns (uint256) {
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        uint256 amountInAfterFee = amountIn * (10_000 - feeBps);
        return amountInAfterFee * reserveOut / (reserveIn * 10_000 + amountInAfterFee);
    }
}
