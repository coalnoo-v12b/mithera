// 서버를 믿지 않고 브라우저(WebCrypto)에서 결과를 직접 다시 계산한다.
// 알고리즘은 server/server.js 의 pickWinners / hashResult, server/race.js 의 initialState 와 동일해야 한다.
const enc = new TextEncoder();
const hex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const RACE_ALGO = 'matter-physics-v1';
export const LOTTO_ALGO = 'rapier-lotto-v1';
export const ROULETTE_ALGO = 'rapier-roulette-v1';
// 물리 엔진이 당첨자를 정하는 방식: 경기 녹화를 따로 받아서 재생·검증한다
export const isPhysicsAlgo = (algo) =>
  algo === RACE_ALGO || algo === LOTTO_ALGO || algo === ROULETTE_ALGO;
export const canVerify = () => typeof crypto !== 'undefined' && !!crypto.subtle;
export const sha256 = async (s) =>
  hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const hmacKey = (seed) =>
  crypto.subtle.importKey(
    'raw',
    enc.encode(seed),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

async function makeRng(seed) {
  const key = await hmacKey(seed);
  let counter = 0;
  return async (n) => {
    const limit = 2 ** 32 - (2 ** 32 % n);
    for (;;) {
      const block = new DataView(
        await crypto.subtle.sign('HMAC', key, enc.encode(String(counter++)))
      );
      for (let i = 0; i + 4 <= 32; i += 4) {
        const v = block.getUint32(i, false);
        if (v < limit) return v % n;
      }
    }
  };
}

async function pickWinners(sortedIds, winnerCount, seed) {
  const rng = await makeRng(seed);
  const a = [...sortedIds];
  for (let i = a.length - 1; i > 0; i--) {
    const j = await rng(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, winnerCount);
}

/* ---------- 구슬 레이스(물리) ---------- */
const RACE_W = 600;
const radiusFor = (n) => (n <= 12 ? 12 : n <= 30 ? 10 : n <= 60 ? 8 : 6);

async function raceFloats(seed, count) {
  const key = await hmacKey(seed);
  const out = [];
  for (let j = 0; out.length < count; j++) {
    const dv = new DataView(
      await crypto.subtle.sign('HMAC', key, enc.encode('race:' + j))
    );
    for (let k = 0; k < 8 && out.length < count; k++)
      out.push(dv.getUint32(k * 4, false) / 4294967296);
  }
  return out;
}

// server/race.js 의 initialState 와 같은 계산
function raceInitial(n, f, r, track) {
  const slotOf = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => f[a] - f[b] || a - b
  );
  const spacing = 2 * r + 4;
  // v1 은 한 줄로, v2 는 밀집해서 출발한다 (server/race.js 의 VERSIONS.maxCols 와 같아야 한다)
  const maxCols =
    track === 'track-v1' ? n : Math.max(4, Math.ceil(Math.sqrt(n)));
  const cols = Math.max(
    1,
    Math.min(n, Math.floor((RACE_W - 80) / spacing), maxCols)
  );
  const out = new Array(n);
  slotOf.forEach((marble, slot) => {
    const row = Math.floor(slot / cols);
    const col = slot % cols;
    out[marble] = {
      x:
        RACE_W / 2 +
        (col - (cols - 1) / 2) * spacing +
        (f[n + 2 * marble] - 0.5) * 2,
      y: 40 + row * spacing + (f[n + 2 * marble + 1] - 0.5) * 2,
    };
  });
  return out;
}

// 녹화(delta 인코딩)를 구슬별 절대 좌표로 푼다
export function decodeRecording(rec) {
  const xs = [],
    ys = [];
  for (const flat of rec.pos) {
    const x = [],
      y = [];
    let cx = 0,
      cy = 0;
    for (let k = 0; k < flat.length; k += 2) {
      cx += flat[k];
      cy += flat[k + 1];
      x.push(cx);
      y.push(cy);
    }
    xs.push(x);
    ys.push(y);
  }
  const bars = rec.bars.map((flat) => {
    const a = [];
    let c = 0;
    for (const d of flat) {
      c += d;
      a.push(c / 1000);
    }
    return a;
  });
  return { xs, ys, bars };
}

async function raceChecks(r, sorted, raw) {
  if (!raw) return [['경기 녹화를 불러오지 못했어요', false]];
  let rec;
  try {
    rec = JSON.parse(raw);
  } catch {
    return [['경기 녹화가 올바른 형식이 아니에요', false]];
  }
  const n = sorted.length;
  const { xs, ys } = decodeRecording(rec);

  // 첫 프레임이 seed 에서 계산한 출발 위치와 같은가
  let startOk = rec.n === n && rec.r === radiusFor(n) && xs.length === n;
  if (startOk) {
    const init = raceInitial(
      n,
      await raceFloats(r.seed, 4 * n),
      rec.r,
      rec.track
    );
    startOk = init.every(
      (p, i) => xs[i][0] === Math.round(p.x) && ys[i][0] === Math.round(p.y)
    );
  }

  // 도착 순서가 녹화된 움직임과 모순되지 않는가 (30fps 로 기록되므로 1프레임 오차는 허용)
  const finishFrame = ys.map((a) => {
    const f = a.findIndex((y) => y >= rec.finishY);
    return f < 0 ? Infinity : f;
  });
  const endY = ys.map((a) => a[a.length - 1]);
  const order = rec.order;
  let orderOk =
    Array.isArray(order) && order.length === n && new Set(order).size === n;
  if (orderOk) {
    for (let k = 0; k + 1 < n && orderOk; k++) {
      const fa = finishFrame[order[k]],
        fb = finishFrame[order[k + 1]];
      if (fa !== Infinity && fb !== Infinity) orderOk = fa <= fb + 1;
      else if (fa === Infinity && fb !== Infinity) orderOk = false;
      else if (fa === Infinity && fb === Infinity)
        orderOk = endY[order[k]] >= endY[order[k + 1]] - 1;
    }
  }
  const winnersOk =
    orderOk &&
    JSON.stringify(order.slice(0, r.winnerCount).map((i) => sorted[i])) ===
      JSON.stringify(r.winners.map((w) => w.id));

  return [
    [
      '저장된 녹화의 해시가 결과에 기록된 값과 같아요',
      (await sha256(raw)) === r.recordingHash,
    ],
    ['녹화의 첫 프레임이 seed 로 계산한 출발 위치와 같아요', startOk],
    ['녹화된 움직임에서 결승선 도착 순서가 맞아요', orderOk],
    ['당첨자가 도착 순서의 앞에서부터와 같아요', winnersOk],
  ];
}

/* ---------- 로또 추첨기(물리) ---------- */
// 물리 시뮬레이션 자체는 서버 검증에서 다시 돌린다. 여기서는 녹화가 결과와 모순되지 않는지 확인한다.
async function lottoChecks(r, sorted, raw) {
  if (!raw) return [['추첨 녹화를 불러오지 못했어요', false]];
  let rec;
  try {
    rec = JSON.parse(raw);
  } catch {
    return [['추첨 녹화가 올바른 형식이 아니에요', false]];
  }
  const n = sorted.length;
  const shapeOk =
    rec.kind === 'lotto' &&
    rec.n === n &&
    Array.isArray(rec.pos) &&
    rec.pos.length === n &&
    rec.pos.every((p) => p.length === rec.frames * 3);

  // 뽑혔다고 기록된 순간, 그 공이 실제로 배출관 안에 있었는가
  let captureOk =
    shapeOk &&
    Array.isArray(rec.captures) &&
    rec.captures.length === rec.winnerCount &&
    new Set(rec.captures.map(([i]) => i)).size === rec.captures.length &&
    JSON.stringify(rec.captures.map(([i]) => i)) === JSON.stringify(rec.order);
  if (captureOk) {
    const { holeY, holeR } = rec.layout;
    captureOk = rec.captures.every(([i, frame]) => {
      let x = 0,
        y = 0,
        z = 0;
      for (let f = 0; f <= frame; f++) {
        x += rec.pos[i][f * 3];
        y += rec.pos[i][f * 3 + 1];
        z += rec.pos[i][f * 3 + 2];
      }
      return y / 1000 > holeY - 0.3 && Math.hypot(x, z) / 1000 < holeR + 0.3;
    });
  }
  const winnersOk =
    captureOk &&
    JSON.stringify(rec.order.slice(0, r.winnerCount).map((i) => sorted[i])) ===
      JSON.stringify(r.winners.map((w) => w.id));

  return [
    [
      '저장된 녹화의 해시가 결과에 기록된 값과 같아요',
      (await sha256(raw)) === r.recordingHash,
    ],
    ['녹화에서 공이 배출관으로 뽑힌 순간과 순서가 맞아요', captureOk],
    ['당첨자가 뽑힌 순서의 앞에서부터와 같아요', winnersOk],
  ];
}

/* ---------- 룰렛(물리) ---------- */
// 녹화에서 공이 멈췄다고 기록된 순간, 공의 위치와 휠 각도로 칸을 다시 계산해 주인이 당첨자와 같은지 확인한다
async function rouletteChecks(r, sorted, raw) {
  if (!raw) return [['추첨 녹화를 불러오지 못했어요', false]];
  let rec;
  try {
    rec = JSON.parse(raw);
  } catch {
    return [['추첨 녹화가 올바른 형식이 아니에요', false]];
  }
  const n = sorted.length;
  const L = rec.layout || {};
  let settleOk =
    rec.kind === 'roulette' &&
    rec.n === n &&
    Array.isArray(rec.rounds) &&
    rec.rounds.length === rec.winnerCount &&
    Array.isArray(L.owner) &&
    L.owner.length === L.P &&
    rec.ball.length === rec.frames * 3 &&
    rec.wheel.length === rec.frames &&
    JSON.stringify(rec.rounds.map((x) => x.winner)) ===
      JSON.stringify(rec.order) &&
    new Set(rec.order).size === rec.order.length;
  if (settleOk) {
    const TAU = Math.PI * 2;
    settleOk = rec.rounds.every((round) => {
      let x = 0,
        y = 0,
        z = 0,
        a = 0;
      for (let f = 0; f <= round.settle; f++) {
        x += rec.ball[f * 3];
        y += rec.ball[f * 3 + 1];
        z += rec.ball[f * 3 + 2];
        a += rec.wheel[f];
      }
      const rad = Math.hypot(x, z) / 1000;
      const local = (((Math.atan2(z, x) + a / 1e4) % TAU) + TAU) % TAU;
      const p = Math.min(L.P - 1, Math.floor(local / (TAU / L.P)));
      return (
        rad > L.pocketIn &&
        rad < L.pocketOut &&
        y / 1000 < L.rimY &&
        p === round.pocket &&
        L.owner[p] === round.winner
      );
    });
  }
  const winnersOk =
    settleOk &&
    JSON.stringify(rec.order.slice(0, r.winnerCount).map((i) => sorted[i])) ===
      JSON.stringify(r.winners.map((w) => w.id));
  return [
    [
      '저장된 녹화의 해시가 결과에 기록된 값과 같아요',
      (await sha256(raw)) === r.recordingHash,
    ],
    ['녹화에서 공이 멈춘 칸과 그 칸의 주인이 맞아요', settleOk],
    ['당첨자가 공이 멈춘 순서와 같아요', winnersOk],
  ];
}

// chain: /api/results 의 results 배열 (없으면 체인 연결 검사는 생략)
// recordingRaw: 물리 방식(구슬 레이스, 로또 추첨기)일 때 /api/draws/:id/recording 의 raw 문자열
export async function verifyInBrowser(r, drawId, chain, recordingRaw) {
  const ids = r.participants.map((p) => p.id);
  const sorted = [...ids].sort();
  const payload = {
    seq: r.seq,
    drawId,
    title: r.title,
    participants: r.participants.map((p) => ({
      id: p.id,
      nickname: p.nickname,
    })),
    participantsHash: r.participantsHash,
    commitment: r.commitment,
    seed: r.seed,
    algo: r.algo,
    winnerCount: r.winnerCount,
    winners: r.winners.map((p) => ({ id: p.id, nickname: p.nickname })),
    drawnAt: r.drawnAt,
    prevHash: r.prevHash,
    ...(r.recordingHash
      ? { engine: r.engine, recordingHash: r.recordingHash }
      : {}),
  };
  const checks = [
    [
      'seed 의 해시가 마감 때 공개한 commitment 와 같아요',
      (await sha256(r.seed)) === r.commitment,
    ],
    [
      '참가자 목록 해시가 마감 때 확정한 값과 같아요',
      (await sha256(sorted.join(','))) === r.participantsHash &&
        JSON.stringify(ids) === JSON.stringify(sorted),
    ],
  ];
  if (r.algo === RACE_ALGO) {
    checks.push(...(await raceChecks(r, sorted, recordingRaw)));
  } else if (r.algo === LOTTO_ALGO) {
    checks.push(...(await lottoChecks(r, sorted, recordingRaw)));
  } else if (r.algo === ROULETTE_ALGO) {
    checks.push(...(await rouletteChecks(r, sorted, recordingRaw)));
  } else {
    const redo = await pickWinners(sorted, r.winnerCount, r.seed);
    checks.push([
      '공개된 알고리즘으로 다시 뽑아도 같은 당첨자가 나와요',
      JSON.stringify(redo) === JSON.stringify(r.winners.map((w) => w.id)),
    ]);
  }
  checks.push([
    '결과 해시가 내용과 같아요 (변조 없음)',
    (await sha256(JSON.stringify(payload))) === r.hash,
  ]);
  if (chain) {
    const prev = chain.find((c) => c.seq === r.seq - 1);
    const linked =
      r.seq === 1
        ? r.prevHash === '0'.repeat(64)
        : !!prev && prev.hash === r.prevHash;
    checks.push(['직전 결과와 해시 체인이 이어져요', linked]);
  }
  return checks.map(([label, ok]) => ({ label, ok }));
}
