// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IYieldAdapter.sol";

interface IERC20 {
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface IFeePool {
    function deposit(uint256 amount) external;
}

/// @title YieldVault
/// @notice Holds all user USDC. Issues proportional shares on deposit.
///         Routes USDC through adapters. Collects 0.10% protocol fee on deposits.
///         Only AgentSelectionEngine can call rebalance().
contract YieldVault {

    uint256 public constant PROTOCOL_FEE_BPS = 10; // 0.10% of each deposit

    address public owner;
    IERC20  public immutable usdc;
    address public selectionEngine;
    IFeePool public feePool;

    // Reentrancy guard (1 = unlocked, 2 = locked)
    uint256 private _lock = 1;

    // Share accounting. Vault value is measured live via totalAssets()
    // (idle USDC + the active adapter's balance), so accrued yield in the
    // adapter is automatically reflected in share value and withdrawals.
    mapping(address => uint256) public userShares;
    uint256 public totalShares;

    // User yield policy
    struct Policy {
        uint256 threshold;
        bool    active;
    }
    mapping(address => Policy) public userPolicy;

    // Current active adapter
    address public currentAdapter;

    // ─── Events ─────────────────────────────────────────────────────────────
    event Deposited(address indexed user, uint256 net, uint256 fee, uint256 shares);
    event Withdrawn(address indexed user, uint256 amount, uint256 shares);
    event Rebalanced(address indexed fromAdapter, address indexed toAdapter, uint256 amount);
    event PolicySet(address indexed user, uint256 threshold);

    constructor(address _usdc, address _engine, address _feePool) {
        require(_usdc    != address(0), "Vault: zero usdc");
        require(_engine  != address(0), "Vault: zero engine");
        require(_feePool != address(0), "Vault: zero feePool");
        owner           = msg.sender;
        usdc            = IERC20(_usdc);
        selectionEngine = _engine;
        feePool         = IFeePool(_feePool);
    }

    modifier onlyOwner()  { require(msg.sender == owner,           "Vault: not owner");  _; }
    modifier onlyEngine() { require(msg.sender == selectionEngine, "Vault: not engine"); _; }

    function setEngine(address _engine) external onlyOwner {
        require(_engine != address(0), "Vault: zero engine");
        selectionEngine = _engine;
    }
    modifier nonReentrant() {
        require(_lock == 1, "Vault: reentrant call");
        _lock = 2;
        _;
        _lock = 1;
    }

    // ─── User Actions ───────────────────────────────────────────────────────

    /// @notice Deposit USDC into the vault.
    ///         0.10% goes to FeePool. Remaining credited as shares against
    ///         the vault's live asset value (so existing depositors keep any
    ///         yield already accrued in the active adapter).
    function deposit(uint256 amount) external nonReentrant {
        require(amount >= 1_000_000, "Vault: minimum deposit 1 USDC");

        // Snapshot live assets BEFORE pulling the new funds in.
        uint256 assetsBefore = totalAssets();

        require(usdc.transferFrom(msg.sender, address(this), amount), "Vault: deposit transfer failed");

        uint256 fee = (amount * PROTOCOL_FEE_BPS) / 10_000;
        uint256 net = amount - fee;

        usdc.approve(address(feePool), fee);
        feePool.deposit(fee);

        uint256 shares;
        if (totalShares == 0) {
            shares = net;
        } else {
            shares = (net * totalShares) / assetsBefore;
        }

        userShares[msg.sender] += shares;
        totalShares            += shares;

        // Deploy immediately if adapter is already active
        if (currentAdapter != address(0)) {
            usdc.approve(currentAdapter, net);
            IYieldAdapter(currentAdapter).deposit(net);
        }

        emit Deposited(msg.sender, net, fee, shares);
    }

    /// @notice Withdraw USDC proportional to shares held, valued at the vault's
    ///         live asset value (principal + accrued yield).
    function withdraw(uint256 shares) external nonReentrant {
        require(userShares[msg.sender] >= shares, "Vault: insufficient shares");
        require(shares > 0,                        "Vault: zero shares");

        // Value the shares against live assets (idle + adapter balance) so
        // accrued yield is included in the payout.
        uint256 amount = (shares * totalAssets()) / totalShares;

        // Effects first (checks-effects-interactions): update accounting before
        // any external call so a misbehaving adapter/token cannot reenter.
        userShares[msg.sender] -= shares;
        totalShares            -= shares;

        // Interactions: cover the payout from idle USDC first, pull only the
        // shortfall from the active adapter.
        uint256 idle = usdc.balanceOf(address(this));
        if (amount > idle && currentAdapter != address(0)) {
            IYieldAdapter(currentAdapter).withdraw(amount - idle);
        }

        require(usdc.transfer(msg.sender, amount), "Vault: withdraw transfer failed");
        emit Withdrawn(msg.sender, amount, shares);
    }

    /// @notice Set yield policy. Called once by user after deposit.
    /// @param threshold Minimum APY spread in bps to trigger rebalance (e.g., 200 = 2%)
    function setPolicy(uint256 threshold) external {
        require(threshold > 0 && threshold <= 5000, "Vault: invalid threshold");
        userPolicy[msg.sender] = Policy({ threshold: threshold, active: true });
        emit PolicySet(msg.sender, threshold);
    }

    // ─── Engine Actions ──────────────────────────────────────────────────────

    /// @notice Rebalance vault to a new adapter. Only callable by Selection Engine.
    ///         Atomically withdraws from current adapter and deposits into new adapter.
    function rebalance(address newAdapter) external onlyEngine nonReentrant {
        require(newAdapter != address(0),     "Vault: zero adapter");
        require(newAdapter != currentAdapter, "Vault: already in this protocol");

        // Pull the FULL current adapter balance (principal + accrued yield) so
        // nothing is stranded, then redeploy everything held into the new one.
        if (currentAdapter != address(0)) {
            uint256 full = IYieldAdapter(currentAdapter).getBalance();
            if (full > 0) {
                IYieldAdapter(currentAdapter).withdraw(full);
            }
        }

        uint256 balance = usdc.balanceOf(address(this));
        usdc.approve(newAdapter, balance);
        IYieldAdapter(newAdapter).deposit(balance);

        address old    = currentAdapter;
        currentAdapter = newAdapter;

        emit Rebalanced(old, newAdapter, balance);
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    /// @notice Live value of everything the vault controls: idle USDC held by
    ///         the vault plus the active adapter's balance (which grows as the
    ///         underlying protocol accrues yield).
    function totalAssets() public view returns (uint256) {
        uint256 idle = usdc.balanceOf(address(this));
        uint256 deployed = currentAdapter == address(0)
            ? 0
            : IYieldAdapter(currentAdapter).getBalance();
        return idle + deployed;
    }

    function getUserBalance(address user) external view returns (uint256) {
        if (totalShares == 0) return 0;
        return (userShares[user] * totalAssets()) / totalShares;
    }

    function getVaultBalance()            external view returns (uint256) { return totalAssets(); }
    function getUserShares(address user)  external view returns (uint256) { return userShares[user]; }
    function getTotalShares()             external view returns (uint256) { return totalShares; }
    function getCurrentAdapter()          external view returns (address) { return currentAdapter; }
}
