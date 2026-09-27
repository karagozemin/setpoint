// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {SetpointSandboxPool} from "./SetpointSandboxPool.sol";
import {ISetpointSwapAdapter} from "./interfaces/ISetpointSwapAdapter.sol";

/// @notice Allows only direct sUSDG/risk routes through registered sandbox pools.
contract SetpointSandboxSwapAdapter is Ownable, ISetpointSwapAdapter {
    using SafeERC20 for IERC20;

    address public immutable baseAsset;
    mapping(address => address) public poolFor;

    error UnsupportedRoute();
    event PoolRegistered(address indexed asset, address indexed pool);

    constructor(address baseAsset_, address owner_) Ownable(owner_) {
        require(baseAsset_ != address(0), "zero base");
        baseAsset = baseAsset_;
    }

    function registerPool(address asset, address pool) external onlyOwner {
        require(asset != address(0) && pool != address(0), "zero address");
        SetpointSandboxPool candidate = SetpointSandboxPool(pool);
        bool pairMatches = (candidate.token0() == baseAsset && candidate.token1() == asset)
            || (candidate.token1() == baseAsset && candidate.token0() == asset);
        require(pairMatches, "pool mismatch");
        poolFor[asset] = pool;
        emit PoolRegistered(asset, pool);
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256 amountOut) {
        address pool = _pool(tokenIn, tokenOut);
        return SetpointSandboxPool(pool).quote(tokenIn, amountIn);
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut)
        external
        returns (uint256 amountOut)
    {
        address pool = _pool(tokenIn, tokenOut);
        IERC20(tokenIn).safeTransferFrom(msg.sender, pool, amountIn);
        return SetpointSandboxPool(pool).executeSwap(tokenIn, amountIn, minAmountOut, msg.sender);
    }

    function _pool(address tokenIn, address tokenOut) internal view returns (address pool) {
        if (tokenIn == baseAsset && tokenOut != baseAsset) pool = poolFor[tokenOut];
        else if (tokenOut == baseAsset && tokenIn != baseAsset) pool = poolFor[tokenIn];
        if (pool == address(0)) revert UnsupportedRoute();
    }
}
