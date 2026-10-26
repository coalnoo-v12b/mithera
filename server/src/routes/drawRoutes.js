const express = require('express');
const draw = require('../controllers/drawController');
const { auth } = require('../middlewares/auth');
const { joinLimiter, createLimiter } = require('../middlewares/rateLimit');

const router = express.Router();

router.use(auth);

// 누구나 추첨을 만들 수 있고, 마감/실행은 만든 사람 또는 관리자만 (컨트롤러에서 확인)
router.get('/', draw.list);
router.post('/', createLimiter, draw.create);
router.get('/:id', draw.get);
router.post('/:id/join', joinLimiter, draw.join);
router.post('/:id/leave', draw.leave);
router.post('/:id/close', draw.close);
router.post('/:id/run', draw.run);
router.get('/:id/recording', draw.recording);
router.get('/:id/verify', draw.verify);

module.exports = router;
