process.env.KAKAO_CLIENT_ID = 'test-kakao-rest-api-key';
process.env.KAKAO_CLIENT_SECRET = 'test-kakao-client-secret';
process.env.KAKAO_REDIRECT_URI =
  'http://localhost:5000/api/auth/kakao/callback';
process.env.CLIENT_URL = 'http://localhost:5173';

const request = require('supertest');
const app = require('../src/app');

const LOGIN_ERROR = 'http://localhost:5173/#/login?error=kakao';

describe('GET /api/auth/kakao', () => {
  it('카카오 동의 화면으로 보내고 state 쿠키를 만든다', async () => {
    const res = await request(app).get('/api/auth/kakao');

    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe(
      'https://kauth.kakao.com/oauth/authorize'
    );
    expect(location.searchParams.get('client_id')).toBe(
      'test-kakao-rest-api-key'
    );
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:5000/api/auth/kakao/callback'
    );
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('state')).toMatch(/^[0-9a-f]{32}$/);
    expect(location.searchParams.has('scope')).toBe(false);
    expect(res.headers['set-cookie'].join(';')).toMatch(/oauth_state=/);
  });

  it('설정이 없으면 503', async () => {
    const saved = process.env.KAKAO_CLIENT_SECRET;
    delete process.env.KAKAO_CLIENT_SECRET;
    const res = await request(app).get('/api/auth/kakao');
    process.env.KAKAO_CLIENT_SECRET = saved;

    expect(res.statusCode).toBe(503);
  });
});

describe('GET /api/auth/kakao/callback 실패 경로 (DB 호출 전에 막힘)', () => {
  it('state 쿠키가 없으면 로그인 화면으로 돌려보낸다', async () => {
    const res = await request(app).get(
      '/api/auth/kakao/callback?code=abc&state=xyz'
    );

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(LOGIN_ERROR);
  });

  it('state 가 쿠키와 다르면 실패한다', async () => {
    const res = await request(app)
      .get('/api/auth/kakao/callback?code=abc&state=attacker')
      .set('Cookie', 'oauth_state=legit');

    expect(res.headers.location).toBe(LOGIN_ERROR);
  });

  it('사용자가 취소하면 실패한다', async () => {
    const res = await request(app)
      .get('/api/auth/kakao/callback?error=access_denied&state=s')
      .set('Cookie', 'oauth_state=s');

    expect(res.headers.location).toBe(LOGIN_ERROR);
  });
});
