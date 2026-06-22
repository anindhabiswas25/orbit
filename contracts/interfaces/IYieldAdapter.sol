// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IYieldAdapter
/// @notice Standard interface all protocol adapters must implement.
///         YieldVault and agents ONLY call these four functions.
///         Adapters MUST revert on failure — never return false silently.
///
/// @dev    SECURITY: All state-changing functions must restrict caller to vault address.
///         Use a constructor-set immutable vault address and onlyVault modifier.
///
/// @dev    DECIMALS: USDC uses 6 decimal places on Avalanche.
///         100 USDC = 100_000_000 (1e8). APY in basis points. 620 = 6.20%.
interface IYieldAdapter {

    /// @notice Deposit USDC into the underlying DeFi protocol.
    /// @dev    Caller must have approved this contract to spend `amount` USDC.
    ///         Only callable by the YieldVault (enforced via onlyVault modifier).
    /// @param  amount Amount of USDC in 6-decimal units (e.g., 100e6 = 100 USDC)
    function deposit(uint256 amount) external;

    /// @notice Withdraw USDC from the underlying DeFi protocol back to the vault.
    /// @dev    Transfers USDC to msg.sender (the vault). Only callable by the YieldVault.
    /// @param  amount Amount of USDC in 6-decimal units to withdraw
    function withdraw(uint256 amount) external;

    /// @notice Returns current supply APY in basis points.
    /// @dev    Must read directly from on-chain protocol state. No off-chain oracle calls.
    ///         Must return 0 if protocol is paused or APY is unavailable. Never revert.
    ///         620 = 6.20% APY. 1800 = 18.00% APY. 10000 = 100.00% APY.
    /// @return APY in basis points as uint256
    function getAPY() external view returns (uint256);

    /// @notice Returns the USDC balance held by this adapter on behalf of the vault.
    /// @dev    For AAVE: returns aUSDC balance of this contract.
    ///         For Benqi: calls balanceOfUnderlying(address(this)).
    ///         For MockPool: returns internal _balance tracking variable.
    /// @return Balance in USDC 6-decimal units
    function getBalance() external view returns (uint256);

    /// @notice Human-readable protocol name for UI display.
    /// @dev    Must be a pure function (no state reads). Max 32 characters.
    /// @return Name string, e.g. "AAVE V3", "Benqi", "MockPoolA"
    function protocolName() external pure returns (string memory);
}
