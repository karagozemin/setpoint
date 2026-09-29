// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SetpointSandboxToken} from "../src/SetpointSandboxToken.sol";
import {SetpointSandboxOracle} from "../src/SetpointSandboxOracle.sol";
import {SetpointSandboxPool} from "../src/SetpointSandboxPool.sol";
import {SetpointSandboxSwapAdapter} from "../src/SetpointSandboxSwapAdapter.sol";
import {SetpointSandboxFactory} from "../src/SetpointSandboxFactory.sol";

contract DeploySandbox is Script {
    function run() external {
        uint256 key = vm.envUint("SETPOINT_SANDBOX_DEPLOYER_KEY");
        address deployer = vm.addr(key);
        address updater = vm.envOr("SETPOINT_SANDBOX_ORACLE_UPDATER", deployer);
        vm.startBroadcast(key);

        SetpointSandboxToken base = new SetpointSandboxToken("Setpoint Sandbox USDG", "sUSDG", deployer);
        SetpointSandboxToken[] memory risk = new SetpointSandboxToken[](4);
        risk[0] = new SetpointSandboxToken("Setpoint Sandbox Alpha", "sALPHA", deployer);
        risk[1] = new SetpointSandboxToken("Setpoint Sandbox Beta", "sBETA", deployer);
        risk[2] = new SetpointSandboxToken("Setpoint Sandbox Gamma", "sGAMMA", deployer);
        risk[3] = new SetpointSandboxToken("Setpoint Sandbox Delta", "sDELTA", deployer);

        SetpointSandboxOracle oracle = new SetpointSandboxOracle(deployer, updater);
        address[] memory pricedTokens = new address[](5);
        uint256[] memory prices = new uint256[](5);
        pricedTokens[0] = address(base);
        prices[0] = 1e18;
        pricedTokens[1] = address(risk[0]);
        prices[1] = 180e18;
        pricedTokens[2] = address(risk[1]);
        prices[2] = 240e18;
        pricedTokens[3] = address(risk[2]);
        prices[3] = 420e18;
        pricedTokens[4] = address(risk[3]);
        prices[4] = 150e18;
        oracle.setPrices(pricedTokens, prices);

        SetpointSandboxSwapAdapter adapter = new SetpointSandboxSwapAdapter(address(base), deployer);
        address[] memory assets = new address[](4);
        SetpointSandboxPool[] memory pools = new SetpointSandboxPool[](4);
        // The aggregate 320,000 sUSDG seed budget is less than 0.64% of each
        // pool's base depth, keeping even worst-case aggregate flow within the
        // vault's 3% oracle-output floor.
        uint256[4] memory depths = [uint256(50_000_000e18), 50_000_000e18, 50_000_000e18, 50_000_000e18];
        for (uint256 i; i < 4; ++i) {
            assets[i] = address(risk[i]);
            pools[i] = new SetpointSandboxPool(address(base), address(risk[i]), 30, deployer);
            pools[i].setAdapter(address(adapter));
            adapter.registerPool(address(risk[i]), address(pools[i]));
            uint256 riskDepth = depths[i] * 1e18 / prices[i + 1];
            base.mint(deployer, depths[i]);
            risk[i].mint(deployer, riskDepth);
            base.approve(address(pools[i]), depths[i]);
            risk[i].approve(address(pools[i]), riskDepth);
            pools[i].addLiquidity(depths[i], riskDepth);
        }

        SetpointSandboxFactory factory = new SetpointSandboxFactory(address(base), oracle, adapter, assets);
        base.setMinter(address(factory));
        for (uint256 i; i < 4; ++i) {
            risk[i].setMinter(address(factory));
        }
        vm.stopBroadcast();

        console2.log("deployer", deployer);
        console2.log("factory", address(factory));
        console2.log("oracle", address(oracle));
        console2.log("adapter", address(adapter));
        console2.log("base", address(base));
        for (uint256 i; i < 4; ++i) {
            console2.log("asset", i, assets[i]);
            console2.log("pool", i, address(pools[i]));
        }
    }
}
