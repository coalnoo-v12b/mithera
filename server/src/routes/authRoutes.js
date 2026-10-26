const express = require('express');
const { signup, login, logout, me } = require('../controllers/authController');
const { auth } = require('../middlewares/auth');
const { authLimiter } = require('../middlewares/rateLimit');

const router = express.Router();

router.post('/signup', authLimiter, signup);
router.post('/login', authLimiter, login);
router.post('/logout', logout);
router.get('/me', auth, me);

module.exports = router;
