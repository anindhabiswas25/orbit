# @orbit/cli

The Orbit Protocol agent CLI. Register, run, and monitor AI yield agents on
Avalanche Fuji — without cloning a repo, reading Solidity, or hand-crafting a
single transaction.

```bash
npm install -g @orbit/cli
orbit setup            # interactive registration wizard
orbit run              # start your agent with a live dashboard
```

## Commands

| Command | Description |
|---|---|
| `orbit setup` | Register a new agent (interactive wizard). |
| `orbit import` | Import an already-registered agent onto this machine. |
| `orbit run [--agent <name>] [--no-dashboard]` | Run the agent loop with a live terminal dashboard. |
| `orbit agents` | List all saved agent profiles. |
| `orbit status [--agent <name>]` | One-time on-chain status snapshot. |
| `orbit jobs [--agent <name>] [-n <limit>]` | Recent job history. |
| `orbit earnings [--agent <name>]` | USDC earnings estimate. |
| `orbit switch <name>` | Set the default agent (drops the `--agent` flag). |
| `orbit deregister [--agent <name>]` | Deregister on-chain and reclaim stake. |

## How it works

`orbit run` is a self-contained agent runtime. It:

1. Loads encrypted credentials from `~/.orbit/credentials.json`.
2. Connects to Avalanche Fuji and polls `JobAssigned` events for your wallet.
3. **Scout:** reads every adapter APY, posts the best protocol to `YieldRegistry`,
   then calls `completeScoutJob`.
4. **Executor:** compares best vs. active protocol and calls
   `completeExecutorJob(jobId, newAdapter)` to rebalance — or
   `completeExecutorJobNoOp(jobId)` when no move is warranted. The engine performs
   the rebalance + on-chain log atomically; the agent never calls
   `vault.rebalance()` directly.
5. Retries with backoff, reconnects on RPC errors, and keeps running until you
   press `q`.

## Security

Private keys are encrypted at rest with AES-256-GCM (PBKDF2, 100k rounds, the
wallet address as salt). The credential password is never stored. Keys are only
decrypted in memory for an active session.

## Dashboard keys

`q` quit · `p` pause/resume · `l` logs-only · `r` refresh

The live dashboard uses `blessed`. If it is not installed, run headless with
`orbit run --no-dashboard`.

## Network

Avalanche Fuji C-Chain (chain ID `43113`). Contract addresses and ABIs are
bundled in the package; override any address with the `ORBIT_*` environment
variables or point at a custom RPC with `FUJI_RPC_URL`.
