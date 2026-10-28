process.env.NAVER_CLIENT_ID = 'test-naver-client-id';
process.env.NAVER_CLIENT_SECRET = 'test-naver-client-secret';
process.env.NAVER_REDIRECT_URI =
  'http://localhost:5000/api/auth/naver/callback';
process.env.CLIENT_URL = 'http://localhost:5173';

const request = require('supertest');
const app = require('../src/app');

const LOGIN_ERROR = 'http://localhost:5173/#/login?error=naver';

describe('GET /api/auth/naver', () => {
  it('네이버 동의 화면으로 보내고 state 쿠키를 만든다', async () => {
    const res = await request(app).get('/api/auth/naver');

    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe(
      'https://nid.naver.com/oauth2.0/authorize'
    );
    expect(location.searchParams.get('client_id')).toBe('test-naver-client-id');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('state')).toMatch(/^[0-9a-f]{32}$/);
    expect(location.searchParams.has('scope')).toBe(false);
    expect(res.headers['set-cookie'].join(';')).toMatch(/oauth_state=/);
  });

  it('설정이 없으면 503', async () => {
    const saved = process.env.NAVER_CLIENT_ID;
    delete process.env.NAVER_CLIENT_ID;
    const res = await request(app).get('/api/auth/naver');
    process.env.NAVER_CLIENT_ID = saved;

    expect(res.statusCode).toBe(503);
  });
});

describe('GET /api/auth/naver/callback 실패 경로 (DB 호출 전에 막힘)', () => {
  it('state 쿠키가 없으면 로그인 화면으로 돌려보낸다', async () => {
    const res = await request(app).get(
      '/api/auth/naver/callback?code=abc&state=xyz'
    );

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(LOGIN_ERROR);
  });

  it('state 가 쿠키와 다르면 실패한다', async () => {
    const res = await request(app)
      .get('/api/auth/naver/callback?code=abc&state=attacker')
      .set('Cookie', 'oauth_state=legit');

    expect(res.headers.location).toBe(LOGIN_ERROR);
  });

  it('사용자가 취소하면 실패한다', async () => {
    const res = await request(app)
      .get('/api/auth/naver/callback?error=access_denied&state=s')
      .set('Cookie', 'oauth_state=s');

    expect(res.headers.location).toBe(LOGIN_ERROR);
  });
});
