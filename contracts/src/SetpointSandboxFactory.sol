// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ISetpointOracle} from "./interfaces/ISetpointOracle.sol";
import {ISetpointSwapAdapter} from "./interfaces/ISetpointSwapAdapter.sol";
import {SetpointSandboxToken} from "./SetpointSandboxToken.sol";
import {SetpointSandboxVault} from "./SetpointSandboxVault.sol";

/// @notice Creates exactly one funded sandbox vault per wallet.
contract SetpointSandboxFactory {
    uint256 public constant INITIAL_NAV = 10_000e18;
    uint256 public constant MAX_SEEDED_VAULTS = 32;
    uint256 public constant MAX_SEEDED_NAV = INITIAL_NAV * MAX_SEEDED_VAULTS;
    address public immutable baseAsset;
    ISetpointOracle public immutable oracle;
    ISetpointSwapAdapter public immutable swapAdapter;
    address[] private _assets;
    mapping(address => address) public getVault;
    uint256 public seededVaultCount;
    uint256 public seededNav;

    error VaultExists(address vault);
    error SeedBudgetExhausted();
    event VaultCreated(address indexed owner, address indexed vault, uint256 initialNav);

    constructor(
        address baseAsset_,
        ISetpointOracle oracle_,
        ISetpointSwapAdapter swapAdapter_,
        address[] memory assets_
    ) {
        require(assets_.length == 4, "four assets required");
        baseAsset = baseAsset_;
        oracle = oracle_;
        swapAdapter = swapAdapter_;
        _assets = assets_;
    }

    function assets() external view returns (address[] memory) {
        return _assets;
    }

    function createVault() external returns (address vaultAddress) {
        if (getVault[msg.sender] != address(0)) revert VaultExists(getVault[msg.sender]);
        if (seededVaultCount >= MAX_SEEDED_VAULTS) revert SeedBudgetExhausted();
        ++seededVaultCount;
        seededNav += INITIAL_NAV;
        uint256[] memory targets = new uint256[](4);
        for (uint256 i; i < 4; ++i) {
            targets[i] = 20e16;
        }
        SetpointSandboxVault vault =
            new SetpointSandboxVault(msg.sender, baseAsset, oracle, swapAdapter, _assets, targets, 20e16);
        vaultAddress = address(vault);
        getVault[msg.sender] = vaultAddress;

        // Deliberately drifted but bounded initial portfolio: 55% cash and
        // 25/10/7/3% risk assets. This creates a meaningful first rebalance.
        uint256[4] memory values = [uint256(2_500e18), 1_000e18, 700e18, 300e18];
        SetpointSandboxToken(baseAsset).mint(vaultAddress, 5_500e18);
        for (uint256 i; i < 4; ++i) {
            (uint256 price,) = oracle.getPrice(_assets[i]);
            SetpointSandboxToken(_assets[i]).mint(vaultAddress, values[i] * 1e18 / price);
        }
        emit VaultCreated(msg.sender, vaultAddress, INITIAL_NAV);
    }
}
