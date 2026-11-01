process.env.JWT_SECRET = 'test-secret';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const zombie = require('../src/utils/zombie');
const { sha256 } = require('../src/utils/lottery');
const { User, Draw, DrawResult, RaceRecording } = require('../src/models');

const seed = 'ab'.repeat(32);
const ME = '64b7f0f0f0f0f0f0f0f0f0a1';
const DRAW_ID = '64b7f0f0f0f0f0f0f0f0f0f0';
const cookie = [`token=${jwt.sign({ uid: ME }, 'test-secret')}`];
const { ST, ZS } = zombie;
const R = 0.36;

jest.setTimeout(60000);

// 기록을 프레임마다 펼쳐서 (참가자 위치·상태, 좀비 위치·상태) 를 차례로 넘겨준다
function eachFrame(rec, fn) {
  const per = rec.hz / rec.fps;
  const st = new Int8Array(rec.n);
  // 좀비 떼는 처음부터 길에 있고, 골목 좀비는 처음 나올 때까지 숨어 있다
  const zst = Int8Array.from({ length: rec.zn }, (_, j) =>
    j < rec.horde ? ZS.SHAMBLE : ZS.HIDDEN
  );
  const cur = rec.pos.map(() => [0, 0]);
  const zcur = rec.zpos.map(() => [0, 0]);
  let e = 0;
  let ze = 0;
  for (let f = 0; f < rec.frames; f++) {
    const tick = Math.min(f * per, rec.ticks);
    while (e < rec.events.length && rec.events[e][0] <= tick) {
      st[rec.events[e][1]] = rec.events[e][2];
      e++;
    }
    while (ze < rec.zevents.length && rec.zevents[ze][0] <= tick) {
      zst[rec.zevents[ze][1]] = rec.zevents[ze][2];
      ze++;
    }
    for (let i = 0; i < rec.n; i++)
      for (let c = 0; c < 2; c++) cur[i][c] += rec.pos[i][f * 2 + c];
    for (let j = 0; j < rec.zn; j++)
      for (let c = 0; c < 2; c++) zcur[j][c] += rec.zpos[j][f * 2 + c];
    fn(
      f,
      tick,
      st,
      cur.map((p) => p.map((v) => v / 100)),
      zst,
      zcur.map((p) => p.map((v) => v / 100))
    );
  }
}

describe('좀비 탈출 시뮬레이션', () => {
  let sim;
  let rec;

  beforeAll(async () => {
    sim = await zombie.simulate({ seed, n: 160, winnerCount: 40 });
    rec = JSON.parse(sim.raw);
  });

  it('같은 seed 면 기록이 한 글자도 다르지 않다', async () => {
    const again = await zombie.simulate({ seed, n: 160, winnerCount: 40 });
    expect(again.raw).toBe(sim.raw);
  });

  it('seed 가 다르면 다른 추첨이 된다', async () => {
    const other = await zombie.simulate({
      seed: 'cd'.repeat(32),
      n: 160,
      winnerCount: 40,
    });
    expect(other.raw).not.toBe(sim.raw);
    expect(other.order.slice(0, 40)).not.toEqual(sim.order.slice(0, 40));
  });

  it('생존선을 넘은 시각 순서대로 줄 세우고, 한 사람은 한 번만 센다', () => {
    expect(rec.order.length).toBeGreaterThanOrEqual(40);
    expect(new Set(rec.order).size).toBe(rec.order.length);
    expect(rec.arrivals.map((a) => a[0])).toEqual(rec.order);
    for (let k = 1; k < rec.arrivals.length; k++)
      expect(rec.arrivals[k][1]).toBeGreaterThanOrEqual(rec.arrivals[k - 1][1]);
    expect(sim.order).toEqual(rec.order);
  });

  it('통로를 지나 생존선 너머에서 들어온 것으로 센다', () => {
    const { lineZ, gates, gateHalf } = rec.layout;
    const per = rec.hz / rec.fps;
    const arrivedAt = new Map(rec.arrivals.map(([i, t]) => [i, t]));
    eachFrame(rec, (f, tick, st, pos) => {
      for (const [i, t] of arrivedAt) {
        // 넘기 직전 프레임에는 통로 폭 안에, 넘은 뒤 프레임에는 생존선 너머에 있다
        if (f === Math.floor(t / per)) {
          const [px] = pos[i];
          expect(gates.some((g) => Math.abs(px - g) <= gateHalf)).toBe(true);
        }
        if (f === Math.ceil(t / per))
          expect(pos[i][1]).toBeGreaterThanOrEqual(lineZ - 0.01);
      }
    });
  });

  it('셔터가 처음 올라가기 전에는 아무도 통로로 들어가지 않는다', () => {
    const { opensAt } = rec.layout;
    expect(opensAt).toBeGreaterThan(0);
    for (const [t, , s] of rec.events)
      if (s === ST.PASS || s === ST.SAFE)
        expect(t).toBeGreaterThanOrEqual(opensAt);
    expect(rec.gates.every(([t]) => t >= opensAt)).toBe(true);
  });

  it('붙잡히면 구출되거나 물리고, 물린 사람은 좀비로만 지내며, 생존한 사람은 사라지는 것 말고 아무 일도 없다', () => {
    const states = Array.from({ length: rec.n }, () => []);
    for (const [t, i, s] of rec.events) states[i].push([t, s]);
    const zombieStates = [ST.TURNING, ST.ZOMBIE, ST.ZGRAB, ST.ZDIZZY];
    states.forEach((list) => {
      list.forEach(([, s], k) => {
        const next = list[k + 1];
        if (s === ST.GRABBED && next) {
          expect([ST.RUN, ST.TURNING]).toContain(next[1]);
        }
        if (s === ST.TURNING)
          list
            .slice(k + 1)
            .forEach(([, s2]) => expect(zombieStates).toContain(s2));
        if (s === ST.SAFE)
          list.slice(k + 1).forEach(([, s2]) => expect(s2).toBe(ST.GONE));
      });
    });
    // 구출 기록은 붙잡힘이 풀리는 순간과 같다
    for (const [t, i] of rec.rescues) {
      const ev = states[i].find(([tt, s]) => tt === t && s === ST.RUN);
      expect(ev).toBeTruthy();
    }
    // 물린 기록은 좀비가 되기 시작하는 순간과 같다
    for (const [t, i] of rec.bites)
      expect(states[i].some(([tt, s]) => tt === t && s === ST.TURNING)).toBe(
        true
      );
  });

  it('물리는 사람은 정원과 한도를 넘지 않아서 언제나 당첨 인원만큼 살아남는다', async () => {
    for (const [n, W, s] of [
      [160, 40, seed],
      [60, 60, 'ef'.repeat(32)],
      [200, 50, '12'.repeat(32)],
    ]) {
      const r = JSON.parse(
        (await zombie.simulate({ seed: s, n, winnerCount: W })).raw
      );
      expect(r.bites.length).toBeLessThanOrEqual(Math.floor(n * 0.25));
      expect(n - r.bites.length).toBeGreaterThanOrEqual(W);
      expect(r.order.length).toBeGreaterThanOrEqual(W);
      const bitten = new Set(r.bites.map((b) => b[1]));
      expect(r.order.some((i) => bitten.has(i))).toBe(false);
    }
  });

  it('참가자들은 길 한가운데 좀비 무리를 뚫고 가야 하고, 뒤에서 쫓기고, 골목에서 기습당한다', () => {
    const { front, ZB, alleys } = rec.layout;
    expect(ZB - front).toBeGreaterThanOrEqual(45);
    // 처음부터 길에 있는 좀비 가운데 참가자 대열과 바리게이트 사이(길 한가운데)에 선 무리와 대열 뒤의 떼
    const z0 = rec.zpos.slice(0, rec.horde).map((p) => p[1] / 100);
    const middle = z0.filter((z) => z > front + 5 && z < ZB - 5).length;
    const behind = z0.filter((z) => z < 0).length;
    expect(middle).toBeGreaterThanOrEqual(12);
    expect(behind).toBeGreaterThanOrEqual(12);
    // 골목은 양옆에 있고, 골목 좀비는 기록 도중에 나온다
    expect(alleys.some(([x]) => x < 0) && alleys.some(([x]) => x > 0)).toBe(
      true
    );
    expect(
      rec.zevents.some(([, j, s]) => j >= rec.horde && s !== ZS.HIDDEN)
    ).toBe(true);
  });

  it('물린 사람은 1~2초 뒤 좀비가 되고, 좀비가 된 참가자가 다른 참가자를 물어 감염시킨다', async () => {
    const r = JSON.parse(
      (
        await zombie.simulate({
          seed: '34'.repeat(32),
          n: 200,
          winnerCount: 60,
        })
      ).raw
    );
    expect(r.bites.length).toBeGreaterThan(0);
    const states = Array.from({ length: r.n }, () => []);
    for (const [t, i, s] of r.events) states[i].push([t, s]);
    for (const [t, i] of r.bites) {
      // 기록이 끝나기 2초 전보다 늦게 물린 사람은 좀비가 되기 전에 기록이 끝날 수 있다
      if (t + 2 * r.hz > r.ticks) continue;
      const turned = states[i].find(([tt, s]) => tt > t && s === ST.ZOMBIE);
      expect(turned).toBeTruthy();
      const secs = (turned[0] - t) / r.hz;
      expect(secs).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(secs).toBeLessThanOrEqual(2 + 1e-9);
    }
    // 좀비가 된 참가자가 붙잡아서 물린 사람이 있다 (그 순간 그 좀비는 붙잡기를 끝내고 다시 쫓는다)
    const bitByTurned = r.bites.filter(([t]) =>
      states.some((list) =>
        list.some(
          ([tt, s], k) =>
            tt === t && s === ST.ZOMBIE && k > 0 && list[k - 1][1] === ST.ZGRAB
        )
      )
    );
    expect(bitByTurned.length).toBeGreaterThan(0);
  });

  it('경찰이 사람을 붙잡은 좀비를 맞히면 그 순간 붙잡힌 사람이 풀려난다', () => {
    const hits = rec.shots.filter((s) => s[5] === 1);
    expect(hits.length).toBeGreaterThan(0);
    expect(rec.rescues.length).toBeGreaterThan(0);
    const hitTicks = new Set(hits.map((s) => s[2]));
    for (const [t] of rec.rescues) expect(hitTicks.has(t)).toBe(true);
    // 쏜 뒤에 닿는다
    for (const s of rec.shots) expect(s[2]).toBeGreaterThan(s[0]);
  });

  it('땅 위의 사람·좀비는 크게 겹치지 않고, 아무도 자동차를 통과하지 않으며, 좀비는 바리게이트 앞까지 오지 못한다', () => {
    const { cars, ZB } = rec.layout;
    let worst = 0;
    eachFrame(rec, (f, tick, st, pos, zst, zpos) => {
      const bodies = [];
      for (let i = 0; i < rec.n; i++) {
        const s = st[i];
        if (s === ST.GONE) continue;
        const inside = (s === ST.PASS || s === ST.SAFE) && pos[i][1] > ZB - 0.8;
        const down = s === ST.TRIP || s === ST.ZDIZZY;
        bodies.push([
          ...pos[i],
          down ? 0.55 : R,
          inside,
          s === ST.GRABBED || s === ST.ZGRAB,
        ]);
        if ([ST.ZOMBIE, ST.ZGRAB, ST.ZDIZZY].includes(s))
          expect(pos[i][1]).toBeLessThan(ZB - 2.4 + 0.9);
        if (s !== ST.SAFE)
          for (const [cx, cz, len, wid, along] of cars) {
            const hx = (along ? wid : len) / 2 - 0.25;
            const hz = (along ? len : wid) / 2 - 0.25;
            expect(
              Math.abs(pos[i][0] - cx) < hx && Math.abs(pos[i][1] - cz) < hz
            ).toBe(false);
          }
      }
      for (let j = 0; j < rec.zn; j++) {
        if (zst[j] === ZS.HIDDEN) continue;
        bodies.push([
          ...zpos[j],
          zst[j] === ZS.DIZZY ? 0.55 : R,
          false,
          zst[j] === ZS.GRAB,
        ]);
        expect(zpos[j][1]).toBeLessThan(ZB - 2.4 + 0.05);
      }
      for (let a = 0; a < bodies.length; a++)
        for (let b = a + 1; b < bodies.length; b++) {
          const A = bodies[a];
          const B = bodies[b];
          if (A[3] !== B[3] || (A[4] && B[4])) continue;
          const over = A[2] + B[2] - Math.hypot(A[0] - B[0], A[1] - B[1]);
          if (over > worst) worst = over;
        }
    });
    expect(worst).toBeLessThan(0.3);
  });

  it('출발 위치가 앞이라고 당첨을 휩쓸지 않는다 (앞 1/4 출발자가 당첨의 40% 미만)', async () => {
    let front = 0;
    let total = 0;
    for (const s of ['01', '02', '03'].map((k) => k.repeat(32))) {
      const r = JSON.parse(
        (await zombie.simulate({ seed: s, n: 200, winnerCount: 60 })).raw
      );
      const z0 = r.pos.map((p, i) => [p[1], i]).sort((a, b) => b[0] - a[0]);
      const frontSet = new Set(z0.slice(0, 50).map(([, i]) => i));
      front += r.order.slice(0, 60).filter((i) => frontSet.has(i)).length;
      total += 60;
    }
    expect(front / total).toBeLessThan(0.4);
  });

  it('300명·당첨 100명도 금방 끝나고, 기록이 작다', async () => {
    const t0 = Date.now();
    const big = await zombie.simulate({ seed, n: 300, winnerCount: 100 });
    // 서버(Vercel) 제한 60초 안에서 실행·검증을 넉넉히 마칠 만큼. 테스트 안에서는 그냥 돌릴 때보다 몇 배 느리고
    // 다른 테스트와 함께 돌면 더 느려지므로 여유를 둔다 (그냥 돌리면 2초 안팎)
    expect(Date.now() - t0).toBeLessThan(30000);
    expect(big.order.slice(0, 100)).toHaveLength(100);
    expect(big.raw.length).toBeLessThan(2e6);
    expect(big.seconds).toBeLessThan(75);
  });

  it('1명·전원 당첨처럼 작은 추첨도 끝난다', async () => {
    for (const [n, W] of [
      [1, 1],
      [2, 2],
      [5, 5],
      [12, 1],
    ]) {
      const r = await zombie.simulate({ seed, n, winnerCount: W });
      expect(r.order.length).toBeGreaterThanOrEqual(W);
    }
  });

  it('새 추첨은 zombie-v1 로 돌고 엔진 문자열에서 버전을 읽는다', () => {
    expect(sim.engine).toMatch(/ zombie-v1 /);
    expect(zombie.versionOf(sim.engine)).toBe('zombie-v1');
  });

  it('바리게이트 통로는 3개이고 길에는 자동차와 넘어질 장애물이 있다', () => {
    expect(rec.layout.gates).toHaveLength(3);
    expect(rec.layout.cars.length).toBeGreaterThanOrEqual(3);
    expect(rec.layout.hazards.length).toBeGreaterThanOrEqual(10);
    expect(rec.layout.lineZ).toBeGreaterThan(rec.layout.ZB);
  });

  it('인원과 당첨 한도를 넘으면 거절한다', async () => {
    await expect(
      zombie.simulate({ seed, n: zombie.MAX_PEOPLE + 1, winnerCount: 1 })
    ).rejects.toThrow();
    await expect(
      zombie.simulate({
        seed,
        n: zombie.MAX_PEOPLE,
        winnerCount: zombie.MAX_WINNERS + 1,
      })
    ).rejects.toThrow();
    await expect(
      zombie.simulate({ seed, n: 3, winnerCount: 4 })
    ).rejects.toThrow();
  });
});

describe('좀비 탈출 추첨 실행과 검증 (DB 는 메모리 흉내)', () => {
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
      title: '좀비 탈출',
      style: 'zombie',
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
        ids.map((id, k) => ({ _id: id, nickname: `생존자${k}` }))
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
    expect(r.algo).toBe(zombie.ALGO);
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

  it('좀비 탈출은 당첨 인원을 200명까지 정할 수 있고, 그 이상은 막는다', async () => {
    jest
      .spyOn(User, 'findById')
      .mockResolvedValue({ _id: ME, user_type: 'user' });
    const createSpy = jest.spyOn(Draw, 'create').mockResolvedValue(null);
    const body = (winnerCount) => ({
      title: '좀비 대탈출',
      style: 'zombie',
      winnerCount,
      drawAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    });
    const over = await request(app)
      .post('/api/draws')
      .set('Cookie', cookie)
      .send(body(zombie.MAX_WINNERS + 1));
    expect(over.statusCode).toBe(400);
    expect(createSpy).not.toHaveBeenCalled();
  });
});
