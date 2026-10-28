process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI =
  'http://localhost:5000/api/auth/google/callback';
process.env.CLIENT_URL = 'http://localhost:5173';

const request = require('supertest');
const app = require('../src/app');

const LOGIN_ERROR = 'http://localhost:5173/#/login?error=google';

describe('GET /api/auth/google', () => {
  it('구글 동의 화면으로 보내고 state 쿠키를 만든다', async () => {
    const res = await request(app).get('/api/auth/google');

    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth'
    );
    expect(location.searchParams.get('client_id')).toBe('test-client-id');
    expect(location.searchParams.get('scope')).toBe('openid email profile');
    expect(location.searchParams.get('state')).toMatch(/^[0-9a-f]{32}$/);
    expect(res.headers['set-cookie'].join(';')).toMatch(/oauth_state=/);
  });

  it('설정이 없으면 503', async () => {
    const saved = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    const res = await request(app).get('/api/auth/google');
    process.env.GOOGLE_CLIENT_ID = saved;

    expect(res.statusCode).toBe(503);
  });
});

describe('GET /api/auth/google/callback 실패 경로 (DB 호출 전에 막힘)', () => {
  it('state 쿠키가 없으면 로그인 화면으로 돌려보낸다', async () => {
    const res = await request(app).get(
      '/api/auth/google/callback?code=abc&state=xyz'
    );

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(LOGIN_ERROR);
  });

  it('state 가 쿠키와 다르면 실패한다', async () => {
    const res = await request(app)
      .get('/api/auth/google/callback?code=abc&state=attacker')
      .set('Cookie', 'oauth_state=legit');

    expect(res.headers.location).toBe(LOGIN_ERROR);
  });

  it('사용자가 동의를 거부하면 실패한다', async () => {
    const res = await request(app)
      .get('/api/auth/google/callback?error=access_denied&state=s')
      .set('Cookie', 'oauth_state=s');

    expect(res.headers.location).toBe(LOGIN_ERROR);
  });
});
