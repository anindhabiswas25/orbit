const { ethers } = require('ethers');
const ADDRESSES  = require('../../deployed-addresses.json');
require('dotenv').config();

// Mock pools fluctuate around a fixed ~5% base — independent of Fuji's
// near-zero live Aave rate — so the demo shows lively yields. The winner/loser
// gap (2*SPREAD = 300 bps) stays above the executor's 200 bps rebalance
// threshold, so each flip actually triggers a rebalance.
const FLIP_INTERVAL_MS = 600_000;                                       // 10 minutes
const BASE_APY_BPS     = parseInt(process.env.MOCK_BASE_APY_BPS || '500', 10);  // 5.00%
const SPREAD_BPS       = parseInt(process.env.MOCK_SPREAD_BPS   || '150', 10);  // ±1.50%
const NOISE_BPS        = parseInt(process.env.MOCK_NOISE_BPS    || '15',  10);  // ±0.15% jitter
const MIN_APY          = 3;

const MOCK_ABI = ['function setAPY(uint256) external', 'function getAPY() view returns(uint256)'];

let _timer = null;
let _aWins = true;

function jitter(n) { return Math.round(n + (Math.random() - 0.5) * NOISE_BPS * 2); }
function clamp(n)  { return Math.max(MIN_APY, n); }

async function tick() {
  try {
    if (!process.env.DEPLOYER_PRIVATE_KEY) return;

    const provider = new ethers.JsonRpcProvider(
      process.env.FUJI_RPC_URL, undefined, { cacheTimeout: -1 }
    );
    const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

    const mockA = new ethers.Contract(ADDRESSES.MockPoolA, MOCK_ABI, deployer);
    const mockB = new ethers.Contract(ADDRESSES.MockPoolB, MOCK_ABI, deployer);

    // Winner sits above the base, loser below — alternating each cycle.
    const winner = clamp(jitter(BASE_APY_BPS + SPREAD_BPS));
    const loser  = clamp(jitter(BASE_APY_BPS - SPREAD_BPS));

    const apyA = _aWins ? winner : loser;
    const apyB = _aWins ? loser  : winner;

    await (await mockA.setAPY(apyA)).wait();
    await (await mockB.setAPY(apyB)).wait();

    const now = new Date().toLocaleTimeString();
    console.log(`[fluctuation-trigger] [${now}] base=${BASE_APY_BPS}bps  ` +
                `MockPoolA=${apyA}bps (${(apyA/100).toFixed(2)}%)  ` +
                `MockPoolB=${apyB}bps (${(apyB/100).toFixed(2)}%)  ` +
                `WINNER=${_aWins ? 'MockPoolA' : 'MockPoolB'}`);

    _aWins = !_aWins;
  } catch (err) {
    console.warn(`[fluctuation-trigger] tick error: ${err.message}`);
  }
}

function start() {
  if (_timer) return;
  console.log('[fluctuation-trigger] starting — flipping mock APYs every 10 minutes');
  tick();
  _timer = setInterval(tick, FLIP_INTERVAL_MS);
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { start, stop };
