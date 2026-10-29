process.env.JWT_SECRET = 'test-secret';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { User, Draw } = require('../src/models');

const ME = '64b7f0f0f0f0f0f0f0f0f0a1';
const OTHER = '64b7f0f0f0f0f0f0f0f0f0b2';
const cookie = [`token=${jwt.sign({ uid: ME }, 'test-secret')}`];

afterEach(() => {
  jest.restoreAllMocks();
});

const listWith = async (query, docs = []) => {
  jest
    .spyOn(User, 'findById')
    .mockResolvedValue({ _id: ME, user_type: 'user' });
  const findSpy = jest.spyOn(Draw, 'find').mockReturnValue({
    sort: () => ({ limit: () => ({ populate: () => Promise.resolve(docs) }) }),
  });
  const res = await request(app)
    .get('/api/draws')
    .query(query)
    .set('Cookie', cookie);
  return { res, filter: findSpy.mock.calls[0][0] };
};

describe('GET /api/draws 범위 필터', () => {
  it('filter=joined 는 내가 참여한 추첨만', async () => {
    const { res, filter } = await listWith({ filter: 'joined' });

    expect(res.statusCode).toBe(200);
    expect(filter).toEqual({ participants: ME });
  });

  it('filter=mine 은 내가 만든 추첨만', async () => {
    const { filter } = await listWith({ filter: 'mine' });

    expect(filter).toEqual({ createdBy: ME });
  });

  it('검색어와 함께 쓰면 둘 다 만족하는 추첨만 (and)', async () => {
    const { filter } = await listWith({ filter: 'mine', q: '점심' });

    expect(filter.$and).toHaveLength(2);
    expect(filter.$and[0]).toEqual({ createdBy: ME });
    expect(filter.$and[1].title.test('오늘 점심')).toBe(true);
  });

  it('알 수 없는 filter 값은 무시하고 전체를 보여준다', async () => {
    const { filter } = await listWith({ filter: 'everything' });

    expect(filter).toEqual({});
  });

  it('각 추첨에 내가 만든 것인지(mine) 표시한다', async () => {
    const docs = [
      { _id: 'a1', createdBy: ME, participants: [] },
      { _id: 'a2', createdBy: OTHER, participants: [ME] },
    ];
    const { res } = await listWith({}, docs);

    expect(res.body.draws.map((d) => [d.mine, d.joined])).toEqual([
      [true, false],
      [false, true],
    ]);
  });
});
