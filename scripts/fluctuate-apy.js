// fluctuate-apy.js — keeps MockPoolA and MockPoolB APYs fluctuating
// realistically around Aave V3's live rate so scouts can properly track
// the best yield and executors rebalance when the winner changes.
//
// Target range: Aave V3 live APY ± spread (default ±8 bps).
// The two pools take turns beating each other every FLIP_INTERVAL_MS,
// with small random noise so scouts see genuine price movement.
//
// Run: node scripts/fluctuate-apy.js
// Env: FLIP_INTERVAL_MS=90000 (default: 90s), SPREAD_BPS=8 (default)

const { ethers } = require('ethers');
require('dotenv').config();

const ADDR     = require('../deployed-addresses.json');
const MOCK_ABI = ['function setAPY(uint256) external', 'function getAPY() view returns(uint256)'];
const IYA_ABI  = ['function getAPY() view returns(uint256)'];

const FLIP_MS  = parseInt(process.env.FLIP_INTERVAL_MS  || '90000',  10); // 90s
const SPREAD   = parseInt(process.env.SPREAD_BPS        || '8',       10); // ±8 bps around Aave
const NOISE    = parseInt(process.env.NOISE_BPS         || '2',       10); // random ±2 bps noise per tick
const MIN_APY  = 3;   // floor: never below 0.03%

function jitter(n) { return Math.round(n + (Math.random() - 0.5) * NOISE * 2); }
function clamp(n)  { return Math.max(MIN_APY, n); }

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.FUJI_RPC_URL, undefined, { cacheTimeout: -1 });
  const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

  const mockA = new ethers.Contract(ADDR.MockPoolA, MOCK_ABI, deployer);
  const mockB = new ethers.Contract(ADDR.MockPoolB, MOCK_ABI, deployer);
  const aave  = new ethers.Contract(ADDR.AaveAdapter, IYA_ABI, provider);

  console.log('[fluctuate-apy] started');
  console.log('  flip every', FLIP_MS/1000+'s, spread=±'+SPREAD+' bps, noise=±'+NOISE+' bps');
  console.log('  Pools bracket Aave V3 live rate. Winner flips each cycle.');
  console.log('  Ctrl+C to stop.\n');

  let aWins = true; // toggle which pool is on top this cycle

  async function tick() {
    try {
      const liveAave = clamp(Number(await aave.getAPY())); // live Aave rate in bps

      // Winner is SPREAD above Aave, loser is SPREAD below
      const winner = clamp(jitter(liveAave + SPREAD));
      const loser  = clamp(jitter(liveAave - SPREAD));

      const apyA = aWins ? winner : loser;
      const apyB = aWins ? loser  : winner;

      await (await mockA.setAPY(apyA)).wait();
      await (await mockB.setAPY(apyB)).wait();

      const now = new Date().toLocaleTimeString();
      console.log(`[${now}] Aave=${liveAave}bps (${(liveAave/100).toFixed(2)}%)  ` +
                  `MockPoolA=${apyA}bps (${(apyA/100).toFixed(2)}%)  ` +
                  `MockPoolB=${apyB}bps (${(apyB/100).toFixed(2)}%)  ` +
                  `WINNER=${aWins ? 'MockPoolA' : 'MockPoolB'}`);

      aWins = !aWins; // flip winner next cycle
    } catch (err) {
      console.warn('[fluctuate-apy] tick error:', err.message);
    }
  }

  // First tick immediately, then every FLIP_MS
  await tick();
  setInterval(tick, FLIP_MS);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
