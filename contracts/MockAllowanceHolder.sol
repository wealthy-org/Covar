// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * Test double for the 0x AllowanceHolder + Settler pair (tests only, never deployed).
 *
 * exec(operator, token, amount, target, data) pulls `amount` of `token` from the
 * caller (as Settler does through AllowanceHolder.transferFrom) and pays out
 * `buyAmount` of `buyToken` to the caller, where data = abi.encode(buyToken,
 * buyAmount, pullAmount). pullAmount < amount simulates a partial fill; a
 * buyToken of address(0) makes the call revert like a failed route.
 */
interface IERC20T {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract MockAllowanceHolder {
    bool public reenter;
    address public reenterTarget;
    bytes public reenterData;

    function setReenter(address target, bytes calldata data) external {
        reenter = true;
        reenterTarget = target;
        reenterData = data;
    }

    function exec(address, address token, uint256, address payable, bytes calldata data) external payable returns (bytes memory) {
        (address buyToken, uint256 buyAmount, uint256 pullAmount) = abi.decode(data, (address, uint256, uint256));
        require(buyToken != address(0), "route failed");
        if (reenter) {
            (bool ok, bytes memory ret) = reenterTarget.call(reenterData);
            if (!ok) {
                assembly { revert(add(ret, 32), mload(ret)) }
            }
        }
        require(IERC20T(token).transferFrom(msg.sender, address(this), pullAmount), "pull");
        require(IERC20T(buyToken).transfer(msg.sender, buyAmount), "pay");
        return "";
    }
}
