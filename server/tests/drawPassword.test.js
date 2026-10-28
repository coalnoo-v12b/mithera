process.env.JWT_SECRET = 'test-secret';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const { User, Draw, Counter } = require('../src/models');

const DRAW_ID = '64b7f0f0f0f0f0f0f0f0f0f0';
const cookie = (uid) => [`token=${jwt.sign({ uid }, 'test-secret')}`];

const loginAs = (user_type) =>
  jest.spyOn(User, 'findById').mockResolvedValue({
    _id: '64b7f0f0f0f0f0f0f0f0f0a1',
    user_type,
  });

describe('참여 비밀번호', () => {
  let passwordHash;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash('open-sesame', 4);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const mockDraw = (extra = {}) =>
    jest.spyOn(Draw, 'findById').mockReturnValue({
      select: () =>
        Promise.resolve({ hasPassword: true, passwordHash, ...extra }),
    });

  const join = (body) =>
    request(app)
      .post(`/api/draws/${DRAW_ID}/join`)
      .set('Cookie', cookie('64b7f0f0f0f0f0f0f0f0f0a1'))
      .send(body);

  it('비밀번호를 안 보내면 403', async () => {
    loginAs('user');
    mockDraw();

    const res = await join({});

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('참여 비밀번호가 맞지 않아요');
  });

  it('비밀번호가 틀리면 403, 참여자 목록은 건드리지 않는다', async () => {
    loginAs('user');
    mockDraw();
    const updateSpy = jest.spyOn(Draw, 'updateOne');

    const res = await join({ password: 'wrong' });

    expect(res.statusCode).toBe(403);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('비밀번호가 맞으면 참여된다', async () => {
    loginAs('user');
    mockDraw();
    const updateSpy = jest
      .spyOn(Draw, 'updateOne')
      .mockResolvedValue({ matchedCount: 1 });

    const res = await join({ password: 'open-sesame' });

    expect(res.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it('비밀번호가 없는 추첨은 비밀번호 없이 참여된다', async () => {
    loginAs('user');
    mockDraw({ hasPassword: false, passwordHash: undefined });
    jest.spyOn(Draw, 'updateOne').mockResolvedValue({ matchedCount: 1 });

    const res = await join({});

    expect(res.statusCode).toBe(200);
  });

  it('추첨을 만들 때 비밀번호가 너무 짧으면 400', async () => {
    loginAs('admin');
    const createSpy = jest.spyOn(Draw, 'create');

    const res = await request(app)
      .post('/api/draws')
      .set('Cookie', cookie('64b7f0f0f0f0f0f0f0f0f0a1'))
      .send({
        title: '비밀 추첨',
        winnerCount: 1,
        drawAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        password: 'abc',
      });

    expect(res.statusCode).toBe(400);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('추첨을 만들 때 비밀번호는 해시로만 저장하고, 응답에는 포함하지 않는다', async () => {
    loginAs('admin');
    jest.spyOn(Counter, 'nextDrawNo').mockResolvedValue(1);
    const createSpy = jest
      .spyOn(Draw, 'create')
      .mockImplementation(async (doc) => ({
        _id: DRAW_ID,
        participants: [],
        createdAt: new Date(),
        ...doc,
      }));
    jest.spyOn(User, 'find').mockResolvedValue([]);

    const res = await request(app)
      .post('/api/draws')
      .set('Cookie', cookie('64b7f0f0f0f0f0f0f0f0f0a1'))
      .send({
        title: '비밀 추첨',
        winnerCount: 1,
        drawAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        password: 'open-sesame',
      });

    const saved = createSpy.mock.calls[0][0];
    expect(res.statusCode).toBe(200);
    expect(saved.hasPassword).toBe(true);
    expect(saved.passwordHash).not.toContain('open-sesame');
    expect(await bcrypt.compare('open-sesame', saved.passwordHash)).toBe(true);
    expect(res.body.draw.hasPassword).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('open-sesame');
    expect(JSON.stringify(res.body)).not.toContain(saved.passwordHash);
  });
});
