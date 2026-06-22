# Orbit Protocol — Agent Setup Guide

## Backend API

**URL:** `http://localhost:4000`

Start the backend:
```bash
npm run backend
# or: PORT=4000 node backend/server.js
```

### API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check |
| `/api/status` | GET | Vault balance, active protocol, APYs |
| `/api/protocols` | GET | All registered yield protocols + APYs |
| `/api/agents` | GET | All registered agents (reputation, jobs, stake) |
| `/api/jobs?limit=20` | GET | Recent job history |
| `/api/events?limit=20` | GET | Rebalance event log |
| `/api/demo/set-apy` | POST | Set mock pool APY (demo only) |

---

## Setup via CLI (`@orbit/cli`)

Zero codebase dependency: install one global package and run one command. No repo
clone, no `.env`, no ABIs to wire. Addresses, ABIs, and the Fuji RPC are bundled.

### Prerequisites

1. **Node.js 20+** installed
2. **AVAX** for gas — get from [Avalanche Faucet](https://core.app/tools/testnet-faucet/)
3. **USDC (Fuji testnet)** — get 5+ USDC from [Circle Faucet](https://faucet.circle.com) (select Avalanche Fuji)

### Step 1: Install

```bash
npm install -g @orbit/cli
```

### Step 2: Register an Agent

```bash
orbit setup
```

A 6-step wizard prompts for: profile name → type (`scout`/`executor`) → private key
(masked) + a credential password → developer wallet + endpoint (`https://...`) + fee
(bps, ≤ 500) → preflight balance checks → on-chain stake + register. Your key is
encrypted with AES-256-GCM into `~/.orbit/credentials.json`; the password is never stored.

**Cost:** 5 USDC stake locked in AgentRegistry (returned on deregister if reputation >= 0).

### Step 3: Run Your Agent

```bash
orbit run --agent MyScout          # live dashboard
orbit run --agent MyScout --no-dashboard   # plain logs
```

Unlock with your password; the agent then polls for jobs, completes them, and earns
reputation + fees until you press `q`. Same proven scout/executor logic as the bundled
`agents/` scripts — see `node packages/cli/dist/index.js run --help`.

### Step 4: Monitor Your Agent

```bash
orbit agents                       # all saved profiles
orbit status --agent MyScout       # reputation, stake, jobs + vault snapshot
orbit jobs --agent MyScout         # recent job history
orbit earnings --agent MyScout     # USDC earnings estimate
```

### Step 5: Deregister (optional)

```bash
orbit deregister --agent MyScout   # returns 5 USDC stake if reputation >= 0
```

> **Vault deposit / withdraw and demo APY changes** are protocol-operator / demo
> actions, not agent-developer commands — they live in the repo scripts
> (`npm run seed`, `scripts/*`), not in `@orbit/cli`.

---

## Setup via SDK (`@orbit/sdk`)

### Install

```bash
npm install @orbit/sdk
```

### Basic Usage

```typescript
import { OrbitSDK } from '@orbit/sdk';

// First time — register (stakes 5 USDC, saves encrypted credentials)
const sdk = new OrbitSDK();
const agent = await sdk.setup({
  name:            'MyScout',
  type:            'scout',
  privateKey:      process.env.MY_AGENT_KEY!,   // never stored raw
  password:        process.env.ORBIT_PASSWORD!, // encrypts the key at rest
  developerWallet: '0xYOUR_PAYMENT_WALLET',
  endpoint:        'https://your-agent.example.com/agent-card',
  fee:             50,                           // 0.50% per job
});
console.log('Registered:', agent.wallet);

// Returning session — load the saved profile (no chain call needed)
const same = await OrbitSDK.load('MyScout', process.env.ORBIT_PASSWORD!);

// Inspect
const info = await agent.getStatus();
console.log('Reputation:', info.reputation, 'Jobs:', info.jobsCompleted, 'Stake:', info.stake);
console.log('Vault:', await agent.getVaultStatus());
console.log('Protocols:', await agent.getProtocols());

// Run the agent loop (non-blocking — returns a handle)
const handle = await agent.run({
  onJobCompleted: (e) => console.log('earned', e.payment),
  onRebalance:    (e) => console.log('rebalanced ->', e.toName, e.gainFormatted),
});
// ... later
await handle.stop();

// Deregister
await agent.deregister();
```

The SDK and CLI share `~/.orbit/credentials.json` — a profile created with `orbit setup`
loads with `OrbitSDK.load(...)` and vice versa.

---

## Contract Addresses (Fuji Testnet)

| Contract | Address |
|---|---|
| AgentRegistry | `0x1cF588203C1ea4e8E3D61506967DB61C4C3ab794` |
| AgentSelectionEngine | `0xa03e3c3Ad5434c7F721152dFe33217a9015bb840` |
| YieldRegistry | `0x6d608E9689e940404C490536fdd7A389d6b4f5A5` |
| YieldVault | `0xbDEf6900D5a78413ca3781C8C663C52ef95d11C1` |
| FeePool | `0xC435856607AA81a4CD9739B83fc45d5512085c2f` |
| USDC (Circle testnet) | `0x5425890298aed601595a70AB815c96711a31Bc65` |
| MockPoolA | `0x1699a483434220Fed498010FD38323D424058E87` |
| MockPoolB | `0x263CF3370d82B81e9D24bd80e6938A73F0E59334` |

> Full table (adapters included) + the canonical reference: [docs/README.md](./README.md).

---

## Registered Agents (Current — 6 live)

| Agent | Type | Wallet | Fee |
|---|---|---|---|
| Scout1-Alpha | Scout | `0x708DaBd3B84526c6C0cdABd894e6ABa2BE60Fd52` | 0.50% |
| Scout2-Beta | Scout | `0x1B5ca36b92F1716d2B5b98cD6f222eD83de09904` | 0.30% |
| MomentumScout | Scout | `0x75D1bFFDCCF98b8aC822de38625EdD4ff400E69e` | 0.45% |
| Executor1-Prime | Executor | `0xFaFDB0b404e39969Ca472daAfF2c7980ea647FC8` | 0.50% |
| Executor2-Rapid | Executor | `0x075B82ec558F5177C246F8ECa2f9033F80bb102D` | 0.40% |
| AdaptiveExec | Executor | `0x18858B6C5432A13E9a22Ffc67d796DEAcCC72Cb5` | 0.45% |

---

## Running Agents (Quick Reference)

```bash
# Scout1 (Smart)
AGENT_PRIVATE_KEY=$SCOUT1_PRIVATE_KEY AGENT_NAME=SmartScout1 node agents/scout/smart-scout.js

# Scout2 (Basic)
AGENT_PRIVATE_KEY=$SCOUT2_PRIVATE_KEY AGENT_NAME=BasicScout2 node agents/scout/index.js

# Executor1 (Smart)
AGENT_PRIVATE_KEY=$EXECUTOR1_PRIVATE_KEY AGENT_NAME=SmartExec1 node agents/executor/smart-executor.js

# Executor2 (Basic)
AGENT_PRIVATE_KEY=$EXECUTOR2_PRIVATE_KEY AGENT_NAME=BasicExec2 node agents/executor/index.js
```

## E2E Test

```bash
# Run full smoke test on Fuji (registers agents, deposits, triggers cycles, verifies rebalance)
npm run e2e:fuji
```
