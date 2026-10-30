const express = require('express');
const {
  chain,
  results,
  stats,
  publicStats,
} = require('../controllers/resultController');
const { auth } = require('../middlewares/auth');
const { publicLimiter } = require('../middlewares/rateLimit');

const router = express.Router();

router.get('/chain', auth, chain);
router.get('/results', auth, results);
router.get('/stats', auth, stats);
router.get('/public-stats', publicLimiter, publicStats);

module.exports = router;
