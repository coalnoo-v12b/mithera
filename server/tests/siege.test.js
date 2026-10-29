process.env.JWT_SECRET = 'test-secret';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const siege = require('../src/utils/siege');
const { sha256 } = require('../src/utils/lottery');
const { User, Draw, DrawResult, RaceRecording } = require('../src/models');

const seed = 'ab'.repeat(32);
const ME = '64b7f0f0f0f0f0f0f0f0f0a1';
const DRAW_ID = '64b7f0f0f0f0f0f0f0f0f0f0';
const cookie = [`token=${jwt.sign({ uid: ME }, 'test-secret')}`];
const { ST, ROUTE } = siege;

jest.setTimeout(60000);

// 기록을 프레임마다 펼쳐서 (위치, 상태) 를 차례로 넘겨준다
function eachFrame(rec, fn) {
  const per = rec.hz / rec.fps;
  const st = new Int8Array(rec.n);
  const cur = rec.pos.map(() => [0, 0, 0]);
  let e = 0;
  for (let f = 0; f < rec.frames; f++) {
    const tick = f * per;
    while (e < rec.events.length && rec.events[e][0] <= tick) {
      st[rec.events[e][1]] = rec.events[e][2];
      e++;
    }
    for (let i = 0; i < rec.n; i++)
      for (let c = 0; c < 3; c++) cur[i][c] += rec.pos[i][f * 3 + c];
    fn(
      f,
      tick,
      st,
      cur.map((p) => p.map((v) => v / 100))
    );
  }
}
// f 프레임의 말 몸통 두 원 [x, z] (말 하나당 앞·뒤)
const horsesAt = (rec, f) =>
  (rec.cavalry || []).flatMap((c) => {
    const k = f - c.from;
    if (k < 0 || k >= c.x.length) return [];
    const X = c.x[k] / 100;
    const Z = c.z[k] / 100;
    const hx = c.h[k * 2] / 1000;
    const hz = c.h[k * 2 + 1] / 1000;
    return [
      [X + hx * 0.65, Z + hz * 0.65],
      [X - hx * 0.65, Z - hz * 0.65],
    ];
  });
const posAt = (rec, i, f) => {
  const p = [0, 0, 0];
  for (let k = 0; k <= f; k++)
    for (let c = 0; c < 3; c++) p[c] += rec.pos[i][k * 3 + c];
  return p.map((v) => v / 100);
};

describe('성벽 탈환전 시뮬레이션', () => {
  let sim;
  let rec;

  beforeAll(async () => {
    sim = await siege.simulate({ seed, n: 120, winnerCount: 30 });
    rec = JSON.parse(sim.raw);
  });

  it('같은 seed 면 기록이 한 글자도 다르지 않다', async () => {
    const again = await siege.simulate({ seed, n: 120, winnerCount: 30 });
    expect(again.raw).toBe(sim.raw);
  });

  it('seed 가 다르면 다른 경기가 된다', async () => {
    const other = await siege.simulate({
      seed: 'cd'.repeat(32),
      n: 120,
      winnerCount: 30,
    });
    expect(other.raw).not.toBe(sim.raw);
  });

  it('두 길의 도착을 시각 순서대로 합치고, 한 사람은 한 번만 센다', () => {
    expect(sim.order.length).toBeGreaterThanOrEqual(30);
    expect(new Set(sim.order).size).toBe(sim.order.length);
    expect(rec.arrivals.map(([i]) => i)).toEqual(sim.order);
    rec.arrivals.forEach(([, t, route], k) => {
      expect([ROUTE.WALL, ROUTE.GATE]).toContain(route);
      if (k > 0) expect(t).toBeGreaterThanOrEqual(rec.arrivals[k - 1][1]);
    });
  });

  it('성벽 쪽은 통로 도착 구역, 성문 쪽은 문 안쪽 도착선 너머에서 들어온 것으로 센다', () => {
    const L = rec.layout;
    const per = rec.hz / rec.fps;
    for (const [i, tick, route] of rec.arrivals) {
      const [x, y, z] = posAt(
        rec,
        i,
        Math.min(rec.frames - 1, Math.ceil(tick / per))
      );
      if (route === ROUTE.WALL) {
        expect(y).toBeCloseTo(L.H, 1);
        expect(z).toBeGreaterThanOrEqual(L.WZ + L.arriveZ - 0.01);
        expect(z).toBeLessThanOrEqual(L.WZ + L.walk);
      } else {
        expect(y).toBe(0);
        expect(z).toBeGreaterThanOrEqual(L.gate.arriveZ - 0.01);
        expect(Math.abs(x)).toBeLessThanOrEqual(L.gate.half);
      }
    }
  });

  it.each([
    [10, 1],
    [30, 2],
    [40, 3],
    [60, 15],
    [300, 100],
  ])(
    '%i명·당첨 %i명: 성문은 정원이 차기 전에 부서지고, 성문으로는 그 뒤에만 들어온다',
    async (n, w) => {
      for (const s of ['ab', 'cd', '12']) {
        const r = JSON.parse(
          (await siege.simulate({ seed: s.repeat(32), n, winnerCount: w })).raw
        );
        expect(r.ram.breakTick).toBeGreaterThanOrEqual(0);
        expect(r.ram.breakTick).toBeLessThan(r.arrivals[w - 1][1]);
        expect(r.ram.strikes).toContain(r.ram.breakTick);
        for (const [, t, route] of r.arrivals)
          if (route === ROUTE.GATE)
            expect(t).toBeGreaterThanOrEqual(r.ram.breakTick);
      }
    }
  );

  it('들어온 뒤에는 사라지는 것 말고 아무 일도 없고, 물에는 한 병사가 최대 2번까지만 맞는다', () => {
    const arrivedAt = new Map(rec.arrivals.map(([i, t]) => [i, t]));
    const prev = new Map();
    const hits = new Map();
    const per = rec.hz / rec.fps;
    // 기마병에 밀린 것은 맞은 횟수에 넣지 않는다 (그 순간 말이 바로 옆에 있었다)
    const byHorse = (t, i) => {
      const f = Math.min(rec.frames - 1, Math.round(t / per));
      const [x, , z] = posAt(rec, i, f);
      return horsesAt(rec, f).some(
        ([hx, hz]) => Math.hypot(x - hx, z - hz) < 2.2
      );
    };
    for (const [t, i, s] of rec.events) {
      if (arrivedAt.has(i) && t > arrivedAt.get(i)) expect(s).toBe(ST.GONE);
      // 물대포에 넘어지거나 밀려남, 물총·물바가지에 떨어짐 (떨어진 뒤 눕는 것은 같은 한 번)
      const hit =
        s === ST.FALL ||
        ((s === ST.PUSH || (s === ST.DOWN && prev.get(i) !== ST.FALL)) &&
          !byHorse(t, i));
      if (hit) hits.set(i, (hits.get(i) || 0) + 1);
      prev.set(i, s);
    }
    expect(hits.size).toBeGreaterThan(0);
    for (const count of hits.values()) expect(count).toBeLessThanOrEqual(2);
  });

  it('사다리는 한 줄로 오르고, 앞사람과 간격을 지키며 추월하지 않는다', () => {
    eachFrame(rec, (f, tick, st, P) => {
      const byLadder = new Map();
      for (let i = 0; i < rec.n; i++) {
        if (st[i] !== ST.CLIMB) continue;
        const list = byLadder.get(P[i][0]) || [];
        list.push(P[i][1]);
        byLadder.set(P[i][0], list);
      }
      for (const ys of byLadder.values()) {
        ys.sort((a, b) => a - b);
        for (let k = 1; k < ys.length; k++)
          expect(ys[k] - ys[k - 1]).toBeGreaterThan(0.9);
      }
    });
  });

  it('서 있는 병사끼리 몸이 겹치지 않고, 아무도 공성추·성벽을 통과하지 않는다', () => {
    const L = rec.layout;
    const R = rec.ram;
    const standing = [ST.READY, ST.RUN, ST.QUEUE, ST.GATE, ST.PUSH];
    let worst = Infinity;
    eachFrame(rec, (f, tick, st, P) => {
      const g = [];
      for (let i = 0; i < rec.n; i++) if (standing.includes(st[i])) g.push(i);
      for (let a = 0; a < g.length; a++)
        for (let b = a + 1; b < g.length; b++)
          worst = Math.min(
            worst,
            Math.hypot(P[g[a]][0] - P[g[b]][0], P[g[a]][2] - P[g[b]][2])
          );
      const open = R.breakTick >= 0 && tick >= R.breakTick;
      const front = Math.min(R.stop, R.start + R.speed * (tick / rec.hz));
      for (const i of g) {
        const [x, , z] = P[i];
        if (!(open && Math.abs(x) < L.gate.half)) expect(z).toBeLessThan(L.WZ);
        // 공성추 몸통(공병 포함) 안으로 들어가지 않는다
        if (z > front - R.length && z < front)
          expect(Math.abs(x)).toBeGreaterThan(R.half);
      }
    });
    // 몸통 너비(0.5m)만큼은 언제나 떨어져 있다
    expect(worst).toBeGreaterThan(0.5);
  });

  it('물바가지·안뜰 물대포가 기록되고, 꼭대기에서 떨어진 병사는 그때 성벽에 올라서지 않는다', async () => {
    const r = JSON.parse(
      (await siege.simulate({ seed, n: 300, winnerCount: 100 })).raw
    );
    expect(r.dumps.length).toBeGreaterThan(0);
    expect(r.gateShots.length).toBeGreaterThan(0);
    // 안뜰 물대포는 문이 부서진 뒤에만 쏜다
    for (const [fire] of r.gateShots)
      expect(fire).toBeGreaterThanOrEqual(r.ram.breakTick);
    for (const [, , hit, who, ok] of r.dumps) {
      const next = r.events.find((e) => e[1] === who && e[0] >= hit);
      if (ok) expect(next[2]).toBe(ST.FALL);
      else expect(next[2]).toBe(ST.STEP);
    }
  });

  it('문이 부서지면 기마병이 나와 휘젓고, 서 있는 병사는 말과 겹치지 않는다', async () => {
    for (const [n, riders] of [
      [120, 4],
      [300, 6],
    ]) {
      const r = JSON.parse(
        (await siege.simulate({ seed, n, winnerCount: 30 })).raw
      );
      const per = r.hz / r.fps;
      expect(r.cavalry).toHaveLength(riders);
      for (const c of r.cavalry)
        expect(c.from * per).toBeGreaterThanOrEqual(r.ram.breakTick);
      const standing = [ST.READY, ST.RUN, ST.QUEUE, ST.GATE, ST.PUSH];
      eachFrame(r, (f, tick, st, P) => {
        const hs = horsesAt(r, f);
        if (!hs.length) return;
        for (let i = 0; i < r.n; i++) {
          if (!standing.includes(st[i]) || P[i][1] > 0.3) continue;
          for (const [hx, hz] of hs)
            expect(Math.hypot(P[i][0] - hx, P[i][2] - hz)).toBeGreaterThan(
              0.55 + 0.38 - 0.15
            );
        }
      });
    }
  });

  it('300명·당첨 100명도 금방 끝나고, 기록이 작다', async () => {
    const t0 = Date.now();
    const big = await siege.simulate({ seed, n: 300, winnerCount: 100 });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(big.order.slice(0, 100)).toHaveLength(100);
    expect(big.raw.length).toBeLessThan(2e6);
  });

  it('새 추첨은 siege-v1 로 돌고 엔진 문자열에서 버전을 읽는다', () => {
    expect(sim.engine).toMatch(/ siege-v1 /);
    expect(siege.versionOf(sim.engine)).toBe('siege-v1');
  });

  it('사다리는 인원과 상관없이 성문 양쪽에 3개씩 6개, 하나에 두 줄이다', async () => {
    for (const n of [10, 120, 500]) {
      const r = JSON.parse(
        (await siege.simulate({ seed, n, winnerCount: 1 })).raw
      );
      expect(r.layout.ladders).toHaveLength(6);
      expect(r.layout.ladders.filter((x) => x < 0)).toHaveLength(3);
      // 사다리마다 두 줄로 오른다
      expect(r.layout.lanes).toHaveLength(12);
    }
  });

  it('인원과 당첨 한도를 넘으면 거절한다', async () => {
    await expect(
      siege.simulate({ seed, n: siege.MAX_PEOPLE + 1, winnerCount: 1 })
    ).rejects.toThrow();
    await expect(
      siege.simulate({
        seed,
        n: siege.MAX_PEOPLE,
        winnerCount: siege.MAX_WINNERS + 1,
      })
    ).rejects.toThrow();
  });
});

describe('성벽 탈환전 추첨 실행과 검증 (DB 는 메모리 흉내)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const q = (v) => ({
    select: () => q(v),
    sort: () => q(v),
    then: (ok, bad) => Promise.resolve(v).then(ok, bad),
  });

  it('시뮬레이션이 정한 당첨자로 결과를 저장하고, 서버 검증을 모두 통과한다', async () => {
    const ids = [
      ME,
      ...Array.from(
        { length: 39 },
        (_, k) => `64b7f0f0f0f0f0f0f0f${String(k).padStart(5, '0')}`
      ),
    ];
    const drawSeed = 'ef'.repeat(32);
    const draw = {
      _id: DRAW_ID,
      title: '성벽 탈환전',
      style: 'siege',
      status: 'closed',
      winnerCount: 12,
      participants: ids,
      createdBy: ME,
      seed: drawSeed,
      commitment: sha256(drawSeed),
      participantsHash: sha256([...ids].sort().join(',')),
    };
    const store = { rec: null, result: null };
    jest
      .spyOn(User, 'findById')
      .mockResolvedValue({ _id: ME, user_type: 'user', nickname: '나' });
    jest
      .spyOn(User, 'find')
      .mockResolvedValue(
        ids.map((id, k) => ({ _id: id, nickname: `병사${k}` }))
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
    expect(r.algo).toBe(siege.ALGO);
    expect(r.recordingHash).toBe(sha256(store.rec.raw));
    const rec = JSON.parse(store.rec.raw);
    const sorted = [...ids].sort();
    expect(r.winners.map((w) => w.id)).toEqual(
      rec.order.slice(0, 12).map((i) => sorted[i])
    );

    const v = await request(app)
      .get(`/api/draws/${DRAW_ID}/verify`)
      .set('Cookie', cookie);
    expect(v.statusCode).toBe(200);
    expect(v.body.checks.filter((c) => !c.ok)).toEqual([]);
    expect(v.body.ok).toBe(true);
  });

  it('성벽 탈환전은 당첨 인원을 200명까지 정할 수 있고, 그 이상은 막는다', async () => {
    jest
      .spyOn(User, 'findById')
      .mockResolvedValue({ _id: ME, user_type: 'user' });
    const createSpy = jest.spyOn(Draw, 'create').mockResolvedValue(null);
    const body = (winnerCount, style = 'siege') => ({
      title: '대규모',
      style,
      winnerCount,
      drawAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    });
    const over = await request(app)
      .post('/api/draws')
      .set('Cookie', cookie)
      .send(body(siege.MAX_WINNERS + 1));
    expect(over.statusCode).toBe(400);
    // 다른 방식은 예전처럼 100명까지
    const cards = await request(app)
      .post('/api/draws')
      .set('Cookie', cookie)
      .send(body(150, 'cards'));
    expect(cards.statusCode).toBe(400);
    expect(createSpy).not.toHaveBeenCalled();
  });
});
