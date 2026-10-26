const express = require('express');
const { chain, results, stats } = require('../controllers/resultController');
const { auth } = require('../middlewares/auth');

const router = express.Router();

router.get('/chain', auth, chain);
router.get('/results', auth, results);
router.get('/stats', auth, stats);

module.exports = router;
