process.env.JWT_SECRET = 'test-secret';

const request = require('supertest');
const app = require('../src/app');

describe('로그인이 필요한 API', () => {
  it.each([
    ['get', '/api/me'],
    ['get', '/api/draws'],
    ['post', '/api/draws/abc/join'],
    ['get', '/api/stats'],
    ['get', '/api/admin/summary'],
  ])('%s %s 는 로그인 없이 401', async (method, url) => {
    const res = await request(app)[method](url);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('로그인이 필요해요');
  });
});

describe('POST /api/signup 입력 검증', () => {
  it('이메일 형식이 틀리면 400', async () => {
    const res = await request(app)
      .post('/api/signup')
      .send({ email: 'nope', password: '12345678', nickname: 'a' });

    expect(res.statusCode).toBe(400);
  });

  it('본문이 없어도 서버 오류 없이 400', async () => {
    const res = await request(app).post('/api/signup');

    expect(res.statusCode).toBe(400);
  });
});
