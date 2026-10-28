process.env.JWT_SECRET = 'test-secret';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const roulette = require('../src/utils/roulette');
const { ALGO: SHUFFLE_ALGO, sha256 } = require('../src/utils/lottery');
const { User, Draw, DrawResult, RaceRecording } = require('../src/models');

const seed = 'ab'.repeat(32);
const ME = '64b7f0f0f0f0f0f0f0f0f0a1';
const DRAW_ID = '64b7f0f0f0f0f0f0f0f0f0f0';
const cookie = [`token=${jwt.sign({ uid: ME }, 'test-secret')}`];

jest.setTimeout(60000);

describe('카지노 룰렛 물리 시뮬레이션', () => {
  let sim;
  let rec;

  beforeAll(async () => {
    sim = await roulette.simulate({ seed, n: 8, winnerCount: 3 });
    rec = JSON.parse(sim.raw);
  });

  it('같은 seed 면 녹화가 한 글자도 다르지 않다', async () => {
    const again = await roulette.simulate({ seed, n: 8, winnerCount: 3 });
    expect(again.raw).toBe(sim.raw);
  });

  it('seed 가 다르면 다른 경기가 된다', async () => {
    const other = await roulette.simulate({
      seed: 'cd'.repeat(32),
      n: 8,
      winnerCount: 3,
    });
    expect(other.raw).not.toBe(sim.raw);
  });

  it('판마다 다른 사람이 당첨된다 (당첨된 칸은 덮고 다시 굴린다)', () => {
    expect(sim.order).toHaveLength(3);
    expect(new Set(sim.order).size).toBe(3);
    expect(rec.rounds.map((r) => r.winner)).toEqual(sim.order);
  });

  it('칸은 최소 12개이고, 한 사람의 칸 수는 모두 같다', () => {
    const { P, owner } = rec.layout;
    expect(P).toBe(roulette.pocketCount(8));
    expect(P).toBeGreaterThanOrEqual(12);
    const per = new Array(8).fill(0);
    owner.forEach((o) => per[o]++);
    expect(new Set(per).size).toBe(1);
  });

  it('공이 멈춘 순간의 위치와 휠 각도로 계산한 칸이 기록과 같다', () => {
    const TAU = Math.PI * 2;
    const L = rec.layout;
    for (const round of rec.rounds) {
      let x = 0;
      let z = 0;
      let a = 0;
      for (let f = 0; f <= round.settle; f++) {
        x += rec.ball[f * 3];
        z += rec.ball[f * 3 + 2];
        a += rec.wheel[f];
      }
      const local = (((Math.atan2(z, x) + a / 1e4) % TAU) + TAU) % TAU;
      // v3 부터는 판마다 칸을 다시 나누므로 그 판의 칸 수·주인을 쓴다
      const P = round.P || L.P;
      const owner = round.owner || L.owner;
      const p = Math.min(P - 1, Math.floor(local / (TAU / P)));
      expect(p).toBe(round.pocket);
      expect(owner[p]).toBe(round.winner);
    }
  });

  it('새 추첨은 v3 로 돌고, 옛 결과의 v1 도 그대로 다시 돌릴 수 있다', async () => {
    expect(sim.engine).toMatch(/ roulette-v3 /);
    expect(roulette.versionOf(sim.engine)).toBe('roulette-v3');
    const old = 'rapier3d-compat@0.19.2 roulette-v1 dt=8.333ms';
    expect(roulette.versionOf(old)).toBe('roulette-v1');
    const v1 = await roulette.simulate({
      seed,
      n: 8,
      winnerCount: 3,
      version: 'roulette-v1',
    });
    expect(JSON.parse(v1.raw).version).toBe('roulette-v1');
    expect(v1.raw).not.toBe(sim.raw);
  });

  it('v3 는 판마다 남은 사람끼리 칸을 똑같이 다시 나눈다', () => {
    rec.rounds.forEach((round, k) => {
      const left = 8 - k;
      expect(round.P).toBe(roulette.pocketCount(left));
      const per = {};
      round.owner.forEach((o) => {
        per[o] = (per[o] || 0) + 1;
      });
      expect(Object.keys(per)).toHaveLength(left);
      expect(new Set(Object.values(per)).size).toBe(1);
      rec.order.slice(0, k).forEach((won) => expect(per[won]).toBeUndefined());
    });
  });

  it('인원과 당첨 한도를 넘으면 거절한다', async () => {
    await expect(
      roulette.simulate({ seed, n: roulette.MAX_PLAYERS + 1, winnerCount: 1 })
    ).rejects.toThrow();
    await expect(
      roulette.simulate({ seed, n: 20, winnerCount: roulette.MAX_WINNERS + 1 })
    ).rejects.toThrow();
  });
});

describe('룰렛 추첨 실행과 검증 (DB 는 메모리 흉내)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // mongoose 쿼리처럼 await 도 되고 .select()/.sort() 도 이어 쓸 수 있는 값
  const q = (v) => ({
    select: () => q(v),
    sort: () => q(v),
    then: (ok, bad) => Promise.resolve(v).then(ok, bad),
  });

  const setup = (count) => {
    const ids = [
      ME,
      ...Array.from(
        { length: count - 1 },
        (_, k) => `64b7f0f0f0f0f0f0f0f${String(k).padStart(5, '0')}`
      ),
    ];
    const drawSeed = 'ef'.repeat(32);
    const draw = {
      _id: DRAW_ID,
      title: '점심 룰렛',
      style: 'wheel',
      status: 'closed',
      winnerCount: 2,
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
    return { ids, store };
  };

  it('물리 엔진이 정한 당첨자로 결과를 저장하고, 서버 검증을 모두 통과한다', async () => {
    const { ids, store } = setup(9);
    const run = await request(app)
      .post(`/api/draws/${DRAW_ID}/run`)
      .set('Cookie', cookie);
    expect(run.statusCode).toBe(200);

    const r = store.result;
    expect(r.algo).toBe(roulette.ALGO);
    expect(r.engine).toMatch(/roulette-v3/);
    expect(r.recordingHash).toBe(sha256(store.rec.raw));
    const rec = JSON.parse(store.rec.raw);
    const sorted = [...ids].sort();
    expect(r.winners.map((w) => w.id)).toEqual(
      rec.order.slice(0, 2).map((i) => sorted[i])
    );

    const v = await request(app)
      .get(`/api/draws/${DRAW_ID}/verify`)
      .set('Cookie', cookie);
    expect(v.statusCode).toBe(200);
    expect(v.body.checks.filter((c) => !c.ok)).toEqual([]);
    expect(v.body.ok).toBe(true);
  });

  it('한도가 생기기 전에 만든 큰 룰렛 추첨은 예전 방식으로 뽑는다', async () => {
    const { store } = setup(roulette.MAX_PLAYERS + 4);
    const run = await request(app)
      .post(`/api/draws/${DRAW_ID}/run`)
      .set('Cookie', cookie);
    expect(run.statusCode).toBe(200);
    expect(store.result.algo).toBe(SHUFFLE_ALGO);
    expect(store.rec).toBeNull();
  });
});

describe('룰렛 인원 제한', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it(`당첨 인원이 ${roulette.MAX_WINNERS}명을 넘으면 만들 수 없다`, async () => {
    jest
      .spyOn(User, 'findById')
      .mockResolvedValue({ _id: ME, user_type: 'user' });
    const createSpy = jest.spyOn(Draw, 'create');
    const res = await request(app)
      .post('/api/draws')
      .set('Cookie', cookie)
      .send({
        title: '룰렛',
        style: 'wheel',
        winnerCount: roulette.MAX_WINNERS + 1,
        drawAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      });
    expect(res.statusCode).toBe(400);
    expect(createSpy).not.toHaveBeenCalled();
  });
});
