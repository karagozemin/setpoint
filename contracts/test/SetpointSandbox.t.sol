// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {SetpointSandboxToken} from "../src/SetpointSandboxToken.sol";
import {SetpointSandboxOracle} from "../src/SetpointSandboxOracle.sol";
import {SetpointSandboxPool} from "../src/SetpointSandboxPool.sol";
import {SetpointSandboxSwapAdapter} from "../src/SetpointSandboxSwapAdapter.sol";
import {SetpointSandboxVault} from "../src/SetpointSandboxVault.sol";
import {SetpointSandboxFactory} from "../src/SetpointSandboxFactory.sol";

contract SetpointSandboxTest is Test {
    SetpointSandboxToken base;
    SetpointSandboxToken[4] risk;
    SetpointSandboxOracle oracle;
    SetpointSandboxSwapAdapter adapter;
    SetpointSandboxFactory factory;
    SetpointSandboxPool[4] pools;
    address user = makeAddr("user");
    address attacker = makeAddr("attacker");

    function setUp() public {
        base = new SetpointSandboxToken("Sandbox USDG", "sUSDG", address(this));
        risk[0] = new SetpointSandboxToken("Sandbox Alpha", "sALPHA", address(this));
        risk[1] = new SetpointSandboxToken("Sandbox Beta", "sBETA", address(this));
        risk[2] = new SetpointSandboxToken("Sandbox Gamma", "sGAMMA", address(this));
        risk[3] = new SetpointSandboxToken("Sandbox Delta", "sDELTA", address(this));
        oracle = new SetpointSandboxOracle(address(this), address(this));

        address[] memory tokens = new address[](5);
        uint256[] memory prices = new uint256[](5);
        tokens[0] = address(base);
        prices[0] = 1e18;
        tokens[1] = address(risk[0]);
        prices[1] = 100e18;
        tokens[2] = address(risk[1]);
        prices[2] = 200e18;
        tokens[3] = address(risk[2]);
        prices[3] = 400e18;
        tokens[4] = address(risk[3]);
        prices[4] = 50e18;
        oracle.setPrices(tokens, prices);

        adapter = new SetpointSandboxSwapAdapter(address(base), address(this));
        address[] memory assets = new address[](4);
        for (uint256 i; i < 4; ++i) {
            assets[i] = address(risk[i]);
            pools[i] = new SetpointSandboxPool(address(base), address(risk[i]), 30, address(this));
            pools[i].setAdapter(address(adapter));
            adapter.registerPool(address(risk[i]), address(pools[i]));

            uint256 baseDepth = 50_000_000e18;
            uint256 riskDepth = baseDepth * 1e18 / prices[i + 1];
            base.mint(address(this), baseDepth);
            risk[i].mint(address(this), riskDepth);
            base.approve(address(pools[i]), baseDepth);
            risk[i].approve(address(pools[i]), riskDepth);
            pools[i].addLiquidity(baseDepth, riskDepth);
        }

        factory = new SetpointSandboxFactory(address(base), oracle, adapter, assets);
        base.setMinter(address(factory));
        for (uint256 i; i < 4; ++i) {
            risk[i].setMinter(address(factory));
        }
    }

    function testFactoryCreatesOneFundedOwnerControlledVault() public {
        vm.prank(user);
        address vaultAddress = factory.createVault();
        SetpointSandboxVault vault = SetpointSandboxVault(vaultAddress);
        assertEq(factory.getVault(user), vaultAddress);
        assertEq(vault.owner(), user);
        assertEq(vault.totalAssets(), 10_000e18);
        assertGt(vault.totalDrift(), vault.driftThreshold());
        vm.expectRevert(abi.encodeWithSelector(SetpointSandboxFactory.VaultExists.selector, vaultAddress));
        vm.prank(user);
        factory.createVault();
    }

    function testDifferentWalletsConsumeBoundedGlobalSeedBudget() public {
        uint256 limit = factory.MAX_SEEDED_VAULTS();
        for (uint256 i; i < limit; ++i) {
            // casting to uint160 is safe because i is bounded by the 32-vault limit
            // forge-lint: disable-next-line(unsafe-typecast)
            address wallet = address(uint160(10_000 + i));
            vm.prank(wallet);
            address vaultAddress = factory.createVault();
            assertEq(SetpointSandboxVault(vaultAddress).owner(), wallet);
        }
        assertEq(factory.seededVaultCount(), limit);
        assertEq(factory.seededNav(), factory.MAX_SEEDED_NAV());

        vm.expectRevert(SetpointSandboxFactory.SeedBudgetExhausted.selector);
        vm.prank(address(99_999));
        factory.createVault();
    }

    function testVaultCreationDoesNotConsumePoolsAndBudgetCannotBreakQuotes() public {
        (uint256 baseBefore, uint256 riskBefore) = pools[3].reserves();
        vm.prank(user);
        factory.createVault();
        (uint256 baseAfter, uint256 riskAfter) = pools[3].reserves();
        assertEq(baseAfter, baseBefore);
        assertEq(riskAfter, riskBefore);

        uint256 aggregateBudget = factory.MAX_SEEDED_NAV();
        uint256 buyOut = pools[3].quote(address(base), aggregateBudget);
        uint256 sellAmount = aggregateBudget * 1e18 / 50e18;
        uint256 sellOut = pools[3].quote(address(risk[3]), sellAmount);
        assertGe(buyOut * 50, aggregateBudget * 97 / 100);
        assertGe(sellOut, aggregateBudget * 97 / 100);
    }

    function testOwnerStoresTargetsOnchain() public {
        vm.prank(user);
        SetpointSandboxVault vault = SetpointSandboxVault(factory.createVault());
        uint256[] memory weights = new uint256[](4);
        weights[0] = 25e16;
        weights[1] = 20e16;
        weights[2] = 15e16;
        weights[3] = 10e16;
        vm.prank(user);
        vault.setTargets(weights, 30e16);
        assertEq(vault.cashTarget(), 30e16);
        assertEq(vault.targetWeight(address(risk[0])), 25e16);
    }

    function testUnauthorizedWalletCannotChangeTargetsOrRebalance() public {
        vm.prank(user);
        SetpointSandboxVault vault = SetpointSandboxVault(factory.createVault());
        uint256[] memory weights = new uint256[](4);
        for (uint256 i; i < 4; ++i) {
            weights[i] = 20e16;
        }
        vm.expectRevert(SetpointSandboxVault.NotOwner.selector);
        vm.prank(attacker);
        vault.setTargets(weights, 20e16);
        SetpointSandboxVault.Trade[] memory trades = new SetpointSandboxVault.Trade[](1);
        vm.expectRevert(SetpointSandboxVault.NotOwner.selector);
        vm.prank(attacker);
        vault.rebalance(trades);
    }

    function testRealPoolSwapImprovesDrift() public {
        vm.prank(user);
        SetpointSandboxVault vault = SetpointSandboxVault(factory.createVault());
        uint256 beforeDrift = vault.totalDrift();
        uint256 amountIn = 1_500e18;
        uint256 quoted = adapter.quote(address(base), address(risk[3]), amountIn);
        uint256 oracleOut = amountIn * 1e18 / 50e18;
        SetpointSandboxVault.Trade[] memory trades = new SetpointSandboxVault.Trade[](1);
        trades[0] = SetpointSandboxVault.Trade(address(base), address(risk[3]), amountIn, oracleOut * 97 / 100);
        assertGe(quoted, trades[0].minAmountOut);
        vm.prank(user);
        vault.rebalance(trades);
        assertLt(vault.totalDrift(), beforeDrift);
        assertLt(base.balanceOf(address(vault)), 5_500e18);
        assertGt(risk[3].balanceOf(address(vault)), 6e18);
    }

    function testStaleOracleFailsClosed() public {
        vm.prank(user);
        SetpointSandboxVault vault = SetpointSandboxVault(factory.createVault());
        vm.warp(block.timestamp + 24 hours + 1);
        vm.expectRevert(abi.encodeWithSelector(SetpointSandboxVault.StalePrice.selector, address(risk[0])));
        vault.totalAssets();
    }

    function testOracleRejectsUnauthorizedUpdater() public {
        vm.expectRevert(SetpointSandboxOracle.NotUpdater.selector);
        vm.prank(attacker);
        oracle.setPrice(address(risk[0]), 101e18);
    }

    function testPermissionlessRefreshRenewsOnlyApprovedReferencePrices() public {
        (, uint256 beforeTimestamp) = oracle.getPrice(address(risk[0]));
        vm.warp(block.timestamp + 23 hours);
        address[] memory tokens = new address[](1);
        tokens[0] = address(risk[0]);
        vm.prank(attacker);
        oracle.refreshPrices(tokens);
        (uint256 price, uint256 afterTimestamp) = oracle.getPrice(address(risk[0]));
        assertEq(price, 100e18);
        assertEq(afterTimestamp, block.timestamp);
        assertGt(afterTimestamp, beforeTimestamp);

        vm.expectRevert(
            abi.encodeWithSelector(
                SetpointSandboxOracle.PriceImmutable.selector, address(risk[0]), uint256(100e18), uint256(101e18)
            )
        );
        oracle.setPrice(address(risk[0]), 101e18);
    }

    function testPermissionlessRefreshRejectsUnapprovedToken() public {
        address[] memory tokens = new address[](1);
        tokens[0] = makeAddr("unapproved");
        vm.expectRevert(abi.encodeWithSelector(SetpointSandboxOracle.MissingPrice.selector, tokens[0]));
        vm.prank(attacker);
        oracle.refreshPrices(tokens);
    }

    function testAdapterRejectsUnregisteredRiskToRiskRoute() public {
        vm.expectRevert(SetpointSandboxSwapAdapter.UnsupportedRoute.selector);
        adapter.quote(address(risk[0]), address(risk[1]), 1e18);
    }

    function testVaultRejectsTargetsThatDoNotSumToOneHundredPercent() public {
        vm.prank(user);
        SetpointSandboxVault vault = SetpointSandboxVault(factory.createVault());
        uint256[] memory weights = new uint256[](4);
        for (uint256 i; i < 4; ++i) {
            weights[i] = 10e16;
        }
        vm.expectRevert(SetpointSandboxVault.BadWeights.selector);
        vm.prank(user);
        vault.setTargets(weights, 20e16);
    }

    function testPoolProductDoesNotDecrease() public {
        vm.prank(user);
        SetpointSandboxVault vault = SetpointSandboxVault(factory.createVault());
        (uint256 reserve0Before, uint256 reserve1Before) = pools[3].reserves();
        uint256 amountIn = 500e18;
        uint256 oracleOut = amountIn * 1e18 / 50e18;
        SetpointSandboxVault.Trade[] memory trades = new SetpointSandboxVault.Trade[](1);
        trades[0] = SetpointSandboxVault.Trade(address(base), address(risk[3]), amountIn, oracleOut * 97 / 100);
        vm.prank(user);
        vault.rebalance(trades);
        (uint256 reserve0After, uint256 reserve1After) = pools[3].reserves();
        assertGe(reserve0After * reserve1After, reserve0Before * reserve1Before);
    }

    function testFuzzQuoteIsPositiveAndBelowReserve(uint96 rawAmount) public view {
        uint256 amount = bound(uint256(rawAmount), 1e12, 100_000e18);
        uint256 out = pools[0].quote(address(base), amount);
        (, uint256 reserveOut) = pools[0].reserves();
        assertGt(out, 0);
        assertLt(out, reserveOut);
    }
}
