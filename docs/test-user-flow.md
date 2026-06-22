# User Guide — Deposit, Earn, Withdraw & Track Your Money

This is the **depositor's journey** on live Fuji: you put USDC into the Orbit vault, AI agents
compete to route it to the best yield, and you watch it grow and withdraw whenever you want.
**Your funds are never held by an agent** — agents only decide *where* to route; the vault
moves the money on-chain.

New here? See [README.md](./README.md) §1–3 for addresses, install, and how yield works.

---

## What happens to your money

1. You **deposit** USDC. A 0.10% protocol fee goes to the FeePool (which pays agents); the
   rest is credited to you as **shares**.
2. **Scouts** compete to find the best-yielding protocol; the winner posts it on-chain.
3. An **executor** moves the whole vault into that protocol.
4. Yield **accrues** in the active protocol. The vault values your shares on live assets, so
   your balance grows automatically.
5. You **withdraw** anytime (no lock) and receive your principal **+ accrued yield**.

---

## Option A — Frontend (recommended)

Start the apps (see [README.md](./README.md) §8), then open the browser:

1. **Connect wallet** — top-right "Connect Wallet" (MetaMask or Core), on **Avalanche Fuji**.
   The app prompts you to switch networks if needed.
2. **Deposit** — `http://localhost:3000/deposit`
   - Enter an amount (≥ 1 USDC). Approve, then deposit (two wallet confirmations).
   - You'll see the 0.10% fee preview and the "no lock period" note.
3. **Dashboard** — `http://localhost:3000/dashboard`
   - Your position: principal, current value, **yield earned** (current − principal), shares.
   - Active protocol + APY, projected earnings.
   - **Withdraw** button → choose all or a share amount.
4. **Tracking** — `http://localhost:3000/tracking`
   - Money-flow diagram (You → Vault −0.10% → active protocol → Yield → You).
   - Agent-competition panel (scouts/executors, the winning agent), live job + rebalance feeds.

> Need testnet funds? AVAX → https://faucet.avax.network · USDC → https://faucet.circle.com
> (select Avalanche Fuji).

---

## Option B — Scripts & API

Depositor vault actions (deposit / withdraw) live in the frontend dApp (Option A) and in the
repo scripts — they are **not** part of `@orbit/cli`, which is the agent-developer tool
(`orbit setup` / `orbit run`). For a quick command-line deposit:

```bash
npm run seed                                  # seed/deposit USDC into the vault
curl http://localhost:4000/api/status | jq    # vault balance, active protocol, APY
```

Withdraw is done from the dashboard (`http://localhost:3000/dashboard` → Withdraw).

---

## Seeing yield accrue

Real Aave V3 on Fuji pays ~0.1–1% APY, so over minutes the growth is tiny but real. To see
it move quickly in a demo, raise the active mock pool's APY (operator/demo action) via the
backend endpoint:

```bash
curl -X POST http://localhost:4000/api/demo/set-apy \
  -H 'Content-Type: application/json' -d '{"pool":"MockPoolA","apy":2000}'   # 20.00%
```

Then refresh the dashboard — your **yield earned** ticks up as the pool accrues (paid from the
pool's funded reserve). Withdraw to realize it. The full automated demo is `npm run demo`
(see [test-e2e.md](./test-e2e.md)).

---

## Good to know

- **No lock period** — withdraw anytime.
- **Pooled vault** — all deposits are pooled and the whole balance sits in one protocol at a
  time; you always own your proportional share (including yield).
- **Fees** — 0.10% on deposit. No withdrawal fee.
