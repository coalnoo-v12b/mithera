const jwt = require('jsonwebtoken');

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
};

const isAdminEmail = (email) => {
  const adminEmail = String(process.env.ADMIN_EMAIL || '')
    .trim()
    .toLowerCase();
  return !!adminEmail && String(email).toLowerCase() === adminEmail;
};

const publicUser = (u) => ({
  id: String(u._id),
  nickname: u.nickname,
  email: u.email,
  user_type: u.user_type,
  isAdmin: u.user_type === 'admin',
});

// ADMIN_EMAIL 로 가입/로그인한 계정은 admin 으로 승격 (그 외는 기본 user)
async function syncUserType(user) {
  if (isAdminEmail(user.email) && user.user_type !== 'admin') {
    user.user_type = 'admin';
    await user.save();
  }
}

function setAuthCookie(res, user) {
  const token = jwt.sign({ uid: String(user._id) }, getJwtSecret(), {
    expiresIn: '30d',
  });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: THIRTY_DAYS,
  });
}

// 마지막으로 로그인한 방식(email, google, naver, kakao)을 기억한다.
// 로그인 정보가 아니라서 JavaScript에서 읽을 수 있게 httpOnly 를 쓰지 않는다.
function markLastLogin(res, method) {
  res.cookie('last_login', method, {
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
}

module.exports = {
  getJwtSecret,
  isAdminEmail,
  publicUser,
  syncUserType,
  setAuthCookie,
  markLastLogin,
};
