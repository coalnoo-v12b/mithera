const express = require('express');
const draw = require('../controllers/drawController');
const { auth, adminOnly } = require('../middlewares/auth');

const router = express.Router();

router.use(auth);

router.get('/', draw.list);
router.post('/', adminOnly, draw.create);
router.get('/:id', draw.get);
router.post('/:id/join', draw.join);
router.post('/:id/leave', draw.leave);
router.post('/:id/close', adminOnly, draw.close);
router.post('/:id/run', adminOnly, draw.run);
router.get('/:id/recording', draw.recording);
router.get('/:id/verify', draw.verify);

module.exports = router;
