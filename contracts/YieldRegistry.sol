// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title YieldRegistry
/// @notice On-chain message bus between scout and executor agents.
///
///         Scouts write:        updateBestProtocol()
///         Engine writes:       logRebalance()  (via completeExecutorJob)
///         Engine reads:        bestProtocol(), bestAPY(), lastUpdated(), isAdapter()
///         Frontend reads:      activeProtocol(), activeAPY(), getRebalanceLogs()
///
/// @dev    DESIGN NOTE: logRebalance() is callable by both authorized agents AND
///         the selection engine, because rebalance can be triggered either way.
///         updateBestProtocol() is scouts-only.
contract YieldRegistry {

    address public owner;
    address public selectionEngine;

    // Authorized agents (scouts and executors registered via authorizeAgent)
    mapping(address => bool) public authorizedAgents;

    // Registered adapters
    address[]               public adapterList;
    mapping(address => bool)   public isAdapter;
    mapping(address => string) public adapterName;

    // Best protocol signal — written by winning scout
    address public bestProtocol;
    uint256 public bestAPY;
    uint256 public lastUpdated;

    // Active protocol — written after rebalance
    address public activeProtocol;
    uint256 public activeAPY;

    // Rebalance history
    struct RebalanceLog {
        address fromProtocol;
        address toProtocol;
        uint256 fromAPY;
        uint256 toAPY;
        uint256 amount;
        uint256 timestamp;
        address executorAgent;
    }
    RebalanceLog[] public rebalanceLogs;

    // ─── Events ─────────────────────────────────────────────────────────────
    event BestYieldUpdated(address indexed protocol, uint256 apy, uint256 timestamp, address indexed scout);
    event RebalanceLogged(address indexed from, address indexed to, uint256 fromAPY, uint256 toAPY, uint256 amount, address indexed executor);
    event AdapterRegistered(address indexed adapter, string name);
    event AgentAuthorized(address indexed agent);
    event EngineSet(address indexed engine);

    constructor() { owner = msg.sender; }

    modifier onlyOwner()  { require(msg.sender == owner,                                   "Registry: not owner");  _; }
    modifier onlyAgent()  { require(authorizedAgents[msg.sender],                          "Registry: not authorized agent"); _; }
    modifier onlyEngineOrAgent() {
        require(
            msg.sender == selectionEngine || authorizedAgents[msg.sender],
            "Registry: not engine or agent"
        );
        _;
    }

    // ─── Admin ──────────────────────────────────────────────────────────────

    function setSelectionEngine(address _engine) external onlyOwner {
        require(_engine != address(0), "Registry: zero engine");
        selectionEngine = _engine;
        emit EngineSet(_engine);
    }

    function authorizeAgent(address agent) external onlyOwner {
        require(agent != address(0), "Registry: zero agent");
        authorizedAgents[agent] = true;
        emit AgentAuthorized(agent);
    }

    function registerAdapter(address adapter, string calldata name) external onlyOwner {
        require(adapter != address(0),     "Registry: zero adapter");
        require(!isAdapter[adapter],       "Registry: already registered");
        require(bytes(name).length > 0,    "Registry: empty name");
        adapterList.push(adapter);
        isAdapter[adapter]   = true;
        adapterName[adapter] = name;
        emit AdapterRegistered(adapter, name);
    }

    function getAdapters() external view returns (address[] memory) {
        return adapterList;
    }

    // ─── Scout writes ───────────────────────────────────────────────────────

    /// @notice Called by winning scout agent. Engine reads this to verify job completion.
    function updateBestProtocol(address protocol, uint256 apy) external onlyAgent {
        require(isAdapter[protocol], "Registry: unknown adapter");
        require(apy > 0,            "Registry: APY must be positive");

        bestProtocol = protocol;
        bestAPY      = apy;
        lastUpdated  = block.timestamp;

        emit BestYieldUpdated(protocol, apy, block.timestamp, msg.sender);
    }

    // ─── Engine/Executor writes ──────────────────────────────────────────────

    /// @notice Called by engine (via completeExecutorJob) or authorized executor agents
    ///         after completing a rebalance. Updates activeProtocol and appends to rebalanceLogs.
    function logRebalance(
        address fromProtocol,
        address toProtocol,
        uint256 fromAPY,
        uint256 toAPY,
        uint256 amount
    ) external onlyEngineOrAgent {
        require(isAdapter[toProtocol], "Registry: target not registered adapter");

        activeProtocol = toProtocol;
        activeAPY      = toAPY;

        rebalanceLogs.push(RebalanceLog({
            fromProtocol:  fromProtocol,
            toProtocol:    toProtocol,
            fromAPY:       fromAPY,
            toAPY:         toAPY,
            amount:        amount,
            timestamp:     block.timestamp,
            executorAgent: msg.sender
        }));

        emit RebalanceLogged(fromProtocol, toProtocol, fromAPY, toAPY, amount, msg.sender);
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function getRebalanceLogsCount() external view returns (uint256) {
        return rebalanceLogs.length;
    }

    function getRebalanceLogs(uint256 from, uint256 count)
        external view returns (RebalanceLog[] memory)
    {
        uint256 end = from + count > rebalanceLogs.length
            ? rebalanceLogs.length : from + count;
        RebalanceLog[] memory result = new RebalanceLog[](end - from);
        for (uint256 i = from; i < end; i++) {
            result[i - from] = rebalanceLogs[i];
        }
        return result;
    }
}
