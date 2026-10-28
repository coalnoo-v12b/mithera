// 로또 추첨기: 물리 엔진(Rapier 3D)이 당첨자를 정한다.
// seed 는 공의 처음 위치, 물체를 만드는 순서, 바람(돌풍)의 세기·방향·타이밍에만 쓰이고, 그 뒤로는 물리 법칙만 작용한다.
// 드럼 꼭대기 구멍으로 먼저 빨려 올라간 공이 당첨이며, 특정 공을 구멍 쪽으로 유도하는 규칙은 없다 (모든 공에 같은 힘 규칙).
// 같은 seed + 같은 엔진/버전이면 항상 같은 녹화가 나와야 하므로 Math.random 이나 시간을 쓰지 않는다.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const RAPIER = require('@dimforge/rapier3d-compat');

const ALGO = 'rapier-lotto-v1';
const MAX_BALLS = 200;
const MAX_WINNERS = 50;

// 물리 조건은 버전으로 고정한다. 이미 추첨에 쓴 버전은 절대 바꾸지 않는다 (옛 결과를 다시 돌려 검증할 수 있어야 하므로).
const VERSIONS = {
  'lotto-v1': {
    R: 3, // 드럼 반지름
    G: 18, // 중력
    mixSeconds: 3.5, // 구멍을 열기 전에 섞는 시간
    cooldownFew: 2.4, // 당첨 인원이 6명 이하일 때 다음 공을 받기까지 쉬는 시간
    cooldownMany: 0.9, // 당첨 인원이 많을 때는 빠르게 연달아 뽑는다
    pullFew: [0.3, 0.12], // 구멍의 흡입력 [처음 세기, 초당 늘어나는 양]
    pullMany: [1.0, 0.6],
    flightSpeed: 5.5, // 배출관을 굴러가는 속도
    maxSpeed: 16,
    gustChance: 0.05, // 스텝마다 공의 돌풍 방향이 바뀔 확률
    gust: [70, 50, 70], // 돌풍 세기 (x, y, z)
    swirl: 1.8, // 회오리
    jet: 55, // 노즐 바로 위 상승 제트
  },
};
const LATEST = 'lotto-v1';
// 패키지가 package.json 을 exports 로 막아 두어서 파일을 직접 읽는다
const RAPIER_VERSION = JSON.parse(
  fs.readFileSync(
    path.join(
      path.dirname(require.resolve('@dimforge/rapier3d-compat')),
      'package.json'
    ),
    'utf8'
  )
).version;
const engineId = (version) =>
  `rapier3d-compat@${RAPIER_VERSION} ${version} dt=16.667ms`;
const versionOf = (engine) => {
  const m = /lotto-v\d+/.exec(engine || '');
  return m && VERSIONS[m[0]] ? m[0] : LATEST;
};

const DT = 1 / 60;
const SAMPLE = 3; // 3스텝마다 1프레임 기록 (20fps, 화면에서 보간)
const MAX_STEPS = 60 * 150;
const TAIL_STEPS = 60;
const W_SEG = 64;
const H_SEG = 48;
// 바닥 노즐 5개 위치 (반지름 1.25 원 위, 72도 간격). 엔진마다 sin/cos 결과가 다를 수 있어 숫자로 고정한다.
const NOZZLES = [
  [1.25, 0],
  [0.386271, 1.188821],
  [-1.011271, 0.734732],
  [-1.011271, -0.734732],
  [0.386271, -1.188821],
];

const round4 = (v) => Math.round(v * 1e4) / 1e4;

// seed 에서 난수열을 만든다: HMAC 으로 상태를 정하고 sfc32 로 뽑는다
function makeRng(seed, version) {
  const d = crypto
    .createHmac('sha256', seed)
    .update('lotto:' + version)
    .digest();
  let a = d.readUInt32BE(0);
  let b = d.readUInt32BE(4);
  let c = d.readUInt32BE(8);
  let e = d.readUInt32BE(12);
  const next = () => {
    const t = (((a + b) | 0) + e) | 0;
    e = (e + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let k = 0; k < 15; k++) next();
  return next;
}

// 인원과 당첨 인원에 맞춘 기계 치수. 녹화에 그대로 담아서 화면이 같은 모양으로 그린다.
function layoutFor(n, winnerCount, P) {
  const { R } = P;
  const ballR = Math.min(0.42, Math.max(0.2, R * Math.cbrt(0.13 / n)));
  const want = Math.asin(Math.min(0.9, (ballR * 1.45) / R));
  const ring = Math.max(1, Math.ceil(want / (Math.PI / H_SEG)));
  const alpha = (ring * Math.PI) / H_SEG;
  const holeR = R * Math.sin(alpha);
  const holeY = R * Math.cos(alpha);
  const tubeTop = R + 1.4;
  const trayTop = -3.2;
  const cols = Math.min(winnerCount, 10);
  const rows = Math.ceil(winnerCount / 10);
  const gap = winnerCount <= 6 ? 0.95 : Math.max(0.72, ballR * 2 + 0.3);
  const slot0 = 5.7;
  const slots = Array.from({ length: winnerCount }, (_, k) => [
    round4(slot0 + (k % cols) * gap),
    round4(trayTop + ballR * 0.75),
    round4((Math.floor(k / cols) - (rows - 1) / 2) * gap),
  ]);
  const pipe = [
    [0, tubeTop - 0.2, 0],
    [0.3, tubeTop + 0.8, 0],
    [1.7, tubeTop + 1.25, 0],
    [3.5, tubeTop + 0.7, 0],
    [4.6, tubeTop - 1.1, 0],
    [4.9, -0.6, 0],
    [4.9, trayTop + 1.0, 0],
  ].map((p) => p.map(round4));
  return {
    R,
    ballR: round4(ballR),
    holeR: round4(holeR),
    holeY: round4(holeY),
    tubeTop,
    trayTop,
    cols,
    rows,
    gap: round4(gap),
    slot0,
    slots,
    pipe,
  };
}

// 꼭대기에 구멍이 뚫린 구 (three.js SphereGeometry 와 같은 정점 배치)
function drumMesh(R, holeY) {
  const verts = [];
  for (let iy = 0; iy <= H_SEG; iy++) {
    const v = iy / H_SEG;
    for (let ix = 0; ix <= W_SEG; ix++) {
      const u = ix / W_SEG;
      verts.push(
        -R * Math.cos(u * Math.PI * 2) * Math.sin(v * Math.PI),
        R * Math.cos(v * Math.PI),
        R * Math.sin(u * Math.PI * 2) * Math.sin(v * Math.PI)
      );
    }
  }
  const at = (iy, ix) => iy * (W_SEG + 1) + ix;
  const y = (k) => verts[k * 3 + 1];
  const top = holeY - 1e-4;
  const idx = [];
  const tri = (a, b, c) => {
    if (y(a) > top || y(b) > top || y(c) > top) return;
    idx.push(a, b, c);
  };
  for (let iy = 0; iy < H_SEG; iy++) {
    for (let ix = 0; ix < W_SEG; ix++) {
      const a = at(iy, ix + 1);
      const b = at(iy, ix);
      const c = at(iy + 1, ix);
      const d = at(iy + 1, ix + 1);
      if (iy !== 0) tri(a, b, d);
      if (iy !== H_SEG - 1) tri(b, c, d);
    }
  }
  return { verts: new Float32Array(verts), idx: new Uint32Array(idx) };
}

// 공이 겹치지 않게 드럼 아래쪽에 흩뿌린다
function spawnPositions(n, ballR, R, rng) {
  const out = [];
  const maxR = R - ballR - 0.08;
  const minD2 = (ballR * 2.05) ** 2;
  for (let k = 0; k < n; k++) {
    let best = null;
    for (let tries = 0; tries < 4000 && !best; tries++) {
      const x = (rng() * 2 - 1) * maxR;
      const y = -maxR + rng() * maxR * 1.5;
      const z = (rng() * 2 - 1) * maxR;
      if (x * x + y * y + z * z > maxR * maxR) continue;
      const free = out.every(
        (p) => (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2 > minD2
      );
      if (free) best = [x, y, z];
    }
    out.push(
      best || [(rng() - 0.5) * 0.5, rng() * R * 0.6, (rng() - 0.5) * 0.5]
    );
  }
  return out;
}

// 배출관 경로: Catmull-Rom 곡선을 촘촘히 찍고 길이 기준으로 위치를 찾는다
function makePath(points) {
  const P = [points[0], ...points, points[points.length - 1]];
  const samples = [];
  const SUB = 24;
  for (let s = 1; s < P.length - 2; s++) {
    const [p0, p1, p2, p3] = [P[s - 1], P[s], P[s + 1], P[s + 2]];
    for (let k = 0; k < SUB; k++) {
      const t = k / SUB;
      const t2 = t * t;
      const t3 = t2 * t;
      samples.push(
        [0, 1, 2].map(
          (j) =>
            0.5 *
            (2 * p1[j] +
              (-p0[j] + p2[j]) * t +
              (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 +
              (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)
        )
      );
    }
  }
  samples.push(points[points.length - 1]);
  const acc = [0];
  for (let k = 1; k < samples.length; k++) {
    const a = samples[k - 1];
    const b = samples[k];
    acc.push(
      acc[k - 1] +
        Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
    );
  }
  const len = acc[acc.length - 1];
  const at = (u) => {
    const target = u * len;
    let k = 1;
    while (k < acc.length - 1 && acc[k] < target) k++;
    const span = acc[k] - acc[k - 1] || 1;
    const f = Math.min(1, Math.max(0, (target - acc[k - 1]) / span));
    const a = samples[k - 1];
    const b = samples[k];
    return {
      x: a[0] + (b[0] - a[0]) * f,
      y: a[1] + (b[1] - a[1]) * f,
      z: a[2] + (b[2] - a[2]) * f,
    };
  };
  return { len, at };
}

let ready = null;
const initRapier = () => {
  if (!ready) ready = RAPIER.init();
  return ready;
};

// 시뮬레이션 전체를 돌려 녹화(raw JSON 문자열)와 당첨 순서를 돌려준다.
async function simulate({ seed, n, winnerCount, version = LATEST }) {
  const P = VERSIONS[version];
  if (!P) throw new Error('알 수 없는 로또 버전: ' + version);
  if (n < 1 || n > MAX_BALLS) throw new Error(`공은 1~${MAX_BALLS}개여야 해요`);
  if (winnerCount < 1 || winnerCount > Math.min(n, MAX_WINNERS))
    throw new Error('당첨 인원이 올바르지 않아요');
  await initRapier();

  const { R, G } = P;
  const rng = makeRng(seed, version);
  const L = layoutFor(n, winnerCount, P);
  const { ballR, holeR, holeY, tubeTop } = L;
  const pipeTail = L.pipe.slice(1);

  // 공 번호 i 는 정렬된 참가자 목록의 i 번째. 위치와 생성 순서는 seed 로 섞는다 (가입 순서가 유리하지 않게).
  const spawns = spawnPositions(n, ballR, R, rng);
  const keys = Array.from({ length: n }, () => rng());
  const createOrder = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => keys[a] - keys[b] || a - b
  );

  const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = DT;
  try {
    const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const drum = drumMesh(R, holeY);
    world.createCollider(
      RAPIER.ColliderDesc.trimesh(drum.verts, drum.idx)
        .setRestitution(0.55)
        .setFriction(0.1),
      fixed
    );
    // 배출관 벽: 얇은 판 12장을 원통 모양으로 세움
    const walls = 12;
    const wallH = (tubeTop - holeY + 0.3) / 2;
    const half = holeR * Math.tan(Math.PI / walls) + 0.04;
    for (let k = 0; k < walls; k++) {
      const a = (k / walls) * Math.PI * 2;
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.05, wallH, half)
          .setTranslation(
            Math.cos(a) * (holeR + 0.05),
            holeY - 0.3 + wallH,
            Math.sin(a) * (holeR + 0.05)
          )
          .setRotation({
            x: 0,
            y: Math.sin(-a / 2),
            z: 0,
            w: Math.cos(-a / 2),
          }),
        fixed
      );
    }
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.05, holeR + 0.1).setTranslation(
        0,
        tubeTop,
        0
      ),
      fixed
    );
    const gate = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.06, holeR + 0.12).setTranslation(
        0,
        holeY + 0.02,
        0
      ),
      gate
    );

    const bodies = new Array(n);
    for (const i of createOrder) {
      const [x, y, z] = spawns[i];
      const b = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(x, y, z)
          .setLinearDamping(0.25)
          .setAngularDamping(0.4)
          .setCcdEnabled(true)
      );
      world.createCollider(
        RAPIER.ColliderDesc.ball(ballR).setRestitution(0.72).setFriction(0.15),
        b
      );
      bodies[i] = b;
    }

    // 녹화: 공마다 위치(mm 단위 정수)의 변화량
    const pos = bodies.map(() => []);
    const prev = bodies.map(() => [0, 0, 0]);
    let frames = 0;
    const record = () => {
      bodies.forEach((b, i) => {
        const t = b.translation();
        const q = [
          Math.round(t.x * 1000),
          Math.round(t.y * 1000),
          Math.round(t.z * 1000),
        ];
        pos[i].push(q[0] - prev[i][0], q[1] - prev[i][1], q[2] - prev[i][2]);
        prev[i] = q;
      });
      frames++;
    };
    record();

    const mixSteps = Math.round(P.mixSeconds * 60);
    const many = winnerCount > 6;
    const cooldown = Math.round((many ? P.cooldownMany : P.cooldownFew) * 60);
    const [pull0, pullRate] = many ? P.pullMany : P.pullFew;
    const order = [];
    const captures = [];
    const arrivals = [];
    const gateLog = [];
    const captured = new Set();
    const flights = [];
    const gusts = new Array(n);
    let gateOpen = false;
    let openedAt = 0;
    let cooldownUntil = 0;
    let airOff = -1;
    let stopAt = -1;
    let step = 0;

    const capture = (i, b) => {
      const slot = order.length;
      order.push(i);
      captured.add(i);
      captures.push([i, frames]);
      cooldownUntil = step + cooldown;
      gateOpen = false;
      gate.setEnabled(true);
      gateLog.push([frames, 0]);
      // 구멍 근처에 같이 올라와 있던 공은 아래로 돌려보낸다 (모든 공에 같은 규칙)
      bodies.forEach((o, k) => {
        if (captured.has(k)) return;
        const p = o.translation();
        if (
          p.y > holeY - ballR * 1.4 &&
          Math.sqrt(p.x * p.x + p.z * p.z) < holeR + ballR
        ) {
          o.setTranslation(
            { x: p.x * 0.5, y: holeY - ballR * 2.6, z: p.z * 0.5 },
            true
          );
          o.setLinvel({ x: 0, y: -3, z: 0 }, true);
        }
      });
      const p = b.translation();
      const end = L.slots[slot];
      const path = makePath([
        [p.x, p.y, p.z],
        ...pipeTail,
        [L.slot0 - 0.6, end[1] + 0.05, end[2]],
        end,
      ]);
      b.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      flights.push({
        i,
        b,
        path,
        start: step,
        dur: Math.round((1.2 + path.len / P.flightSpeed) * 60),
      });
      if (order.length >= winnerCount) airOff = step;
    };

    while (step < MAX_STEPS) {
      const air = step < mixSteps || airOff < 0;
      const drawing = step >= mixSteps && order.length < winnerCount;
      const wantOpen = drawing && step >= cooldownUntil;
      if (wantOpen !== gateOpen) {
        gateOpen = wantOpen;
        gate.setEnabled(!wantOpen);
        if (wantOpen) openedAt = step;
        gateLog.push([frames, wantOpen ? 1 : 0]);
      }
      const pull = Math.min(3, pull0 + ((step - openedAt) / 60) * pullRate);

      for (const f of flights) {
        if (f.done) continue;
        const t = Math.min(1, (step - f.start) / f.dur);
        const u = t * t * (3 - 2 * t);
        f.b.setNextKinematicTranslation(f.path.at(u));
        if (t >= 1) {
          f.done = true;
          arrivals.push([f.i, frames]);
        }
      }

      bodies.forEach((b, i) => {
        if (captured.has(i)) return;
        const p = b.translation();
        const m = b.mass();
        const rxz = Math.sqrt(p.x * p.x + p.z * p.z);
        let fx = 0;
        let fy = 0;
        let fz = 0;
        if (air) {
          // 아래쪽일수록 강한 상승 기류 + 노즐 바로 위 제트 + 회오리 + 공마다 바뀌는 돌풍
          const h = (p.y + R) / (2 * R);
          fy += G * m * (1.8 - 1.55 * h);
          if (p.y < -R * 0.35) {
            for (const [nx, nz] of NOZZLES) {
              const dx = p.x - nx;
              const dz = p.z - nz;
              if (dx * dx + dz * dz < 0.5625) fy += P.jet * m;
            }
          }
          fx += -p.z * P.swirl * m;
          fz += p.x * P.swirl * m;
          if (!gusts[i] || rng() < P.gustChance) {
            gusts[i] = [
              (rng() - 0.5) * P.gust[0],
              (rng() - 0.5) * P.gust[1],
              (rng() - 0.5) * P.gust[2],
            ];
          }
          fx += gusts[i][0] * m;
          fy += gusts[i][1] * m;
          fz += gusts[i][2] * m;
        }
        if (gateOpen) {
          // 구멍이 열리면 위쪽 가운데로 빨아들인다. 오래 안 들어가면 점점 세진다.
          if (p.y > R * 0.25 && rxz < 1.9) {
            fx += -p.x * 9 * pull * m;
            fz += -p.z * 9 * pull * m;
            fy += 16 * pull * m;
          }
          if (rxz < holeR && p.y > holeY - ballR) {
            fy += 70 * m;
            fx += -p.x * 30 * m;
            fz += -p.z * 30 * m;
          }
        }
        b.applyImpulse({ x: fx * DT, y: fy * DT, z: fz * DT }, true);

        const v = b.linvel();
        const sp = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
        if (sp > P.maxSpeed) {
          const k = P.maxSpeed / sp;
          b.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
        }
        // 드럼 밖으로 새어 나간 공은 안으로 되돌린다 (안전장치)
        const inTube = rxz < holeR + 0.2 && p.y > holeY - 0.4;
        if (Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) > R + 0.3 && !inTube) {
          b.setTranslation({ x: 0, y: -R * 0.4, z: 0 }, true);
          b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
        if (gateOpen && rxz < holeR && p.y > holeY + ballR * 1.7) capture(i, b);
      });

      world.step();
      step++;
      if (step % SAMPLE === 0) record();
      if (stopAt < 0 && arrivals.length >= winnerCount)
        stopAt = step + TAIL_STEPS;
      if (stopAt >= 0 && step >= stopAt) break;
    }
    if (order.length < winnerCount || arrivals.length < winnerCount)
      throw new Error('제한 시간 안에 추첨이 끝나지 않았어요');
    if (step % SAMPLE !== 0) record();

    const recording = {
      v: 1,
      kind: 'lotto',
      version,
      n,
      winnerCount,
      fps: 60 / SAMPLE,
      frames,
      layout: L,
      mixEnd: Math.floor(mixSteps / SAMPLE),
      airOff: Math.floor(airOff / SAMPLE),
      gate: gateLog,
      captures,
      arrivals,
      pos,
      order,
    };
    return {
      raw: JSON.stringify(recording),
      order,
      frames,
      seconds: step / 60,
      engine: engineId(version),
    };
  } finally {
    world.free();
  }
}

module.exports = {
  simulate,
  ALGO,
  LATEST,
  MAX_BALLS,
  MAX_WINNERS,
  engineId,
  versionOf,
};
