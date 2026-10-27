process.env.JWT_SECRET = 'test-secret';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const lotto = require('../src/utils/lotto');
const { User, Draw } = require('../src/models');

const seed = 'ab'.repeat(32);
const ME = '64b7f0f0f0f0f0f0f0f0f0a1';
const DRAW_ID = '64b7f0f0f0f0f0f0f0f0f0f0';
const cookie = [`token=${jwt.sign({ uid: ME }, 'test-secret')}`];

jest.setTimeout(60000);

describe('로또 추첨기 물리 시뮬레이션', () => {
  let sim;
  let rec;

  beforeAll(async () => {
    sim = await lotto.simulate({ seed, n: 12, winnerCount: 3 });
    rec = JSON.parse(sim.raw);
  });

  it('같은 seed 면 녹화가 한 글자도 다르지 않다', async () => {
    const again = await lotto.simulate({ seed, n: 12, winnerCount: 3 });
    expect(again.raw).toBe(sim.raw);
  });

  it('seed 가 다르면 다른 경기가 된다', async () => {
    const other = await lotto.simulate({
      seed: 'cd'.repeat(32),
      n: 12,
      winnerCount: 3,
    });
    expect(other.raw).not.toBe(sim.raw);
  });

  it('당첨 인원만큼 중복 없이 공이 뽑힌다', () => {
    expect(sim.order).toHaveLength(3);
    expect(new Set(sim.order).size).toBe(3);
    sim.order.forEach((i) => {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(12);
    });
  });

  it('녹화에 뽑힌 순서, 도착 순서, 기계 치수가 담긴다', () => {
    expect(rec.kind).toBe('lotto');
    expect(rec.order).toEqual(sim.order);
    expect(rec.captures.map(([i]) => i)).toEqual(sim.order);
    expect(rec.arrivals.map(([i]) => i)).toEqual(sim.order);
    expect(rec.pos).toHaveLength(12);
    rec.pos.forEach((p) => expect(p).toHaveLength(rec.frames * 3));
    expect(rec.layout.slots).toHaveLength(3);
    expect(sim.engine).toMatch(/^rapier3d-compat@\S+ lotto-v1 /);
  });

  it('뽑힌 공은 뽑힌 순간 배출관 안에 있다', () => {
    const { holeY, holeR } = rec.layout;
    for (const [i, frame] of rec.captures) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (let f = 0; f <= frame; f++) {
        x += rec.pos[i][f * 3];
        y += rec.pos[i][f * 3 + 1];
        z += rec.pos[i][f * 3 + 2];
      }
      expect(y / 1000).toBeGreaterThan(holeY - 0.3);
      expect(Math.sqrt(x * x + z * z) / 1000).toBeLessThan(holeR + 0.3);
    }
  });

  it('엔진 이름에서 물리 조건 버전을 읽는다', () => {
    expect(lotto.versionOf(sim.engine)).toBe('lotto-v1');
    expect(lotto.versionOf(null)).toBe(lotto.LATEST);
  });

  it('공 수와 당첨 인원 한도를 넘으면 거절한다', async () => {
    await expect(
      lotto.simulate({ seed, n: lotto.MAX_BALLS + 1, winnerCount: 1 })
    ).rejects.toThrow();
    await expect(
      lotto.simulate({ seed, n: 5, winnerCount: 6 })
    ).rejects.toThrow();
  });
});

describe('로또 추첨기 인원 제한', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const loginAs = () =>
    jest
      .spyOn(User, 'findById')
      .mockResolvedValue({ _id: ME, user_type: 'user' });

  it(`당첨 인원이 ${lotto.MAX_WINNERS}명을 넘으면 만들 수 없다`, async () => {
    loginAs();
    const createSpy = jest.spyOn(Draw, 'create');
    const res = await request(app)
      .post('/api/draws')
      .set('Cookie', cookie)
      .send({
        title: '로또',
        style: 'lotto',
        winnerCount: lotto.MAX_WINNERS + 1,
        drawAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      });
    expect(res.statusCode).toBe(400);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it(`참여자가 ${lotto.MAX_BALLS}명이면 더 참여할 수 없다`, async () => {
    loginAs();
    const others = Array.from(
      { length: lotto.MAX_BALLS },
      (_, k) => `64b7f0f0f0f0f0f0f0f${String(k).padStart(5, '0')}`
    );
    jest.spyOn(Draw, 'findById').mockReturnValue({
      select: () =>
        Promise.resolve({
          style: 'lotto',
          status: 'open',
          participants: others,
        }),
    });
    jest.spyOn(Draw, 'updateOne').mockResolvedValue({ matchedCount: 0 });
    const res = await request(app)
      .post(`/api/draws/${DRAW_ID}/join`)
      .set('Cookie', cookie)
      .send({});
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/최대/);
  });
});

describe('로또 추첨기 실행과 검증 (DB 는 메모리 흉내)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // mongoose 쿼리처럼 await 도 되고 .select()/.sort() 도 이어 쓸 수 있는 값
  const q = (v) => ({
    select: () => q(v),
    sort: () => q(v),
    then: (ok, bad) => Promise.resolve(v).then(ok, bad),
  });

  it('물리 엔진이 정한 당첨자로 결과를 저장하고, 서버 검증을 모두 통과한다', async () => {
    const { RaceRecording, DrawResult } = require('../src/models');
    const { sha256 } = require('../src/utils/lottery');
    const ids = [
      ME,
      ...Array.from({ length: 7 }, (_, k) => `64b7f0f0f0f0f0f0f0f0f1${k}0`),
    ];
    const drawSeed = 'ef'.repeat(32);
    const draw = {
      _id: DRAW_ID,
      title: '간식 로또',
      style: 'lotto',
      status: 'closed',
      winnerCount: 3,
      participants: ids,
      createdBy: ME,
      seed: drawSeed,
      commitment: sha256(drawSeed),
      participantsHash: sha256([...ids].sort().join(',')),
    };
    const store = { rec: null, result: null };

    jest
      .spyOn(User, 'findById')
      .mockResolvedValue({ _id: ME, user_type: 'user' });
    jest
      .spyOn(User, 'find')
      .mockResolvedValue(
        ids.map((id, k) => ({ _id: id, nickname: `회원${k}` }))
      );
    jest.spyOn(Draw, 'findById').mockImplementation(() => q(draw));
    jest.spyOn(Draw, 'findOneAndUpdate').mockImplementation(() => q(draw));
    jest.spyOn(Draw, 'updateOne').mockResolvedValue({ matchedCount: 1 });
    jest.spyOn(RaceRecording, 'findOne').mockImplementation(() => q(store.rec));
    jest.spyOn(RaceRecording, 'create').mockImplementation(async (doc) => {
      store.rec = doc;
      return doc;
    });
    jest
      .spyOn(DrawResult, 'findOne')
      .mockImplementation((filter) =>
        q(filter && filter.draw ? store.result : null)
      );
    jest.spyOn(DrawResult, 'create').mockImplementation(async (doc) => {
      store.result = doc;
      return doc;
    });

    const run = await request(app)
      .post(`/api/draws/${DRAW_ID}/run`)
      .set('Cookie', cookie);
    expect(run.statusCode).toBe(200);

    const r = store.result;
    expect(r.algo).toBe(lotto.ALGO);
    expect(r.engine).toMatch(/lotto-v1/);
    expect(r.recordingHash).toBe(sha256(store.rec.raw));
    const rec = JSON.parse(store.rec.raw);
    const sorted = [...ids].sort();
    expect(r.winners.map((w) => w.id)).toEqual(
      rec.order.slice(0, 3).map((i) => sorted[i])
    );

    const v = await request(app)
      .get(`/api/draws/${DRAW_ID}/verify`)
      .set('Cookie', cookie);
    expect(v.statusCode).toBe(200);
    expect(v.body.checks.filter((c) => !c.ok)).toEqual([]);
    expect(v.body.ok).toBe(true);
  });
});
