process.env.JWT_SECRET = 'test-secret';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { User, Draw, Counter } = require('../src/models');

const ME = '64b7f0f0f0f0f0f0f0f0f0a1';
const OTHER = '64b7f0f0f0f0f0f0f0f0f0b2';
const DRAW_ID = '64b7f0f0f0f0f0f0f0f0f0f0';
const cookie = [`token=${jwt.sign({ uid: ME }, 'test-secret')}`];

const loginAs = (user_type) =>
  jest.spyOn(User, 'findById').mockResolvedValue({ _id: ME, user_type });

afterEach(() => {
  jest.restoreAllMocks();
});

describe('누구나 추첨 만들기 + 번호', () => {
  const body = {
    title: '점심 쏘기',
    winnerCount: 1,
    drawAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  };

  it('일반 회원도 만들 수 있고, 다음 번호가 붙는다', async () => {
    loginAs('user');
    jest.spyOn(Counter, 'nextDrawNo').mockResolvedValue('20261026-3');
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
      .set('Cookie', cookie)
      .send(body);

    expect(res.statusCode).toBe(200);
    expect(createSpy.mock.calls[0][0].no).toBe('20261026-3');
    expect(res.body.draw.no).toBe('20261026-3');
    expect(res.body.draw.canManage).toBe(true); // 만든 사람
  });
});

describe('마감/실행 권한: 만든 사람 또는 관리자', () => {
  const draw = (createdBy) => ({
    _id: DRAW_ID,
    createdBy,
    status: 'open',
    participants: [],
    winnerCount: 1,
  });
  const mockFind = (createdBy) => {
    const d = draw(createdBy);
    // close 는 문서를, run 은 .select() 가 붙은 쿼리를 쓴다
    return jest
      .spyOn(Draw, 'findById')
      .mockReturnValue(Object.assign(Promise.resolve(d), { select: () => d }));
  };

  it('남이 만든 추첨을 일반 회원이 마감하려 하면 403', async () => {
    loginAs('user');
    mockFind(OTHER);

    const res = await request(app)
      .post(`/api/draws/${DRAW_ID}/close`)
      .set('Cookie', cookie);

    expect(res.statusCode).toBe(403);
  });

  it('남이 만든 추첨을 일반 회원이 실행하려 해도 403', async () => {
    loginAs('user');
    mockFind(OTHER);
    const updateSpy = jest.spyOn(Draw, 'findOneAndUpdate');

    const res = await request(app)
      .post(`/api/draws/${DRAW_ID}/run`)
      .set('Cookie', cookie);

    expect(res.statusCode).toBe(403);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('만든 사람은 권한 검사를 통과한다 (참여자가 모자라서 400)', async () => {
    loginAs('user');
    mockFind(ME);

    const res = await request(app)
      .post(`/api/draws/${DRAW_ID}/close`)
      .set('Cookie', cookie);

    expect(res.statusCode).toBe(400);
  });

  it('관리자는 남이 만든 추첨도 다룰 수 있다 (참여자가 모자라서 400)', async () => {
    loginAs('admin');
    mockFind(OTHER);

    const res = await request(app)
      .post(`/api/draws/${DRAW_ID}/close`)
      .set('Cookie', cookie);

    expect(res.statusCode).toBe(400);
  });
});

describe('번호/이름 검색', () => {
  const searchWith = async (q) => {
    loginAs('user');
    const findSpy = jest.spyOn(Draw, 'find').mockReturnValue({
      sort: () => ({ limit: () => Promise.resolve([]) }),
    });
    const res = await request(app)
      .get('/api/draws')
      .query({ q })
      .set('Cookie', cookie);
    return { res, filter: findSpy.mock.calls[0][0] };
  };

  it.each([
    '20261026-3',
    '#20261026-3',
    'No.20261026-3',
    'no 20261026-03',
    '20261026 - 3',
  ])("'%s' 는 20261026-3 번 추첨 하나를 찾는다", async (q) => {
    const { res, filter } = await searchWith(q);

    expect(res.statusCode).toBe(200);
    expect(filter.$or[0]).toEqual({ no: '20261026-3' });
    // 이름 검색은 입력한 글자 그대로 함께 한다
    expect(filter.$or[1].title.test(`회식 ${q} 모임`)).toBe(true);
  });

  it('날짜만 쓰면 그날의 모든 추첨을 찾는다', async () => {
    const { filter } = await searchWith('20261026');

    expect(filter.$or[0].no.test('20261026-1')).toBe(true);
    expect(filter.$or[0].no.test('20261026-27')).toBe(true);
    expect(filter.$or[0].no.test('20261027-1')).toBe(false);
  });

  it('짧은 숫자는 번호가 아니라 이름으로만 찾는다', async () => {
    const { filter } = await searchWith('12');

    expect(filter.$or).toBeUndefined();
    expect(filter.title.test('12월 회식')).toBe(true);
  });

  it('글자는 이름으로만 찾는다', async () => {
    const { filter } = await searchWith('점심');

    expect(filter.$or).toBeUndefined();
    expect(filter.title.test('오늘 점심 쏘기')).toBe(true);
    expect(filter.title.test('저녁')).toBe(false);
  });

  it('검색어의 정규식 문자는 글자 그대로 취급한다', async () => {
    const { filter } = await searchWith('.*');

    expect(filter.title.test('abc')).toBe(false);
    expect(filter.title.test('a.*b')).toBe(true);
  });

  it('검색어가 없으면 전체를 보여준다', async () => {
    const { filter } = await searchWith('');

    expect(filter).toEqual({});
  });
});
