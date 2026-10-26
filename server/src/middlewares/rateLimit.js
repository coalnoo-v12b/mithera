const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '시도가 너무 많아요. 잠시 후 다시 해줘' },
});

module.exports = { authLimiter };
