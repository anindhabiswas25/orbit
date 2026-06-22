const { Router }       = require('express');
const { getChainData } = require('../services/chain');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { type } = req.query; // scout | executor | undefined
    const chain = getChainData();
    const data  = await chain.getAllAgents(type || null);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
