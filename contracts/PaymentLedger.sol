// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PaymentLedger
/// @notice Permanent on-chain record of every payment settlement.
///         Serves as the double-payment guard — Orchestrator checks
///         isPaid(jobId) before calling FeePool.payAgent().
///         Also serves as the public audit trail — anyone can verify
///         that a specific job was paid, when, and how much.
contract PaymentLedger {

    address public owner;
    address public orchestrator;

    struct Settlement {
        uint256 jobId;
        address agentWallet;
        address devWallet;
        uint256 amount;
        bytes32 paymentTxHash;
        uint256 settledAt;
        string  llmReasoning;
        uint8   agentType;
    }

    mapping(uint256 => Settlement) public settlements;
    mapping(address => uint256) public totalEarnedBy;
    uint256[] public settledJobIds;

    event PaymentSettled(
        uint256 indexed jobId,
        address indexed devWallet,
        uint256 amount,
        bytes32 paymentTxHash,
        string  reasoning
    );
    event OrchestratorSet(address indexed orchestrator);

    constructor() { owner = msg.sender; }

    modifier onlyOwner()        { require(msg.sender == owner,        "Ledger: not owner");        _; }
    modifier onlyOrchestrator() { require(msg.sender == orchestrator, "Ledger: not orchestrator"); _; }

    function setOrchestrator(address _orc) external onlyOwner {
        require(_orc != address(0), "Ledger: zero address");
        orchestrator = _orc;
        emit OrchestratorSet(_orc);
    }

    function settle(
        uint256 jobId,
        address agentWallet,
        address devWallet,
        uint256 amount,
        bytes32 paymentTxHash,
        string calldata llmReasoning,
        uint8   agentType
    ) external onlyOrchestrator {
        require(!isPaid(jobId), "Ledger: job already settled");
        require(devWallet != address(0), "Ledger: zero devWallet");
        require(amount > 0,              "Ledger: zero amount");

        settlements[jobId] = Settlement({
            jobId:         jobId,
            agentWallet:   agentWallet,
            devWallet:     devWallet,
            amount:        amount,
            paymentTxHash: paymentTxHash,
            settledAt:     block.timestamp,
            llmReasoning:  llmReasoning,
            agentType:     agentType
        });

        totalEarnedBy[devWallet] += amount;
        settledJobIds.push(jobId);

        emit PaymentSettled(jobId, devWallet, amount, paymentTxHash, llmReasoning);
    }

    function isPaid(uint256 jobId) public view returns (bool) {
        return settlements[jobId].settledAt > 0;
    }

    function getSettlement(uint256 jobId) external view returns (Settlement memory) {
        return settlements[jobId];
    }

    function getTotalSettled() external view returns (uint256) {
        return settledJobIds.length;
    }

    function getSettledJobIds(uint256 from, uint256 count)
        external view returns (uint256[] memory)
    {
        uint256 end = from + count > settledJobIds.length
            ? settledJobIds.length : from + count;
        uint256[] memory result = new uint256[](end - from);
        for (uint256 i = from; i < end; i++) {
            result[i - from] = settledJobIds[i];
        }
        return result;
    }

    function getTotalEarnedBy(address devWallet) external view returns (uint256) {
        return totalEarnedBy[devWallet];
    }
}
