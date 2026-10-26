const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { getJwtSecret } = require('../utils/auth');
const { fail } = require('../utils/http');

const TOKEN_ERRORS = [
  'JsonWebTokenError',
  'TokenExpiredError',
  'NotBeforeError',
];

async function auth(req, res, next) {
  try {
    const p = jwt.verify(
      (req.cookies && req.cookies.token) || '',
      getJwtSecret()
    );
    const user = await User.findById(p.uid);
    if (user) {
      req.user = user;
      req.isAdmin = user.user_type === 'admin';
      return next();
    }
  } catch (e) {
    if (!TOKEN_ERRORS.includes(e.name)) return next(e);
  }
  fail(res, 401, '로그인이 필요해요');
}

const adminOnly = (req, res, next) =>
  req.isAdmin ? next() : fail(res, 403, '관리자만 할 수 있어요');

module.exports = { auth, adminOnly };
