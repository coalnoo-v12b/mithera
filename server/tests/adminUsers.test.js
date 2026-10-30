process.env.JWT_SECRET = 'test-secret';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { User } = require('../src/models');

const ADMIN = '64b7f0f0f0f0f0f0f0f0f0a1';
const cookie = [`token=${jwt.sign({ uid: ADMIN }, 'test-secret')}`];

afterEach(() => {
  jest.restoreAllMocks();
});

const listWith = async (query, total = 0, docs = []) => {
  jest
    .spyOn(User, 'findById')
    .mockResolvedValue({ _id: ADMIN, user_type: 'admin' });
  jest.spyOn(User, 'countDocuments').mockResolvedValue(total);
  const calls = {};
  jest.spyOn(User, 'find').mockImplementation((filter) => {
    calls.filter = filter;
    const chain = {
      sort: () => chain,
      skip: (n) => {
        calls.skip = n;
        return chain;
      },
      limit: (n) => {
        calls.limit = n;
        return Promise.resolve(docs);
      },
    };
    return chain;
  });
  const res = await request(app)
    .get('/api/admin/users')
    .query(query)
    .set('Cookie', cookie);
  return { res, calls };
};

describe('GET /api/admin/users 페이지와 권한 필터', () => {
  it('권한 필터가 없으면 전체를 10명씩 첫 페이지부터 준다', async () => {
    const { res, calls } = await listWith({}, 25);

    expect(res.statusCode).toBe(200);
    expect(calls.filter).toEqual({});
    expect(calls.skip).toBe(0);
    expect(calls.limit).toBe(10);
    expect(res.body).toMatchObject({ page: 1, pages: 3, total: 25 });
  });

  it('type=admin 은 admin 회원만 찾는다', async () => {
    const { calls } = await listWith({ type: 'admin' }, 4);

    expect(calls.filter).toEqual({ user_type: 'admin' });
  });

  it('알 수 없는 type 은 무시한다', async () => {
    const { calls } = await listWith({ type: 'root' }, 4);

    expect(calls.filter).toEqual({});
  });

  it('2페이지는 앞의 10명을 건너뛴다', async () => {
    const { res, calls } = await listWith({ page: '2' }, 25);

    expect(calls.skip).toBe(10);
    expect(res.body.page).toBe(2);
  });

  it('마지막 페이지를 넘기면 마지막 페이지로 맞춘다', async () => {
    const { res, calls } = await listWith({ page: '99' }, 25);

    expect(res.body.page).toBe(3);
    expect(calls.skip).toBe(20);
  });

  it('검색어와 권한 필터를 함께 쓸 수 있다', async () => {
    const { calls } = await listWith({ q: 'kim', type: 'user' }, 1);

    expect(calls.filter.$and).toHaveLength(2);
    expect(calls.filter.$and[1]).toEqual({ user_type: 'user' });
  });
});
