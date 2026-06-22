# Live Demo (E2E) — Full System + Yield Accrual

This runs the **whole protocol live on Fuji**: deposit → 6 agents compete → scouts find the
best yield → an executor rebalances → yield **accrues and is credited to the depositor** →
backend API → dashboard → withdraw. Reputation is **real and earned** (+1 per completed job).

New here? See [README.md](./README.md) for addresses, install, and `.env`.

---

## What you'll demonstrate

- **6 agents** (3 scouts + 3 executors), each staked 5 USDC, competing for jobs.
- The vault **chasing yield live** — moving a mock pool's APY makes a new protocol win and the
  executor rebalances the vault into it.
- **Yield credited to the user** — the active protocol accrues real time-based yield (paid
  from a funded reserve), and the depositor's balance grows via live-asset share valuation.
- A full **audit trail** on SnowTrace + a live **dashboard**.

---

## Quick path — one script

The bundled orchestrator starts the 4 core agents, deposits, triggers a cycle, and prints the
pool balance + your balance ticking up:

```bash
npm run compile                 # once
node scripts/live-loop.js       # deposits 20 USDC, routes to the winning pool, samples accrual
# tune it: DEPOSIT_USDC=30 WIN_APY_BPS=50000 SAMPLES=8 SAMPLE_MS=15000 node scripts/live-loop.js
```

Expected: the scout picks the high-APY pool, the executor rebalances into it, then a table
shows `pool getBalance`, `vault totalAssets`, and `your balance` all increasing in lockstep.
Agent logs are written to `logs/*.log`.

---

## Manual path — full control

### 1. Ensure agents are registered
```bash
npm run register-agents          # 4 core agents (2 scouts + 2 executors)
npm run register-extra-agents    # MomentumScout + AdaptiveExec
```

### 2. Start backend + agents (separate terminals, keys from .env)
```bash
npm run backend                  # http://localhost:4000

AGENT_PRIVATE_KEY=$SCOUT1_PRIVATE_KEY    AGENT_NAME=SmartScout1   npm run smart-scout
AGENT_PRIVATE_KEY=$SCOUT2_PRIVATE_KEY    AGENT_NAME=BasicScout2   npm run scout
AGENT_PRIVATE_KEY=$MOMENTUM_SCOUT_KEY    AGENT_NAME=MomentumScout npm run momentum-scout
AGENT_PRIVATE_KEY=$EXECUTOR1_PRIVATE_KEY AGENT_NAME=SmartExec1    npm run smart-executor
AGENT_PRIVATE_KEY=$EXECUTOR2_PRIVATE_KEY AGENT_NAME=BasicExec2    npm run executor
AGENT_PRIVATE_KEY=$ADAPTIVE_EXEC_KEY     AGENT_NAME=AdaptiveExec  npm run adaptive-executor
```
(Or register + run your own agent with `@orbit/cli`: `orbit setup` then `orbit run`.)

### 3. Deposit + drive the competition
```bash
npm run seed                              # deposit USDC into the vault

# Make MockPoolA win (demo APY change), then drive a scout+executor cycle:
curl -X POST http://localhost:4000/api/demo/set-apy \
  -H 'Content-Type: application/json' -d '{"pool":"MockPoolA","apy":2000}'   # 20%
npm run demo                              # triggers scout/executor cycles on Fuji
```

### 4. Watch yield accrue
```bash
curl http://localhost:4000/api/status | jq   # vault balance grows as the pool accrues
```

---

## Verify (API + CLI)

```bash
curl http://localhost:4000/api/status    | jq   # vault balance, active protocol, APY
curl http://localhost:4000/api/agents    | jq   # agents ranked by reputation
curl http://localhost:4000/api/jobs      | jq   # recent jobs
curl http://localhost:4000/api/events    | jq   # rebalance history

# Per-agent view from @orbit/cli (after `orbit import` / `orbit setup`):
orbit status --agent <name>                     # reputation, jobs, stake + vault
orbit jobs   --agent <name>                     # this agent's recent jobs
```

---

## Contract test suite (no funds/network needed)

```bash
npm test                  # 117 unit + integration tests, in-memory
npm run test:unit
npm run test:integration
```

---

## Deployed addresses (Fuji, chainId 43113)

| Contract | Address |
|----------|---------|
| YieldVault | `0xbDEf6900D5a78413ca3781C8C663C52ef95d11C1` |
| AgentRegistry | `0x1cF588203C1ea4e8E3D61506967DB61C4C3ab794` |
| AgentSelectionEngine | `0xa03e3c3Ad5434c7F721152dFe33217a9015bb840` |
| YieldRegistry | `0x6d608E9689e940404C490536fdd7A389d6b4f5A5` |
| FeePool | `0xC435856607AA81a4CD9739B83fc45d5512085c2f` |
| AaveAdapter | `0x92b6522a76BdaE8fEA6b66f105A65B70730E5b18` |
| BenqiAdapter | `0xf5Ea879B7322dff6E695DAd7A51a245da6D7BC0F` |
| MockPoolA | `0x1699a483434220Fed498010FD38323D424058E87` |
| MockPoolB | `0x263CF3370d82B81e9D24bd80e6938A73F0E59334` |
| USDC (Circle) | `0x5425890298aed601595a70AB815c96711a31Bc65` |
