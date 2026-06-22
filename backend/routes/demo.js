// POST /api/demo/set-apy          — set MockPool APY
// POST /api/demo/trigger-cycle   — manually fire a scout+executor cycle
// Demo/presentation use only.

const { Router }    = require('express');
const { ethers }    = require('ethers');
const ADDRESSES     = require('../../deployed-addresses.json');
const cycleTrigger  = require('../services/cycle-trigger');
require('dotenv').config();

const router = Router();

const MockPoolABI = [
  'function setAPY(uint256) external',
  'function getAPY() external view returns (uint256)',
];

router.post('/set-apy', async (req, res, next) => {
  const { pool, apy } = req.body;

  if (!['MockPoolA', 'MockPoolB'].includes(pool)) {
    return res.status(400).json({ error: 'pool must be MockPoolA or MockPoolB' });
  }
  if (typeof apy !== 'number' || apy < 0 || apy > 50_000) {
    return res.status(400).json({ error: 'apy must be 0–50000 basis points' });
  }

  try {
    const provider = new ethers.JsonRpcProvider(process.env.FUJI_RPC_URL);
    const wallet   = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
    const address  = pool === 'MockPoolA' ? ADDRESSES.MockPoolA : ADDRESSES.MockPoolB;
    const contract = new ethers.Contract(address, MockPoolABI, wallet);

    const tx      = await contract.setAPY(apy);
    const receipt = await tx.wait();

    res.json({
      success:      true,
      pool,
      apy,
      apyFormatted: `${(apy / 100).toFixed(2)}%`,
      tx:           receipt.hash,
      message:      'Scout will detect this within 60 seconds',
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/demo/trigger-cycle
// Manually fires triggerScoutCycle() on the engine (respects the 60s cooldown).
router.post('/trigger-cycle', async (req, res, next) => {
  try {
    const result = await cycleTrigger.triggerNow();
    res.json({ success: true, ...result });
  } catch (err) {
    // Return the cooldown message as a 409 so the frontend can display it
    if (err.message.includes('cooldown')) {
      return res.status(409).json({ success: false, error: err.message });
    }
    next(err);
  }
});

module.exports = router;
