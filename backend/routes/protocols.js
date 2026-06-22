const { Router }       = require('express');
const { getChainData } = require('../services/chain');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const chain = getChainData();
    const data  = await chain.getAllProtocols();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
