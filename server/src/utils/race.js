// 구슬 레이스: 물리 엔진(matter-js)이 승자를 정한다.
// 출발 위치/속도는 마감 때 봉인한 seed 에서만 나오고, 그 뒤로는 물리 법칙만 작용한다 (승자 유도 없음).
// 같은 seed + 같은 엔진/트랙이면 항상 같은 녹화(raw)가 나와야 하므로, 시뮬레이션에는 Math.random 이나 시간을 쓰지 않는다.
const crypto = require('crypto');
const Matter = require('matter-js');

const { Engine, Composite, Bodies, Body, Constraint, Events } = Matter;

const ALGO = 'matter-physics-v1';

const W = 600;
const H = 3900;
const FINISH_Y = 3600;
const STEP_MS = 1000 / 60;

// 물리 조건은 버전으로 고정한다. 이미 추첨된 결과는 자기 버전으로만 다시 재현·검증되므로 기존 버전은 절대 바꾸지 않는다.
//  - v1: 가볍고 빠르게 떨어져 구슬이 길게 흩어졌다 (기록 보존용)
//  - v2: 공기저항을 높이고 중력도 높여, 구슬이 한 무리로 몰려 내려오며 순위가 계속 바뀐다. 밀집해서 출발한다.
//  - v3: v2 와 같고, 범퍼에 닿은 구슬은 범퍼에서 멀어지는 방향(+ 살짝 위쪽)으로 튕겨 나간다.
//        범퍼에 걸려 멈추는 구슬이 없어지며, 닿는 모든 구슬에 똑같이 적용되는 규칙이다 (bumperKick = 튕기는 속도).
const VERSIONS = {
  'track-v1': { gravity: 0.28, frictionAir: 0.0015, maxCols: (n) => n },
  'track-v2': {
    gravity: 1.5,
    frictionAir: 0.03,
    maxCols: (n) => Math.max(4, Math.ceil(Math.sqrt(n))),
  },
  'track-v3': {
    gravity: 1.5,
    frictionAir: 0.03,
    maxCols: (n) => Math.max(4, Math.ceil(Math.sqrt(n))), // client/src/verify.js 는 v1 이 아니면 이 규칙을 쓴다
    bumperKick: 9,
  },
};
const LATEST = 'track-v3';
const engineId = (version) =>
  `matter-js@${require('matter-js/package.json').version} ${version} dt=16.667ms`;
const versionOf = (engine) => {
  const m = /track-v\d+/.exec(engine || '');
  return m && VERSIONS[m[0]] ? m[0] : 'track-v1';
};
const SAMPLE = 2; // 2스텝마다 1프레임 기록 (30fps)
const MAX_STEPS = 60 * 120;
const TAIL_STEPS = 60; // 마지막 당첨자가 들어온 뒤 1초 더 기록

const radiusFor = (n) => (n <= 12 ? 12 : n <= 30 ? 10 : n <= 60 ? 8 : 6);

// seed 에서 [0,1) 난수열을 만든다. (거절 샘플링 없음 — 소비 개수가 고정이라 브라우저에서도 똑같이 계산 가능)
function floatsFor(seed, count) {
  const out = [];
  for (let j = 0; out.length < count; j++) {
    const block = crypto
      .createHmac('sha256', seed)
      .update('race:' + j)
      .digest();
    for (let k = 0; k < 8 && out.length < count; k++)
      out.push(block.readUInt32BE(k * 4) / 4294967296);
  }
  return out;
}

// 출발 위치/속도. 칸 배정은 난수로 섞어서 특정 위치가 유리하지 않게 한다.
// 이 함수는 client/src/verify.js 에도 똑같이 있다 (브라우저가 녹화의 첫 프레임을 검증하기 위해).
function slotOrder(n, f) {
  return Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => f[a] - f[b] || a - b
  ); // slotOf[slot] = marble
}
function initialState(n, f, r, version = LATEST) {
  const slotOf = slotOrder(n, f);
  const spacing = 2 * r + 4;
  const cols = Math.max(
    1,
    Math.min(n, Math.floor((W - 80) / spacing), VERSIONS[version].maxCols(n))
  );
  const out = new Array(n);
  slotOf.forEach((marble, slot) => {
    const row = Math.floor(slot / cols);
    const col = slot % cols;
    out[marble] = {
      x:
        W / 2 +
        (col - (cols - 1) / 2) * spacing +
        (f[n + 2 * marble] - 0.5) * 2,
      y: 40 + row * spacing + (f[n + 2 * marble + 1] - 0.5) * 2,
      vx: (f[3 * n + marble] - 0.5) * 2,
    };
  });
  return out;
}

function buildTrack() {
  const shapes = { circles: [], rects: [], bars: [] };
  const statics = [];
  const circle = (x, y, rad, restitution = 0.6, label = 'pin') => {
    shapes.circles.push([x, y, rad]);
    statics.push(
      Bodies.circle(x, y, rad, {
        isStatic: true,
        restitution,
        friction: 0,
        label,
      })
    );
  };
  const rect = (cx, cy, w, h, angle = 0) => {
    const a = Math.round(angle * 1000) / 1000;
    shapes.rects.push([cx, cy, w, h, a]);
    statics.push(
      Bodies.rectangle(cx, cy, w, h, {
        isStatic: true,
        angle: a,
        friction: 0,
        restitution: 0.3,
      })
    );
  };

  // 벽과 바닥
  rect(-15, H / 2, 30, H + 400);
  rect(W + 15, H / 2, 30, H + 400);
  rect(W / 2, H + 20, W + 100, 40);

  // 1구간: 핀 (y 320~1030)
  for (let row = 0; row < 12; row++) {
    const y = 320 + row * 65;
    for (let x = 40 + (row % 2 ? 30 : 0); x <= W - 30; x += 60) circle(x, y, 8);
  }

  // 2구간: 회전 막대 (y 1250~1720)
  const barDefs = [
    { cx: 150, cy: 1250, len: 220, om: 0.035 },
    { cx: 450, cy: 1250, len: 220, om: -0.035 },
    { cx: 300, cy: 1500, len: 300, om: 0.03 },
    { cx: 130, cy: 1720, len: 200, om: -0.04 },
    { cx: 470, cy: 1720, len: 200, om: 0.04 },
  ];
  const bars = barDefs.map((b) => {
    shapes.bars.push([b.cx, b.cy, b.len, 14]);
    const body = Bodies.rectangle(b.cx, b.cy, b.len, 14, {
      density: 0.05,
      frictionAir: 0,
      friction: 0,
      restitution: 0.2,
    });
    const pin = Constraint.create({
      pointA: { x: b.cx, y: b.cy },
      bodyB: body,
      pointB: { x: 0, y: 0 },
      stiffness: 1,
      length: 0,
    });
    return { body, pin, cx: b.cx, cy: b.cy, om: b.om };
  });

  // 3구간: 지그재그 경사 (y 1900~2650)
  for (let i = 0; i < 4; i++) {
    const dir = i % 2 === 0 ? 1 : -1;
    rect(dir > 0 ? 240 : 360, 1900 + i * 250, 480, 16, dir * 0.2);
  }

  // 4구간: 촘촘한 핀 + 범퍼 (y 2850~3450)
  for (let row = 0; row < 11; row++) {
    const y = 2850 + row * 60;
    for (let x = 35 + (row % 2 ? 25 : 0); x <= W - 25; x += 50) circle(x, y, 7);
  }
  circle(150, 3300, 22, 1.1, 'bumper');
  circle(450, 3300, 22, 1.1, 'bumper');
  circle(300, 3470, 22, 1.1, 'bumper');

  return { shapes, statics, bars };
}

// 시뮬레이션 전체를 돌려 녹화(raw JSON 문자열)와 도착 순서를 돌려준다.
function simulate({ seed, n, winnerCount, version = LATEST }) {
  const P = VERSIONS[version];
  if (!P) throw new Error('알 수 없는 트랙 버전: ' + version);
  Matter.Common._nextId = 0; // 엔진 내부 전역 상태를 초기화해서 매번 같은 조건으로 시작한다
  Matter.Common._seed = 0;

  const r = radiusFor(n);
  const f = floatsFor(seed, 4 * n);
  const init = initialState(n, f, r, version);
  const slotOf = slotOrder(n, f);
  const slotRank = new Array(n);
  slotOf.forEach((marble, slot) => {
    slotRank[marble] = slot;
  });
  const engine = Engine.create({ enableSleeping: false });
  engine.gravity.y = P.gravity;
  const { shapes, statics, bars } = buildTrack();
  Composite.add(engine.world, statics);
  Composite.add(
    engine.world,
    bars.map((b) => b.body)
  );
  Composite.add(
    engine.world,
    bars.map((b) => b.pin)
  );

  // 엔진은 먼저 만든 물체를 먼저 처리하므로, 참가자 순서(= 가입 순서)가 아니라 seed 로 섞은 칸 순서로 만든다.
  const marbles = new Array(n);
  for (const i of slotOf) {
    const s = init[i];
    const b = Bodies.circle(s.x, s.y, r, {
      restitution: 0.55,
      friction: 0.005,
      frictionAir: P.frictionAir,
      density: 0.002,
      slop: 0.05,
    });
    Body.setVelocity(b, { x: s.vx, y: 0 });
    marbles[i] = b;
  }
  Composite.add(
    engine.world,
    slotOf.map((i) => marbles[i])
  );

  // v3: 범퍼에 닿는 순간 구슬을 범퍼에서 멀어지는 방향으로 튕겨낸다. 항상 조금은 위쪽(뒤)으로 가게 한다.
  if (P.bumperKick) {
    Events.on(engine, 'collisionStart', (e) => {
      for (const { bodyA, bodyB } of e.pairs) {
        const bumper =
          bodyA.label === 'bumper'
            ? bodyA
            : bodyB.label === 'bumper'
              ? bodyB
              : null;
        if (!bumper) continue;
        const m = bumper === bodyA ? bodyB : bodyA;
        if (m.isStatic) continue;
        const dx = m.position.x - bumper.position.x;
        const dy = m.position.y - bumper.position.y;
        const d = Math.hypot(dx, dy) || 1;
        Body.setVelocity(m, {
          x: (dx / d) * P.bumperKick,
          y: Math.min((dy / d) * P.bumperKick, -2),
        });
      }
    });
  }

  const pos = marbles.map(() => []);
  const prev = marbles.map(() => [0, 0]);
  const barRec = bars.map(() => []);
  const prevBar = bars.map(() => 0);
  let frames = 0;
  const record = () => {
    marbles.forEach((b, i) => {
      const x = Math.round(b.position.x),
        y = Math.round(b.position.y);
      pos[i].push(x - prev[i][0], y - prev[i][1]);
      prev[i] = [x, y];
    });
    bars.forEach((bar, k) => {
      const a = Math.round(bar.body.angle * 1000);
      barRec[k].push(a - prevBar[k]);
      prevBar[k] = a;
    });
    frames++;
  };
  record();

  const finished = new Array(n).fill(false);
  const order = [];
  const bestY = marbles.map((b) => b.position.y);
  const bestStep = new Array(n).fill(0);
  let step = 0;
  let stopAt = -1;
  while (step < MAX_STEPS) {
    for (const bar of bars) {
      Body.setPosition(bar.body, { x: bar.cx, y: bar.cy }, false);
      Body.setAngularVelocity(bar.body, bar.om);
    }
    Engine.update(engine, STEP_MS);
    step++;

    const crossed = [];
    marbles.forEach((b, i) => {
      if (!finished[i] && b.position.y >= FINISH_Y) crossed.push(i);
    });
    crossed.sort(
      (a, b) =>
        marbles[b].position.y - marbles[a].position.y ||
        slotRank[a] - slotRank[b]
    );
    for (const i of crossed) {
      finished[i] = true;
      order.push(i);
    }

    // 끼어서 멈춘 구슬은 정해진 규칙대로 살짝 밀어준다 (모든 구슬에 똑같이 적용되는 규칙)
    marbles.forEach((b, i) => {
      if (finished[i]) return;
      if (b.position.y > bestY[i] + 6) {
        bestY[i] = b.position.y;
        bestStep[i] = step;
      } else if (step - bestStep[i] > 150) {
        Body.setVelocity(b, {
          x: (slotRank[i] % 2 ? 1 : -1) * (2 + (step % 3)),
          y: -2,
        });
        bestStep[i] = step;
      }
    });

    if (step % SAMPLE === 0) record();
    if (stopAt < 0 && order.length >= winnerCount) stopAt = step + TAIL_STEPS;
    if (stopAt >= 0 && step >= stopAt) break;
  }
  if (step % SAMPLE !== 0) record();

  // 최종 순위: 결승선을 넘은 순서 → 못 넘은 구슬은 더 아래까지 간 순서
  const rest = marbles
    .map((_, i) => i)
    .filter((i) => !finished[i])
    .sort(
      (a, b) =>
        marbles[b].position.y - marbles[a].position.y ||
        slotRank[a] - slotRank[b]
    );
  const fullOrder = order.concat(rest);

  const recording = {
    v: 1,
    track: version,
    W,
    H,
    finishY: FINISH_Y,
    r,
    n,
    fps: 60 / SAMPLE,
    frames,
    winnerCount,
    shapes,
    pos,
    bars: barRec,
    order: fullOrder,
  };
  const raw = JSON.stringify(recording);
  return {
    raw,
    order: fullOrder,
    frames,
    seconds: step / 60,
    engine: engineId(version),
  };
}

module.exports = {
  simulate,
  ALGO,
  LATEST,
  engineId,
  versionOf,
  W,
  H,
  FINISH_Y,
  radiusFor,
  floatsFor,
  slotOrder,
  initialState,
};
