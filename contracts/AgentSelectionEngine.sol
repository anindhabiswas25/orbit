// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentSelectionEngine
/// @notice The core of the Orbit Protocol. Assigns jobs to agents, verifies results,
///         pays on success, and slashes on failure. All job assignment is on-chain
///         and deterministic.
///
///         JOB LIFECYCLE (Scout):
///         triggerScoutCycle() → JobAssigned(Scout) → agent posts to YieldRegistry
///         → completeScoutJob() → engine verifies → pays agent → JobAssigned(Executor)
///
///         JOB LIFECYCLE (Executor):
///         JobAssigned(Executor) → agent calls completeExecutorJob(jobId, newAdapter)
///         → engine calls vault.rebalance(newAdapter) → logs to YieldRegistry → pays agent
///         If no rebalance: agent calls completeExecutorJobNoOp(jobId)
///
///         FAILURE PATH:
///         Agent misses deadline → expireJob() by anyone → agent slashed -1 rep → re-assigned

interface IAgentRegistry {
    enum AgentType   { Scout, Executor }
    enum AgentStatus { Active, Paused, Deregistered, Banned }

    struct Agent {
        address wallet;
        address developerWallet;
        AgentType   agentType;
        AgentStatus status;
        string  endpoint;
        uint256 fee;
        uint256 stake;
        int256  reputationScore;
        uint256 jobsCompleted;
        uint256 jobsFailed;
        uint256 registeredAt;
        uint256 registeredBlock;
    }

    function getEligibleScouts()    external view returns (address[] memory);
    function getEligibleExecutors() external view returns (address[] memory);
    function getAgent(address wallet) external view returns (Agent memory);
    function incrementReputation(address wallet) external;
    function decrementReputation(address wallet, uint256 penalty) external;
}

interface IYieldRegistry {
    function bestProtocol() external view returns (address);
    function bestAPY()      external view returns (uint256);
    function lastUpdated()  external view returns (uint256);
    function isAdapter(address) external view returns (bool);
    function activeProtocol() external view returns (address);
    function activeAPY()      external view returns (uint256);
    function logRebalance(
        address fromProtocol,
        address toProtocol,
        uint256 fromAPY,
        uint256 toAPY,
        uint256 amount
    ) external;
}

interface IYieldVault {
    function rebalance(address newAdapter) external;
    function getVaultBalance() external view returns (uint256);
}

interface IFeePool {
    function getBalance() external view returns (uint256);
}

interface IPaymentLedger {
    function isPaid(uint256 jobId) external view returns (bool);
}

contract AgentSelectionEngine {

    // ─── Constants ──────────────────────────────────────────────────────────
    uint256 public constant JOB_TIMEOUT_SECONDS = 90;
    uint256 public constant SCOUT_INTERVAL      = 60;
    uint256 public constant MAX_PAYMENT_USDC    = 100_000; // 0.10 USDC max per job

    // ─── Types ──────────────────────────────────────────────────────────────
    enum JobType   { Scout, Executor }
    enum JobStatus { Pending, Completed, Failed, Expired }

    struct Job {
        uint256   jobId;
        JobType   jobType;
        address   assignedAgent;
        uint256   assignedAt;
        uint256   deadline;
        JobStatus status;
    }

    // ─── State ──────────────────────────────────────────────────────────────
    address public owner;
    IAgentRegistry public registry;
    IYieldRegistry public yieldRegistry;
    IYieldVault    public vault;
    IFeePool       public feePool;
    IPaymentLedger public paymentLedger;

    uint256 public nextJobId;
    uint256 public lastScoutJobAt;

    mapping(uint256 => Job)     public jobs;
    mapping(address => uint256) public agentActiveJob; // 0 = no active job

    // Round-robin rotation indices so every eligible agent gets a turn
    uint256 public scoutRotation;
    uint256 public executorRotation;

    // ─── Events ─────────────────────────────────────────────────────────────
    event JobAssigned(uint256 indexed jobId, JobType jobType, address indexed agent, uint256 deadline);
    event JobCompleted(uint256 indexed jobId, address indexed agentWallet, address indexed devWallet, uint256 payment, uint8 agentType);
    event JobExpired(uint256 indexed jobId, address indexed timedOutAgent);
    event JobFailed(uint256 indexed jobId, address indexed agent, string reason);
    event JobNoOp(uint256 indexed jobId, address indexed agent);
    event ScoutCycleTriggered(uint256 timestamp);
    event ExecutorCycleTriggered(uint256 timestamp);
    event VaultSet(address indexed vault);

    // ─── Constructor ────────────────────────────────────────────────────────
    constructor(address _registry, address _yieldRegistry, address _feePool) {
        require(_registry      != address(0), "Engine: zero registry");
        require(_yieldRegistry != address(0), "Engine: zero yieldRegistry");
        require(_feePool       != address(0), "Engine: zero feePool");
        owner         = msg.sender;
        registry      = IAgentRegistry(_registry);
        yieldRegistry = IYieldRegistry(_yieldRegistry);
        feePool       = IFeePool(_feePool);
    }

    modifier onlyOwner() { require(msg.sender == owner, "Engine: not owner"); _; }

    function setVault(address _vault) external onlyOwner {
        require(_vault != address(0), "Engine: zero vault");
        vault = IYieldVault(_vault);
        emit VaultSet(_vault);
    }

    function setRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Engine: zero registry");
        registry = IAgentRegistry(_registry);
    }

    function setPaymentLedger(address _ledger) external onlyOwner {
        require(_ledger != address(0), "Engine: zero ledger");
        paymentLedger = IPaymentLedger(_ledger);
    }

    // ─── Job Scheduling ─────────────────────────────────────────────────────

    /// @notice Trigger a new scout cycle. Enforces SCOUT_INTERVAL between cycles.
    ///         Call from a keeper bot every 60 seconds.
    function triggerScoutCycle() external {
        require(
            block.timestamp >= lastScoutJobAt + SCOUT_INTERVAL,
            "Engine: too soon since last scout"
        );
        lastScoutJobAt = block.timestamp;
        emit ScoutCycleTriggered(block.timestamp);
        _assignJob(JobType.Scout);
    }

    /// @notice Trigger an executor cycle. Called automatically by completeScoutJob().
    function triggerExecutorCycle() external {
        emit ExecutorCycleTriggered(block.timestamp);
        _assignJob(JobType.Executor);
    }

    // ─── Job Completion ──────────────────────────────────────────────────────

    /// @notice Called by the winning scout after posting result to YieldRegistry.
    ///         Engine verifies result on-chain, pays, rewards reputation, auto-triggers executor.
    function completeScoutJob(uint256 jobId) external {
        Job storage job = jobs[jobId];
        require(job.assignedAgent == msg.sender, "Engine: not your job");
        require(job.jobType == JobType.Scout,    "Engine: wrong job type");
        require(job.status == JobStatus.Pending, "Engine: job not pending");
        require(block.timestamp <= job.deadline, "Engine: job deadline passed");

        address bestProtocol = yieldRegistry.bestProtocol();
        uint256 bestAPY      = yieldRegistry.bestAPY();
        uint256 lastUpdated  = yieldRegistry.lastUpdated();

        if (bestProtocol == address(0)) {
            _failJob(job, jobId, msg.sender, "no_result_posted", 2);
            return;
        }
        if (!yieldRegistry.isAdapter(bestProtocol)) {
            _failJob(job, jobId, msg.sender, "invalid_adapter_posted", 2);
            return;
        }
        if (bestAPY == 0) {
            _failJob(job, jobId, msg.sender, "zero_apy_posted", 2);
            return;
        }
        if (lastUpdated < job.assignedAt) {
            _failJob(job, jobId, msg.sender, "result_too_old", 2);
            return;
        }

        job.status = JobStatus.Completed;
        agentActiveJob[msg.sender] = 0;
        _rewardAgent(msg.sender, jobId);

        // Only engage an executor when the scout's posted best protocol differs
        // from where the vault's funds currently sit — i.e. there is an actual
        // rebalance opportunity to act on. When the vault is already on the best
        // protocol, spawning an executor job would only ever no-op, so we skip
        // it. The executor still applies its own spread threshold on top of this.
        if (bestProtocol != yieldRegistry.activeProtocol()) {
            _assignJob(JobType.Executor);
        }
    }

    /// @notice Called by executor to complete job WITH rebalance.
    ///         Engine atomically: verifies → rebalances → logs → pays.
    ///         Use this when spread > threshold and rebalance is needed.
    /// @param jobId     The job ID assigned to this executor
    /// @param newAdapter The best adapter address to rebalance to
    function completeExecutorJob(uint256 jobId, address newAdapter) external {
        Job storage job = jobs[jobId];
        require(job.assignedAgent == msg.sender,  "Engine: not your job");
        require(job.jobType == JobType.Executor,  "Engine: wrong job type");
        require(job.status == JobStatus.Pending,  "Engine: job not pending");
        require(block.timestamp <= job.deadline,  "Engine: job deadline passed");
        require(newAdapter != address(0),          "Engine: zero adapter");
        require(yieldRegistry.isAdapter(newAdapter), "Engine: adapter not registered");
        require(address(vault) != address(0),      "Engine: vault not set");

        // Verify the agent picked the current best protocol
        require(
            yieldRegistry.bestProtocol() == newAdapter,
            "Engine: newAdapter is not best protocol"
        );

        // Capture state before rebalance for logging
        address fromProtocol = yieldRegistry.activeProtocol();
        uint256 fromAPY      = yieldRegistry.activeAPY();
        uint256 toAPY        = yieldRegistry.bestAPY();
        uint256 balance      = vault.getVaultBalance();

        job.status = JobStatus.Completed;
        agentActiveJob[msg.sender] = 0;

        // Execute rebalance atomically
        vault.rebalance(newAdapter);

        // Log rebalance on-chain
        yieldRegistry.logRebalance(fromProtocol, newAdapter, fromAPY, toAPY, balance);

        _rewardAgent(msg.sender, jobId);
    }

    /// @notice Called by executor when no rebalance is needed (spread too low, or already on best).
    ///         Closes the job WITHOUT paying or rewarding: a no-op moved no
    ///         funds, so the executor earns neither a payment nor reputation
    ///         (and is not slashed — declining a sub-threshold move is correct).
    /// @param jobId The job ID assigned to this executor
    function completeExecutorJobNoOp(uint256 jobId) external {
        Job storage job = jobs[jobId];
        require(job.assignedAgent == msg.sender,  "Engine: not your job");
        require(job.jobType == JobType.Executor,  "Engine: wrong job type");
        require(job.status == JobStatus.Pending,  "Engine: job not pending");
        require(block.timestamp <= job.deadline,  "Engine: job deadline passed");

        job.status = JobStatus.Completed;
        agentActiveJob[msg.sender] = 0;
        emit JobNoOp(jobId, msg.sender);
    }

    /// @notice Expire a timed-out job. Callable by anyone after deadline.
    ///         Slashes assigned agent -1 reputation. Re-assigns job to next agent.
    function expireJob(uint256 jobId) external {
        Job storage job = jobs[jobId];
        require(job.status == JobStatus.Pending,  "Engine: job not pending");
        require(block.timestamp > job.deadline,    "Engine: deadline not passed");

        address timedOut = job.assignedAgent;
        job.status = JobStatus.Expired;
        agentActiveJob[timedOut] = 0;

        registry.decrementReputation(timedOut, 1);
        emit JobExpired(jobId, timedOut);

        _assignJob(job.jobType);
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    function _assignJob(JobType jobType) internal {
        address[] memory eligible = jobType == JobType.Scout
            ? registry.getEligibleScouts()
            : registry.getEligibleExecutors();

        if (eligible.length == 0) return;

        // Merit-based selection (winner-takes-all): the eligible list is sorted
        // by reputation descending, ties broken by earlier registration block, so
        // the single BEST agent wins every job and earns the payout. We only fall
        // through to the next-best agent if the top one is already mid-job, so the
        // top agent is never blocked by a stale busy slot.
        address winner;
        for (uint256 i; i < eligible.length; i++) {
            if (agentActiveJob[eligible[i]] == 0) {
                winner = eligible[i];
                break;
            }
        }
        if (winner == address(0)) return;

        uint256 jobId    = ++nextJobId;
        uint256 deadline = block.timestamp + JOB_TIMEOUT_SECONDS;

        jobs[jobId] = Job({
            jobId:         jobId,
            jobType:       jobType,
            assignedAgent: winner,
            assignedAt:    block.timestamp,
            deadline:      deadline,
            status:        JobStatus.Pending
        });

        agentActiveJob[winner] = jobId;

        emit JobAssigned(jobId, jobType, winner, deadline);
    }

    function _failJob(
        Job storage job,
        uint256 jobId,
        address agent,
        string memory reason,
        uint256 penalty
    ) internal {
        job.status = JobStatus.Failed;
        agentActiveJob[agent] = 0;
        registry.decrementReputation(agent, penalty);
        emit JobFailed(jobId, agent, reason);
    }

    function _rewardAgent(address agentWallet, uint256 jobId) internal {
        IAgentRegistry.Agent memory agent = registry.getAgent(agentWallet);

        uint256 payment;
        if (address(vault) != address(0)) {
            uint256 vaultBalance = vault.getVaultBalance();
            payment = (vaultBalance * agent.fee) / 10_000;
            if (payment > MAX_PAYMENT_USDC) payment = MAX_PAYMENT_USDC;
        }

        registry.incrementReputation(agentWallet);

        emit JobCompleted(
            jobId,
            agentWallet,
            agent.developerWallet,
            payment,
            uint8(agent.agentType)
        );
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function getJob(uint256 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }

    function getAgentActiveJob(address wallet) external view returns (uint256) {
        return agentActiveJob[wallet];
    }
}
