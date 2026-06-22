# Monitoring Guide — Users & Agent Engineers

Orbit is built so that **everything is observable**. Every deposit, job, rebalance,
reputation change, and payout is an on-chain event, surfaced through three layers:

1. **CLI** — quick command-line snapshots.
2. **Backend API + Dashboard** — live, polled views (updates every ~10s).
3. **Snowtrace (on-chain)** — the trustless source of truth you can verify yourself.

---

## Part 1 — How a USER monitors where their money is going

As a depositor you always want four answers: **how much** is mine, **which pool**
is it in, **what is it earning**, and **what has it done**. Here's where each lives.

### A. Quick snapshot — CLI

```bash
orbit status --agent <name>     # @orbit/cli — unlocks your profile, then reads chain
# or, no agent profile needed:
curl http://localhost:4000/api/status | jq   # backend API
```

`orbit status` shows your agent health **plus** the **vault balance**, the **active
protocol** (the pool currently holding the funds), and its **APY** — the fastest
"where is my money right now?" check. The backend `/api/status` endpoint exposes the
same vault snapshot without unlocking a key.

### B. Live view — Dashboard

Start it (`npm run backend`, then `cd frontend && npm run dev`) and open
http://localhost:3000:

| Panel | Answers |
|-------|---------|
| **VaultStatus** | How much is in the vault, which pool holds it, at what APY |
| **APYLeaderboard** | Why that pool — it shows every pool's APY ranked, active highlighted |
| **AgentLog** | What has happened — every rebalance, with from→to pool, gain %, timestamp |
| **JobFeed** | Proof the system is actively working on your behalf right now |

### C. Trustless verification — Snowtrace

You don't have to trust the UI. Look up the **YieldVault**
`0xbDEf6900D5a78413ca3781C8C663C52ef95d11C1` on
https://testnet.snowtrace.io and read its events directly:

- `Deposit` / `Withdraw` — your money in and out.
- The **YieldRegistry** (`0x6d608E9689e940404C490536fdd7A389d6b4f5A5`)
  `RebalanceLogged` events — every move, with from/to APY and amount.

### D. Programmatic — API

```bash
curl http://localhost:4000/api/status   | jq   # balance, active protocol, APY
curl http://localhost:4000/api/events   | jq   # full rebalance history
```

> **Key guarantee:** an agent **never holds your USDC**. Agents only *decide* the
> best pool; the vault moves the money atomically via the engine. So "monitoring
> your money" = watching the **vault's** active protocol and history, which no agent
> can fake — it's all on-chain.

---

## Part 2 — How an AGENT ENGINEER monitors everything

You care about your **agent's health**, your **standing vs competitors**, your
**jobs and earnings**, and the **system state** that drives job assignment.

### A. Your agent's health — CLI / SDK

```bash
orbit status --agent <name>     # @orbit/cli
```

Shows **status** (active/paused/banned), **reputation**, **jobsCompleted /
jobsFailed**, **stake**, fee, and dev wallet. Programmatically:

```ts
const agent = await OrbitSDK.load('MyScout', process.env.ORBIT_PASSWORD!);
const info  = await agent.getStatus();   // AgentClient.getStatus()
// { status, reputation, jobsCompleted, jobsFailed, stake, fee, ... }
```

Watch these: reputation trending **down** means failed/expired jobs — your process
may be offline, slow, or (for scouts) not authorized in YieldRegistry. Hitting the
pause threshold takes you out of selection; the ban threshold loses your stake.

### B. The competition — leaderboard

The engine assigns each job to the **highest-reputation eligible agent**, so your
rank determines whether you get work.

```bash
curl "http://localhost:4000/api/agents?type=scout"    | jq   # ranked by reputation
curl "http://localhost:4000/api/agents?type=executor" | jq
```

The ranked agent leaderboard is served by the backend (`/api/agents`) — the engine
assigns each job to the highest-reputation eligible agent. From the SDK, read your own
standing with `agent.getStatus()` and compare against `/api/agents`.

The dashboard **AgentLeaderboard** panel shows the same, color-coded by reputation.

### C. Your agent's runtime — process logs

The scout/executor processes emit **structured JSON logs** to stdout: every APY
read, the winner chosen, each decision (rebalance vs no-op), and every tx hash.
Capture them:

```bash
AGENT_PRIVATE_KEY=$DEMO_AGENT_A_KEY AGENT_NAME=ReliableScout npm run scout \
  | tee -a logs/reliablescout.log
```

For long-running agents, run under a process manager (e.g. `pm2`) so they restart on
crash/network change (the agents already exit on network change to be restarted).

### D. Jobs & earnings

```bash
curl "http://localhost:4000/api/jobs?limit=20" | jq   # assignments + completions
```

Your **fees are paid by the FeePool** to your **dev wallet** — track that address's
USDC balance on Snowtrace, or watch FeePool
`0x7171D6372A0BbD0b6Eb0c44dF0a1566dEC34D5b6` `AgentPaid` events.

### E. System state that drives your decisions

```bash
curl http://localhost:4000/api/protocols | jq   # all pool APYs, sorted
curl http://localhost:4000/api/status    | jq   # active vs best protocol
```

A scout watches `/api/protocols` to know what it should be posting; an executor
watches the **spread** between active and best to know when a rebalance is worth it.

### F. Trustless audit — on-chain events

The complete, tamper-proof record lives on the **AgentRegistry**
(`0x1cF588203C1ea4e8E3D61506967DB61C4C3ab794`) and **AgentSelectionEngine**
(`0xa03e3c3Ad5434c7F721152dFe33217a9015bb840`) on Snowtrace:

| Event | Tells you |
|-------|-----------|
| `JobAssigned` | A job was given to an agent (with deadline) |
| `JobCompleted` | An agent finished and was paid |
| `JobExpired` / `JobFailed` | An agent missed a deadline / posted a bad result |
| `ReputationChanged` | Exact reputation deltas, with the reason string |
| `AgentPaused` / `AgentBanned` | An agent crossed a slashing threshold |

---

## Quick reference — what to run for what

| I want to know… | Run |
|-----------------|-----|
| Where is my deposit right now | `curl .../api/status` (or `orbit status --agent <name>`) |
| Full history of my money's moves | `curl .../api/events` or AgentLog panel |
| My agent's reputation & jobs | `orbit status --agent <name>` (or `orbit jobs --agent <name>`) |
| My rank vs other agents | `curl ".../api/agents?type=scout"` |
| What my agent is doing live | `orbit run` dashboard, or `~/.orbit/logs/<name>.log` |
| The independent truth | Snowtrace events on the vault / registry / engine |

See also: [User Guide](./test-user-flow.md) · [Agent Engineer Guide](./test-agent-engineer-flow.md) · [Live Demo](./test-e2e.md).
