const crypto = require('crypto');
const { User } = require('../models');
const { isAdminEmail, setAuthCookie } = require('../utils/auth');
const { fail } = require('../utils/http');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const STATE_COOKIE = 'oauth_state';
const STATE_MAX_AGE = 10 * 60 * 1000;

const clientUrl = () => process.env.CLIENT_URL || 'http://localhost:5173';

const googleConfig = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
};

const loginFailed = (res) =>
  res.redirect(`${clientUrl()}/#/login?error=google`);

// 구글 로그인 시작: state 를 쿠키에 담고 구글 동의 화면으로 보낸다
const googleLogin = (req, res) => {
  const cfg = googleConfig();
  if (!cfg) return fail(res, 503, '구글 로그인이 아직 설정되지 않았어요');

  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: STATE_MAX_AGE,
  });
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
  });
  res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
};

// 같은 제공자 ID가 있으면 그 계정으로 로그인, 없으면 새 계정을 만든다.
// 같은 이메일의 기존 계정과는 합치지 않는다 (이메일은 비워 둔다).
const findOrCreateSocialUser = async (provider, info) => {
  const existing = await User.findOne({
    providers: { $elemMatch: { provider, providerId: info.sub } },
  });
  if (existing) return existing;

  const verifiedEmail =
    info.email_verified && info.email ? String(info.email).toLowerCase() : '';
  const emailTaken =
    verifiedEmail && (await User.exists({ email: verifiedEmail }));
  const email = verifiedEmail && !emailTaken ? verifiedEmail : undefined;
  const nickname =
    String(info.name || '')
      .trim()
      .slice(0, 20) || '구글 사용자';

  return User.create({
    email,
    nickname,
    providers: [{ provider, providerId: info.sub }],
    user_type: email && isAdminEmail(email) ? 'admin' : 'user',
  });
};

// 구글 로그인 콜백: state 검증 → 코드를 토큰으로 교환 → 사용자 정보 조회 → 로그인
const googleCallback = async (req, res) => {
  const { code, state, error } = req.query;
  const expected = req.cookies && req.cookies[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE);

  if (error || !code || !state || !expected || state !== expected) {
    return loginFailed(res);
  }
  const cfg = googleConfig();
  if (!cfg) return loginFailed(res);

  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) return loginFailed(res);
    const { access_token: accessToken } = await tokenRes.json();

    const infoRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!infoRes.ok) return loginFailed(res);
    const info = await infoRes.json();
    if (!info.sub) return loginFailed(res);

    const user = await findOrCreateSocialUser('google', info);
    setAuthCookie(res, user);
    res.redirect(`${clientUrl()}/#/`);
  } catch (err) {
    console.error(err);
    loginFailed(res);
  }
};

module.exports = { googleLogin, googleCallback };
