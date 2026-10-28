const crypto = require('crypto');
const { User } = require('../models');
const { isAdminEmail, setAuthCookie } = require('../utils/auth');
const { fail } = require('../utils/http');

const STATE_COOKIE = 'oauth_state';
const STATE_MAX_AGE = 10 * 60 * 1000;

const clientUrl = () => process.env.CLIENT_URL || 'http://localhost:5173';

const readConfig = (prefix) => {
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  const redirectUri = process.env[`${prefix}_REDIRECT_URI`];
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
};

// 제공자별 차이는 여기에만 둔다. 각 함수는 { providerId, email, emailVerified, name } 을 돌려주거나 실패 시 null
const PROVIDERS = {
  google: {
    label: '구글',
    prefix: 'GOOGLE',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: 'openid email profile',
    async fetchProfile(cfg, code) {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          redirect_uri: cfg.redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) return null;
      const { access_token: accessToken } = await tokenRes.json();

      const infoRes = await fetch(
        'https://openidconnect.googleapis.com/v1/userinfo',
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!infoRes.ok) return null;
      const info = await infoRes.json();
      if (!info.sub) return null;
      return {
        providerId: info.sub,
        email: info.email,
        emailVerified: info.email_verified === true,
        name: info.name,
      };
    },
  },
  naver: {
    label: '네이버',
    prefix: 'NAVER',
    authUrl: 'https://nid.naver.com/oauth2.0/authorize',
    scope: null,
    async fetchProfile(cfg, code, state) {
      // 네이버 토큰 교환은 GET 요청이다
      const tokenRes = await fetch(
        `https://nid.naver.com/oauth2.0/token?${new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          code,
          state,
        })}`
      );
      if (!tokenRes.ok) return null;
      const { access_token: accessToken } = await tokenRes.json();
      if (!accessToken) return null;

      const infoRes = await fetch('https://openapi.naver.com/v1/nid/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!infoRes.ok) return null;
      const { resultcode, response } = await infoRes.json();
      if (resultcode !== '00' || !response || !response.id) return null;
      return {
        providerId: response.id,
        email: response.email,
        // 네이버는 이메일 인증 여부를 주지 않아서 검증된 것으로 보지 않는다
        emailVerified: false,
        name: response.name || response.nickname,
      };
    },
  },
};

// 같은 제공자 ID가 있으면 그 계정으로 로그인, 없으면 새 계정을 만든다.
// 같은 이메일의 기존 계정과는 합치지 않는다 (이메일은 비워 둔다).
const findOrCreateSocialUser = async (provider, profile) => {
  const existing = await User.findOne({
    providers: {
      $elemMatch: { provider, providerId: profile.providerId },
    },
  });
  if (existing) return existing;

  const verifiedEmail =
    profile.emailVerified && profile.email
      ? String(profile.email).toLowerCase()
      : '';
  const emailTaken =
    verifiedEmail && (await User.exists({ email: verifiedEmail }));
  const email = verifiedEmail && !emailTaken ? verifiedEmail : undefined;
  const nickname =
    String(profile.name || '')
      .trim()
      .slice(0, 20) || `${PROVIDERS[provider].label} 사용자`;

  return User.create({
    email,
    nickname,
    providers: [{ provider, providerId: profile.providerId }],
    user_type: email && isAdminEmail(email) ? 'admin' : 'user',
  });
};

const loginFailed = (res, key) =>
  res.redirect(`${clientUrl()}/#/login?error=${key}`);

// 로그인 시작: state 를 쿠키에 담고 제공자의 동의 화면으로 보낸다
const startLogin = (key) => (req, res) => {
  const provider = PROVIDERS[key];
  const cfg = readConfig(provider.prefix);
  if (!cfg) {
    return fail(res, 503, `${provider.label} 로그인이 아직 설정되지 않았어요`);
  }

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
    state,
    ...(provider.scope ? { scope: provider.scope } : {}),
  });
  res.redirect(`${provider.authUrl}?${params}`);
};

// 콜백: state 검증 → 토큰 교환과 사용자 정보 조회 → 로그인
const finishLogin = (key) => async (req, res) => {
  const { code, state, error } = req.query;
  const expected = req.cookies && req.cookies[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE);

  if (error || !code || !state || !expected || state !== expected) {
    return loginFailed(res, key);
  }
  const provider = PROVIDERS[key];
  const cfg = readConfig(provider.prefix);
  if (!cfg) return loginFailed(res, key);

  try {
    const profile = await provider.fetchProfile(cfg, String(code), state);
    if (!profile) return loginFailed(res, key);

    const user = await findOrCreateSocialUser(key, profile);
    setAuthCookie(res, user);
    res.redirect(`${clientUrl()}/#/`);
  } catch (err) {
    console.error(err);
    loginFailed(res, key);
  }
};

module.exports = {
  googleLogin: startLogin('google'),
  googleCallback: finishLogin('google'),
  naverLogin: startLogin('naver'),
  naverCallback: finishLogin('naver'),
};
