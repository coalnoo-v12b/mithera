// 서버를 믿지 않고 브라우저(WebCrypto)에서 결과를 직접 다시 계산한다.
// 알고리즘은 server/server.js 의 pickWinners / hashResult, server/race.js 의 initialState 와 동일해야 한다.
const enc = new TextEncoder();
const hex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const RACE_ALGO = 'matter-physics-v1';
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

// chain: /api/results 의 results 배열 (없으면 체인 연결 검사는 생략)
// recordingRaw: 구슬 레이스일 때 /api/draws/:id/recording 의 raw 문자열
export async function verifyInBrowser(r, drawId, chain, recordingRaw) {
  const ids = r.participants.map((p) => p.id);
  const sorted = [...ids].sort();
  const isRace = r.algo === RACE_ALGO;
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
  if (isRace) {
    checks.push(...(await raceChecks(r, sorted, recordingRaw)));
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
