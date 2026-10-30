const request = require('supertest');
const app = require('../src/app');

describe('GET /api/health', () => {
  it('returns ok status', async () => {
    const res = await request(app).get('/api/health');

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('unknown route', () => {
  it('returns 404 json', async () => {
    const res = await request(app).get('/api/unknown');

    expect(res.statusCode).toBe(404);
    expect(res.body.message).toBe('Not Found');
  });
});
