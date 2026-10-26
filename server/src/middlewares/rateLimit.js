const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '시도가 너무 많아요. 잠시 후 다시 해줘' },
});

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '요청이 너무 많아요. 잠시 후 다시 해줘' },
});

// 참여 비밀번호를 계속 바꿔 가며 대입하는 시도를 막는다
const joinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '시도가 너무 많아요. 잠시 후 다시 해줘' },
});

// 누구나 추첨을 만들 수 있으니, 도배를 막기 위해 한 시간에 20개까지
const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '추첨을 너무 많이 만들었어요. 잠시 후 다시 해줘' },
});

module.exports = { authLimiter, publicLimiter, joinLimiter, createLimiter };
