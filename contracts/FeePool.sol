// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @title FeePool
/// @notice Holds USDC collected from YieldVault deposits (0.10% per deposit).
///         Only YieldVault can call deposit(). Only the Orchestrator can call payAgent().
///         Payment authority moved from on-chain engine to off-chain Orchestrator,
///         which applies LLM verification before releasing funds.
contract FeePool {

    address public owner;
    IERC20  public immutable usdc;
    address public orchestrator;
    address public vault;

    uint256 public totalCollected;
    uint256 public totalPaidOut;

    uint256 public constant MIN_RESERVE = 10_000_000; // 10 USDC

    event FeeReceived(uint256 amount, uint256 newTotal);
    event AgentPaid(address indexed devWallet, uint256 amount, uint256 jobId, uint256 remaining);
    event OrchestratorSet(address indexed orchestrator);
    event VaultSet(address indexed vault);

    constructor(address _usdc) {
        require(_usdc != address(0), "FeePool: zero usdc");
        owner = msg.sender;
        usdc  = IERC20(_usdc);
    }

    modifier onlyOwner()         { require(msg.sender == owner,        "FeePool: not owner");        _; }
    modifier onlyOrchestrator()  { require(msg.sender == orchestrator, "FeePool: not orchestrator"); _; }
    modifier onlyVault()         { require(msg.sender == vault,        "FeePool: not vault");        _; }

    function setOrchestrator(address _orchestrator) external onlyOwner {
        require(_orchestrator != address(0), "FeePool: zero orchestrator");
        orchestrator = _orchestrator;
        emit OrchestratorSet(_orchestrator);
    }

    function setVault(address _vault) external onlyOwner {
        require(_vault != address(0), "FeePool: zero vault");
        vault = _vault;
        emit VaultSet(_vault);
    }

    /// @notice Called by YieldVault on each user deposit to fund the pool.
    ///         Vault must approve this contract for the fee amount before calling.
    function deposit(uint256 amount) external onlyVault {
        bool ok = usdc.transferFrom(msg.sender, address(this), amount);
        require(ok, "FeePool: transfer failed");
        totalCollected += amount;
        emit FeeReceived(amount, usdc.balanceOf(address(this)));
    }

    /// @notice Pay a winning agent's developer wallet.
    ///         Only the Orchestrator can call this — after LLM verification passes.
    function payAgent(
        address devWallet,
        uint256 amount,
        uint256 jobId
    ) external onlyOrchestrator {
        require(devWallet != address(0),                "FeePool: zero devWallet");
        require(amount > 0,                             "FeePool: zero amount");
        require(usdc.balanceOf(address(this)) >= amount,"FeePool: insufficient balance");
        require(
            usdc.balanceOf(address(this)) - amount >= MIN_RESERVE,
            "FeePool: would breach minimum reserve"
        );

        usdc.transfer(devWallet, amount);
        totalPaidOut += amount;

        emit AgentPaid(devWallet, amount, jobId, usdc.balanceOf(address(this)));
    }

    function getBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function isAboveReserve() external view returns (bool) {
        return usdc.balanceOf(address(this)) > MIN_RESERVE;
    }
}
