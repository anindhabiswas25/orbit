// Automatic scout/executor cycle trigger.
// Calls engine.triggerScoutCycle() whenever the cooldown has elapsed and the
// vault has funds. This is what drives agent activity after a user deposit —
// without it, agents sit idle waiting for jobs that never get assigned.

const { ethers } = require('ethers');
const ADDRESSES  = require('../../deployed-addresses.json');
require('dotenv').config();

const CHECK_INTERVAL_MS = 30_000;  // poll every 30 s
const MIN_VAULT_USDC    = 0.5;     // don't trigger on near-empty vault

function loadABI(name) {
  return require(`../../artifacts/contracts/${name}.sol/${name}.json`).abi;
}

const ABIS = {
  AgentSelectionEngine: loadABI('AgentSelectionEngine'),
  YieldVault:           loadABI('YieldVault'),
};

let _timer = null;

async function tryTrigger() {
  try {
    if (!process.env.DEPLOYER_PRIVATE_KEY) return; // no key = can't trigger

    const provider = new ethers.JsonRpcProvider(
      process.env.FUJI_RPC_URL, undefined, { cacheTimeout: -1 }
    );
    const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
    const engine   = new ethers.Contract(ADDRESSES.AgentSelectionEngine, ABIS.AgentSelectionEngine, deployer);
    const vault    = new ethers.Contract(ADDRESSES.YieldVault, ABIS.YieldVault, provider);

    // Check vault has meaningful balance
    const balance = await vault.getVaultBalance();
    const balUsdc = Number(balance) / 1e6;
    if (balUsdc < MIN_VAULT_USDC) return;

    // Check cooldown
    const lastScout  = Number(await engine.lastScoutJobAt());
    const interval   = Number(await engine.SCOUT_INTERVAL());
    const now        = Math.floor(Date.now() / 1000);
    const canTrigger = now >= lastScout + interval;
    if (!canTrigger) {
      const wait = lastScout + interval - now;
      console.log(`[cycle-trigger] next trigger in ${wait}s (vault ${balUsdc.toFixed(2)} USDC)`);
      return;
    }

    console.log(`[cycle-trigger] triggering scout cycle (vault ${balUsdc.toFixed(2)} USDC)...`);
    const tx      = await engine.triggerScoutCycle();
    const receipt = await tx.wait();
    console.log(`[cycle-trigger] cycle triggered — tx: ${receipt.hash}`);

  } catch (err) {
    // Non-fatal: log and continue polling
    console.warn(`[cycle-trigger] ${err.message}`);
  }
}

function start() {
  if (_timer) return; // already running
  console.log('[cycle-trigger] starting — checking every 30s');
  tryTrigger(); // immediate first attempt
  _timer = setInterval(tryTrigger, CHECK_INTERVAL_MS);
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

// Allow manual one-shot trigger (used by POST /api/demo/trigger-cycle)
async function triggerNow() {
  if (!process.env.DEPLOYER_PRIVATE_KEY) throw new Error('DEPLOYER_PRIVATE_KEY not set');

  const provider = new ethers.JsonRpcProvider(
    process.env.FUJI_RPC_URL, undefined, { cacheTimeout: -1 }
  );
  const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  const engine   = new ethers.Contract(ADDRESSES.AgentSelectionEngine, ABIS.AgentSelectionEngine, deployer);

  const lastScout = Number(await engine.lastScoutJobAt());
  const interval  = Number(await engine.SCOUT_INTERVAL());
  const now       = Math.floor(Date.now() / 1000);
  const wait      = Math.max(0, lastScout + interval - now);

  if (wait > 0) {
    throw new Error(`Scout cooldown active — ${wait}s remaining before next trigger`);
  }

  const tx      = await engine.triggerScoutCycle();
  const receipt = await tx.wait();
  return { tx: receipt.hash, message: 'Scout cycle triggered — agents will pick up the job within seconds' };
}

module.exports = { start, stop, triggerNow };
