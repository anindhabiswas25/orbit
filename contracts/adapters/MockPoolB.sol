// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IYieldAdapter.sol";

interface IERC20 {
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @title MockPoolB
/// @notice Demo yield pool with a settable APY that accrues yield over time.
///         Identical to MockPoolA — see it for the accrual model.
contract MockPoolB is IYieldAdapter {

    uint256 private constant SECONDS_PER_YEAR = 31_536_000;
    uint256 private constant BPS              = 10_000;

    address public immutable vault;
    address public immutable owner;
    IERC20  public immutable usdc;

    uint256 private _apy;            // basis points
    uint256 private _balance;        // realized USDC owed to the vault (principal + realized yield)
    uint256 private _reserve;        // owner-funded USDC available to pay future yield
    uint256 private _lastAccrualTs;  // timestamp yield was last realized

    event APYUpdated(uint256 oldAPY, uint256 newAPY, address setBy);
    event YieldReserveFunded(uint256 amount, uint256 newReserve);
    event YieldAccrued(uint256 amount, uint256 newBalance, uint256 newReserve);

    constructor(address _vault, address _usdc, uint256 initialAPY) {
        require(_vault != address(0), "MockPoolB: zero vault");
        require(_usdc  != address(0), "MockPoolB: zero usdc");
        vault  = _vault;
        owner  = msg.sender;
        usdc   = IERC20(_usdc);
        _apy   = initialAPY;
    }

    modifier onlyVault() { require(msg.sender == vault, "MockPoolB: only vault"); _; }
    modifier onlyOwner() { require(msg.sender == owner, "MockPoolB: only owner"); _; }

    // ─── Yield accrual ─────────────────────────────────────────────────────────

    function _pendingYield() internal view returns (uint256) {
        if (_lastAccrualTs == 0 || _balance == 0 || _apy == 0 || _reserve == 0) return 0;
        uint256 elapsed = block.timestamp - _lastAccrualTs;
        if (elapsed == 0) return 0;
        uint256 raw = (_balance * _apy * elapsed) / (BPS * SECONDS_PER_YEAR);
        return raw > _reserve ? _reserve : raw;
    }

    function _accrue() internal {
        uint256 p = _pendingYield();
        if (p > 0) {
            _balance += p;
            _reserve -= p;
            emit YieldAccrued(p, _balance, _reserve);
        }
        _lastAccrualTs = block.timestamp;
    }

    /// @notice Owner pre-funds the USDC reserve that yield is paid from.
    function fundYieldReserve(uint256 amount) external onlyOwner {
        _accrue();
        require(usdc.transferFrom(msg.sender, address(this), amount), "MockPoolB: reserve transfer failed");
        _reserve += amount;
        emit YieldReserveFunded(amount, _reserve);
    }

    function setAPY(uint256 newAPY) external onlyOwner {
        require(newAPY <= 50_000, "MockPoolB: APY capped at 500%");
        _accrue();
        emit APYUpdated(_apy, newAPY, msg.sender);
        _apy = newAPY;
    }

    /// @notice Instantly credit simulated yield (a lump sum, not time-based).
    function creditYield(uint256 amount) external onlyOwner {
        _accrue();
        require(usdc.transferFrom(msg.sender, address(this), amount), "MockPoolB: yield transfer failed");
        _balance += amount;
    }

    // ─── Vault interface ───────────────────────────────────────────────────────

    /// @inheritdoc IYieldAdapter
    function deposit(uint256 amount) external override onlyVault {
        _accrue();
        usdc.transferFrom(msg.sender, address(this), amount);
        _balance += amount;
    }

    /// @inheritdoc IYieldAdapter
    function withdraw(uint256 amount) external override onlyVault {
        _accrue();
        require(_balance >= amount, "MockPoolB: insufficient balance");
        _balance -= amount;
        usdc.transfer(msg.sender, amount);
    }

    /// @inheritdoc IYieldAdapter
    function getAPY() external view override returns (uint256) { return _apy; }

    /// @inheritdoc IYieldAdapter
    function getBalance() external view override returns (uint256) {
        return _balance + _pendingYield();
    }

    /// @notice Remaining USDC available to pay future yield.
    function getReserve() external view returns (uint256) { return _reserve; }

    /// @inheritdoc IYieldAdapter
    function protocolName() external pure override returns (string memory) { return "MockPoolB"; }
}
