process.env.JWT_SECRET = 'test-secret';

const request = require('supertest');
const app = require('../src/app');
const { User, Draw, DrawResult } = require('../src/models');

describe('GET /api/public-stats', () => {
  let countSpy;
  let userCountSpy;
  let findSpy;

  beforeAll(() => {
    userCountSpy = jest.spyOn(User, 'countDocuments').mockResolvedValue(7);
    countSpy = jest.spyOn(Draw, 'countDocuments').mockResolvedValue(3);
    findSpy = jest
      .spyOn(DrawResult, 'find')
      .mockReturnValue({ sort: () => Promise.resolve([]) });
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('로그인 없이 숫자 통계만 돌려준다', async () => {
    const res = await request(app).get('/api/public-stats');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      users: 7,
      drawn: 3,
      results: 0,
      chainOk: true,
    });
  });

  it('60초 동안은 DB 를 다시 읽지 않고 캐시를 쓴다', async () => {
    await request(app).get('/api/public-stats');
    await request(app).get('/api/public-stats');

    expect(userCountSpy).toHaveBeenCalledTimes(1);
    expect(countSpy).toHaveBeenCalledTimes(1);
    expect(findSpy).toHaveBeenCalledTimes(1);
  });
});
