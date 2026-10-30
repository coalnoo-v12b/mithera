const express = require('express');
const { signup, login, logout, me } = require('../controllers/authController');
const {
  googleLogin,
  googleCallback,
  naverLogin,
  naverCallback,
  kakaoLogin,
  kakaoCallback,
} = require('../controllers/oauthController');
const { auth } = require('../middlewares/auth');
const { authLimiter } = require('../middlewares/rateLimit');

const router = express.Router();

router.post('/signup', authLimiter, signup);
router.post('/login', authLimiter, login);
router.post('/logout', logout);
router.get('/me', auth, me);
router.get('/auth/google', googleLogin);
router.get('/auth/google/callback', googleCallback);
router.get('/auth/naver', naverLogin);
router.get('/auth/naver/callback', naverCallback);
router.get('/auth/kakao', kakaoLogin);
router.get('/auth/kakao/callback', kakaoCallback);

module.exports = router;
