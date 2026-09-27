// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

/// @notice Testnet-only asset. Minting is restricted to the deployment owner and,
/// after setup, the Setpoint factory. It has no production value or redemption claim.
contract SetpointSandboxToken is ERC20, Ownable {
    address public minter;

    error NotMinter();
    event MinterUpdated(address indexed minter);

    constructor(string memory name_, string memory symbol_, address owner_) ERC20(name_, symbol_) Ownable(owner_) {
        minter = owner_;
    }

    function setMinter(address nextMinter) external onlyOwner {
        require(nextMinter != address(0), "zero minter");
        minter = nextMinter;
        emit MinterUpdated(nextMinter);
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter();
        _mint(to, amount);
    }
}
