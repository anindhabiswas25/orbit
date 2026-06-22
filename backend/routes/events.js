const { Router }       = require('express');
const { getChainData } = require('../services/chain');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const chain = getChainData();
    const data  = await chain.getRebalanceLogs(limit);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
