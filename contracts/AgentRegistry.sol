// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentRegistry
/// @notice Open on-chain registry for agent developers.
///
///         REGISTRATION:
///         Any developer can register a Scout or Executor agent by calling register()
///         with MIN_STAKE USDC approved. The stake is locked in this contract.
///
///         REPUTATION:
///         Only the AgentSelectionEngine can call incrementReputation() or decrementReputation().
///
///         SELECTION:
///         getEligibleScouts() and getEligibleExecutors() return agents sorted by
///         reputation descending with tie-breaking by earlier registration block.
///
///         SLASHING:
///         At score -5: agent paused, 1 USDC slashed from stake.
///         At score -10: agent banned, remaining stake slashed, wallet permanently banned.
///
///         ELIGIBILITY:
///         All active agents with stake > 0 are eligible for job assignment.
///         Reputation is a priority ranking, not a gate — new agents compete immediately.

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract AgentRegistry {

    // ─── Constants ──────────────────────────────────────────────────────────
    uint256 public constant MIN_STAKE         = 5_000_000;   // 5 USDC (6 decimals)
    uint256 public constant MAX_FEE_BPS       = 500;         // max 5% fee per job
    int256  public constant PAUSE_THRESHOLD   = -5;          // auto-pause score
    int256  public constant BAN_THRESHOLD     = -10;         // auto-ban score
    uint256 public constant PARTIAL_SLASH     = 1_000_000;   // 1 USDC slashed at pause
    // WARMUP_POOL_SIZE removed — reputation is priority, not a gate

    // ─── Enums ──────────────────────────────────────────────────────────────
    enum AgentType   { Scout, Executor }
    enum AgentStatus { Active, Paused, Deregistered, Banned }

    // ─── Structs ────────────────────────────────────────────────────────────
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

    // ─── State ──────────────────────────────────────────────────────────────
    address public owner;
    IERC20  public immutable usdc;
    address public selectionEngine;

    mapping(address => Agent)  public agents;
    address[] public scoutAgents;
    address[] public executorAgents;
    mapping(address => bool) public bannedWallets;

    // ─── Events ─────────────────────────────────────────────────────────────
    event AgentRegistered(address indexed wallet, AgentType agentType, uint256 fee, uint256 stake);
    event AgentDeregistered(address indexed wallet, uint256 stakeReturned);
    event AgentPaused(address indexed wallet, int256 score, uint256 slashAmount);
    event AgentBanned(address indexed wallet, uint256 slashAmount);
    event ReputationChanged(address indexed wallet, int256 oldScore, int256 newScore, string reason);
    event EngineSet(address indexed engine);

    // ─── Constructor ────────────────────────────────────────────────────────
    constructor(address _usdc) {
        require(_usdc != address(0), "Registry: zero usdc");
        owner = msg.sender;
        usdc  = IERC20(_usdc);
    }

    // ─── Modifiers ──────────────────────────────────────────────────────────
    modifier onlyOwner()  { require(msg.sender == owner,           "Registry: not owner");  _; }
    modifier onlyEngine() { require(msg.sender == selectionEngine, "Registry: not engine"); _; }

    // ─── Admin ──────────────────────────────────────────────────────────────
    function setSelectionEngine(address _engine) external onlyOwner {
        require(_engine != address(0), "Registry: zero address");
        selectionEngine = _engine;
        emit EngineSet(_engine);
    }

    // ─── Registration ───────────────────────────────────────────────────────

    /// @notice Register a new agent. Caller must approve MIN_STAKE USDC to this contract first.
    function register(
        AgentType agentType,
        string calldata endpoint,
        uint256 fee,
        address developerWallet
    ) external {
        require(!bannedWallets[msg.sender],              "Registry: wallet banned");
        require(agents[msg.sender].wallet == address(0), "Registry: already registered");
        require(fee <= MAX_FEE_BPS,                      "Registry: fee exceeds max");
        require(bytes(endpoint).length >= 10,            "Registry: endpoint too short");
        require(bytes(endpoint).length <= 256,           "Registry: endpoint too long");
        require(developerWallet != address(0),           "Registry: zero dev wallet");

        uint256 stakeAmount;
        if (agentType == AgentType.Executor) {
            bool transferred = usdc.transferFrom(msg.sender, address(this), MIN_STAKE);
            require(transferred, "Registry: stake transfer failed. Approve 5 USDC first");
            stakeAmount = MIN_STAKE;
        }

        agents[msg.sender] = Agent({
            wallet:          msg.sender,
            developerWallet: developerWallet,
            agentType:       agentType,
            status:          AgentStatus.Active,
            endpoint:        endpoint,
            fee:             agentType == AgentType.Scout ? 0 : fee,
            stake:           stakeAmount,
            reputationScore: 0,
            jobsCompleted:   0,
            jobsFailed:      0,
            registeredAt:    block.timestamp,
            registeredBlock: block.number
        });

        if (agentType == AgentType.Scout) {
            scoutAgents.push(msg.sender);
        } else {
            executorAgents.push(msg.sender);
        }

        emit AgentRegistered(msg.sender, agentType, fee, stakeAmount);
    }

    /// @notice Cleanly deregister an agent. Returns full stake if score >= 0.
    function deregister() external {
        Agent storage a = agents[msg.sender];
        require(a.wallet == msg.sender, "Registry: not registered");
        require(
            a.status == AgentStatus.Active || a.status == AgentStatus.Paused,
            "Registry: cannot deregister in current status"
        );

        uint256 returnAmount = a.reputationScore >= 0 ? a.stake : 0;
        a.status = AgentStatus.Deregistered;
        a.stake  = 0;

        if (returnAmount > 0) {
            usdc.transfer(msg.sender, returnAmount);
        }

        emit AgentDeregistered(msg.sender, returnAmount);
    }

    // ─── Reputation (Engine Only) ────────────────────────────────────────────

    /// @notice Called by engine after successful job completion.
    function incrementReputation(address wallet) external onlyEngine {
        Agent storage a = agents[wallet];
        int256 old = a.reputationScore;
        a.reputationScore += 1;
        a.jobsCompleted   += 1;
        emit ReputationChanged(wallet, old, a.reputationScore, "job_completed");
    }

    /// @notice Called by engine after job failure. penalty=1 for timeout, 2 for invalid result.
    function decrementReputation(address wallet, uint256 penalty) external onlyEngine {
        Agent storage a = agents[wallet];
        int256 old = a.reputationScore;
        a.reputationScore -= int256(penalty);
        a.jobsFailed      += 1;
        emit ReputationChanged(wallet, old, a.reputationScore, penalty == 1 ? "timeout" : "invalid_result");

        if (a.reputationScore <= PAUSE_THRESHOLD && a.status == AgentStatus.Active) {
            uint256 slash = a.stake >= PARTIAL_SLASH ? PARTIAL_SLASH : a.stake;
            a.stake  -= slash;
            a.status  = AgentStatus.Paused;
            if (slash > 0) usdc.transfer(owner, slash);
            emit AgentPaused(wallet, a.reputationScore, slash);
        }

        if (a.reputationScore <= BAN_THRESHOLD) {
            uint256 remainingStake = a.stake;
            a.stake  = 0;
            a.status = AgentStatus.Banned;
            bannedWallets[wallet] = true;
            if (remainingStake > 0) usdc.transfer(owner, remainingStake);
            emit AgentBanned(wallet, remainingStake);
        }
    }

    // ─── DEMO ONLY — Remove before production ───────────────────────────────

    /// @notice Owner-only function to seed reputation for demo agents.
    ///         DEMO ONLY: In production, only the engine can change reputation.
    function adminSetReputation(address wallet, int256 score) external onlyOwner {
        Agent storage a = agents[wallet];
        require(a.wallet == wallet, "Registry: not registered");
        int256 old = a.reputationScore;
        a.reputationScore = score;
        emit ReputationChanged(wallet, old, score, "admin_demo_seed");
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function getEligibleScouts() external view returns (address[] memory) {
        return _getEligible(scoutAgents);
    }

    function getEligibleExecutors() external view returns (address[] memory) {
        return _getEligible(executorAgents);
    }

    function getAgent(address wallet) external view returns (Agent memory) {
        return agents[wallet];
    }

    function getAllScouts()    external view returns (address[] memory) { return scoutAgents; }
    function getAllExecutors() external view returns (address[] memory) { return executorAgents; }

    function isEligible(address wallet) external view returns (bool) {
        Agent storage a = agents[wallet];
        if (a.status != AgentStatus.Active) return false;
        if (a.agentType == AgentType.Scout) return true;
        return a.stake > 0;
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    function _getEligible(address[] storage pool) internal view returns (address[] memory) {
        // All active agents with stake are eligible — no reputation floor.
        // Sorted by reputation descending so the engine can iterate fairly.
        uint256 count;
        for (uint256 i; i < pool.length; i++) {
            Agent storage a = agents[pool[i]];
            if (a.status == AgentStatus.Active && (a.agentType == AgentType.Scout || a.stake > 0)) {
                count++;
            }
        }

        address[] memory eligible = new address[](count);
        uint256 idx;
        for (uint256 i; i < pool.length; i++) {
            Agent storage a = agents[pool[i]];
            if (a.status == AgentStatus.Active && (a.agentType == AgentType.Scout || a.stake > 0)) {
                eligible[idx++] = pool[i];
            }
        }

        // Insertion sort: highest reputation first, earlier registeredBlock wins ties
        for (uint256 i = 1; i < eligible.length; i++) {
            address key = eligible[i];
            Agent storage keyAgent = agents[key];
            int256  j = int256(i) - 1;
            while (
                j >= 0 &&
                (
                    agents[eligible[uint256(j)]].reputationScore < keyAgent.reputationScore ||
                    (
                        agents[eligible[uint256(j)]].reputationScore == keyAgent.reputationScore &&
                        agents[eligible[uint256(j)]].registeredBlock  > keyAgent.registeredBlock
                    )
                )
            ) {
                eligible[uint256(j + 1)] = eligible[uint256(j)];
                j--;
            }
            eligible[uint256(j + 1)] = key;
        }

        return eligible;
    }
}
