// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ISetpointSwapAdapter {
    function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256 amountOut);
    function poolFor(address token) external view returns (address);
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut)
        external
        returns (uint256 amountOut);
}
