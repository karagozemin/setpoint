// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {ISetpointOracle} from "./interfaces/ISetpointOracle.sol";

/// @notice Explicitly-operated sandbox oracle. Prices are WAD-denominated in sUSDG.
contract SetpointSandboxOracle is Ownable, ISetpointOracle {
    struct PriceData {
        uint256 priceWad;
        uint256 updatedAt;
    }

    mapping(address => PriceData) private _prices;
    address public updater;
    uint8 public constant decimals = 18;

    error NotUpdater();
    error InvalidPrice();
    error MissingPrice(address token);
    event UpdaterChanged(address indexed updater);
    event PriceUpdated(address indexed token, uint256 priceWad, uint256 updatedAt);

    constructor(address owner_, address updater_) Ownable(owner_) {
        require(updater_ != address(0), "zero updater");
        updater = updater_;
    }

    modifier onlyUpdater() {
        _checkUpdater();
        _;
    }

    function setUpdater(address nextUpdater) external onlyOwner {
        require(nextUpdater != address(0), "zero updater");
        updater = nextUpdater;
        emit UpdaterChanged(nextUpdater);
    }

    function setPrice(address token, uint256 priceWad) external onlyUpdater {
        _setPrice(token, priceWad);
    }

    function setPrices(address[] calldata tokens, uint256[] calldata prices) external onlyUpdater {
        require(tokens.length == prices.length, "length mismatch");
        for (uint256 i; i < tokens.length; ++i) {
            _setPrice(tokens[i], prices[i]);
        }
    }

    function getPrice(address token) external view returns (uint256 priceWad, uint256 updatedAt) {
        PriceData memory data = _prices[token];
        if (data.priceWad == 0) revert MissingPrice(token);
        return (data.priceWad, data.updatedAt);
    }

    function _setPrice(address token, uint256 priceWad) internal {
        if (token == address(0) || priceWad == 0) revert InvalidPrice();
        _prices[token] = PriceData({priceWad: priceWad, updatedAt: block.timestamp});
        emit PriceUpdated(token, priceWad, block.timestamp);
    }

    function _checkUpdater() internal view {
        if (msg.sender != updater && msg.sender != owner()) revert NotUpdater();
    }
}
