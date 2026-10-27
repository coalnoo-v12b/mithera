// 카지노 룰렛: 물리 엔진(Rapier 3D)이 당첨자를 정한다.
// 휠(칸막이와 칸이 있는 회전판)이 돌고, 바깥 트랙에 반대 방향으로 굴린 공이 속도를 잃으면서 경사를 타고 내려와
// 다이아몬드(범퍼)에 튕기고 칸막이 사이를 오가다가 한 칸에 멈춘다. 그 칸의 주인이 당첨이다.
// 여러 명을 뽑을 때는 당첨된 사람의 칸을 모두 덮개로 막고 공을 다시 굴린다.
// seed 는 칸 배치, 휠 속도, 공을 던지는 위치와 세기에만 쓰이고, 그 뒤로는 물리 법칙만 작용한다.
// 같은 seed + 같은 엔진/버전이면 항상 같은 녹화가 나와야 하므로 Math.random 이나 시간을 쓰지 않는다.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const RAPIER = require('@dimforge/rapier3d-compat');

const ALGO = 'rapier-roulette-v1';
const MAX_PLAYERS = 36;
const MAX_WINNERS = 10;
const MIN_POCKETS = 12; // 인원이 적으면 한 사람이 칸을 여러 개(같은 간격으로) 가진다

// 물리 조건과 기계 치수는 버전으로 고정한다. 이미 추첨에 쓴 버전은 절대 바꾸지 않는다.
const VERSIONS = {
  'roulette-v1': {
    G: 30,
    ballR: 0.12,
    // 바깥 그릇(움직이지 않음): 공이 도는 경사 트랙
    trackOut: 4.1,
    trackOutY: 0,
    trackIn: 3.15,
    trackInY: -0.38,
    wallR: 4.12,
    wallTop: 0.6,
    deflectorR: 3.55,
    deflectors: 8,
    // 회전판(휠)
    rimOut: 3.12,
    rimIn: 2.92,
    rimOutY: -0.4, // 테두리는 칸 쪽으로 기울어 있어서 공이 테두리에 머물지 않는다
    rimY: -0.47,
    pocketIn: 2.2,
    pocketOut: 2.92,
    floorInY: -0.58,
    floorOutY: -0.62,
    fretH: 0.14,
    coneTopR: 0.5,
    coneTopY: 0.1,
    turretTop: 0.8,
    // 회전 속도 [최소, 최대] (rad/s), 공 속도 [최소, 최대]. 첫 판은 길게, 다음 판부터는 짧게 굴린다.
    spin: [0.7, 1.3],
    launch: [12, 15],
    launchNext: [9.5, 11.5],
    ballDamping: 0.06,
    settleSpeed: 0.25,
    settleSeconds: 0.7, // 휠과 같이 움직인 채로 이만큼 지나면 멈춘 것으로 본다
    holdSeconds: 1.6,
    maxRoundSeconds: 45,
    // 튀는 정도 (반발 계수)
    ballBounce: 0.4,
    fretBounce: 0.5,
    deflectorBounce: 0.7,
  },
};
// v2: 판마다 공 세기·휠 속도·안쪽으로 던지는 정도를 더 넓게 섞어서, 한 명 뽑는 데 걸리는 시간이 판마다 다르고
// 다이아몬드와 칸막이에 더 세게 튕긴다 (나머지 치수는 v1 과 같음)
VERSIONS['roulette-v2'] = {
  ...VERSIONS['roulette-v1'],
  spin: [0.5, 1.8],
  launch: [12, 16],
  launchNext: [8, 15],
  launchInward: [0, 1.6],
  ballBounce: 0.55,
  fretBounce: 0.7,
  deflectorBounce: 0.95,
};
const LATEST = 'roulette-v2';
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
  `rapier3d-compat@${RAPIER_VERSION} ${version} dt=8.333ms`;
const versionOf = (engine) => {
  const m = /roulette-v\d+/.exec(engine || '');
  return m && VERSIONS[m[0]] ? m[0] : LATEST;
};

// CCD(연속 충돌 감지)는 공이 트랙을 미끄러질 때 갑자기 멈추게 만들어서 쓰지 않는다.
// 대신 1초에 120번 계산해서 빠른 공이 얇은 벽을 뚫고 지나가지 않게 한다.
const HZ = 120;
const DT = 1 / HZ;
const SAMPLE = 4; // 4스텝마다 1프레임 기록 (30fps)
const TAU = Math.PI * 2;

// seed 에서 난수열을 만든다: HMAC 으로 상태를 정하고 sfc32 로 뽑는다
function makeRng(seed, version) {
  const d = crypto
    .createHmac('sha256', seed)
    .update('roulette:' + version)
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

const pocketCount = (n) => n * Math.ceil(MIN_POCKETS / n);

// y 축 회전 쿼터니언. 이 회전으로 로컬 각도 α 에 있던 점은 세계 각도 α - θ 로 간다.
const yRot = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });

// 반지름 r0(높이 y0)에서 r1(높이 y1)까지 이어지는 고리 모양 면.
// flip: 삼각형 감는 방향을 뒤집는다 (한쪽 면만 쓰는 매끈한 충돌면은 공이 닿는 쪽을 앞면으로 해야 한다)
function ringMesh(r0, y0, r1, y1, seg = 96, flip = false) {
  const verts = [];
  const idx = [];
  for (let k = 0; k < seg; k++) {
    const a = (k / seg) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    verts.push(r0 * c, y0, r0 * s, r1 * c, y1, r1 * s);
  }
  for (let k = 0; k < seg; k++) {
    const i = k * 2;
    const j = ((k + 1) % seg) * 2;
    if (flip) idx.push(i, i + 1, j, i + 1, j + 1, j);
    else idx.push(i, j, i + 1, i + 1, j, j + 1);
  }
  return { verts: new Float32Array(verts), idx: new Uint32Array(idx) };
}

// 칸 하나를 덮는 쐐기 모양 덮개 (휠 기준 좌표)
function lidPoints(p, P, V) {
  const a0 = (p / P) * TAU + 0.012;
  const a1 = ((p + 1) / P) * TAU - 0.012;
  const pts = [];
  for (const a of [a0, (a0 + a1) / 2, a1]) {
    for (const r of [V.pocketIn + 0.02, V.pocketOut - 0.02]) {
      for (const y of [V.rimY - 0.06, V.rimY - 0.02]) {
        pts.push(r * Math.cos(a), y, r * Math.sin(a));
      }
    }
  }
  return new Float32Array(pts);
}

// 삼각형 이음매에 공이 걸려 튀지 않도록 내부 모서리를 매끈하게 처리한다
const SMOOTH = RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES;

let ready = null;
const initRapier = () => {
  if (!ready) ready = RAPIER.init();
  return ready;
};

// 시뮬레이션 전체를 돌려 녹화(raw JSON 문자열)와 당첨 순서(참가자 번호)를 돌려준다.
async function simulate({ seed, n, winnerCount, version = LATEST }) {
  const V = VERSIONS[version];
  if (!V) throw new Error('알 수 없는 룰렛 버전: ' + version);
  if (n < 1 || n > MAX_PLAYERS)
    throw new Error(`참가자는 1~${MAX_PLAYERS}명이어야 해요`);
  if (winnerCount < 1 || winnerCount > Math.min(n, MAX_WINNERS))
    throw new Error('당첨 인원이 올바르지 않아요');
  await initRapier();
  const rng = makeRng(seed, version);

  // 칸 주인: 참가자 순서를 seed 로 섞고 칸 번호 p 는 perm[p % n] 의 것 (한 사람의 칸은 같은 간격으로 흩어진다)
  const P = pocketCount(n);
  const keys = Array.from({ length: n }, () => rng());
  const perm = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => keys[a] - keys[b] || a - b
  );
  const owner = Array.from({ length: P }, (_, p) => perm[p % n]);

  const world = new RAPIER.World({ x: 0, y: -V.G, z: 0 });
  world.timestep = DT;
  try {
    // 바깥 그릇
    const bowl = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    // 트랙과 바깥 벽은 매끈해야 공이 오래 돈다 (각진 벽이면 모서리에 부딪혀 금방 느려진다)
    const track = ringMesh(
      V.trackOut,
      V.trackOutY,
      V.trackIn,
      V.trackInY,
      256,
      true
    );
    world.createCollider(
      RAPIER.ColliderDesc.trimesh(track.verts, track.idx, SMOOTH)
        .setFriction(0.15)
        .setRestitution(0.2),
      bowl
    );
    const wall = ringMesh(V.wallR, V.trackOutY - 0.1, V.wallR, V.wallTop, 256);
    world.createCollider(
      RAPIER.ColliderDesc.trimesh(wall.verts, wall.idx, SMOOTH)
        .setFriction(0.02)
        .setRestitution(0.1),
      bowl
    );
    // 다이아몬드 범퍼: 트랙 경사 위에 비스듬히 놓인 작은 마름모
    const slope = (V.trackOutY - V.trackInY) / (V.trackOut - V.trackIn);
    const deflY = V.trackOutY - slope * (V.trackOut - V.deflectorR);
    for (let k = 0; k < V.deflectors; k++) {
      const a = ((k + 0.5) / V.deflectors) * TAU;
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.13, 0.05, 0.06)
          .setTranslation(
            Math.cos(a) * V.deflectorR,
            deflY + 0.03,
            Math.sin(a) * V.deflectorR
          )
          .setRotation(yRot(-a + Math.PI / 4))
          .setRestitution(V.deflectorBounce)
          .setFriction(0.1),
        bowl
      );
    }

    // 회전판(휠): 속도로 움직이는 키네마틱 물체에 테두리, 칸 바닥, 칸막이, 가운데 원뿔을 붙인다
    const wheel = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicVelocityBased().setRotation(
        yRot(rng() * TAU)
      )
    );
    const add = (desc) => world.createCollider(desc, wheel);
    const rim = ringMesh(V.rimOut, V.rimOutY, V.rimIn, V.rimY, 96);
    add(RAPIER.ColliderDesc.trimesh(rim.verts, rim.idx).setFriction(0.3));
    const outerWall = ringMesh(V.rimIn, V.rimY, V.pocketOut, V.floorOutY, 96);
    add(RAPIER.ColliderDesc.trimesh(outerWall.verts, outerWall.idx));
    const floor = ringMesh(
      V.pocketOut,
      V.floorOutY,
      V.pocketIn,
      V.floorInY,
      96
    );
    add(
      RAPIER.ColliderDesc.trimesh(floor.verts, floor.idx)
        .setFriction(0.6)
        .setRestitution(0.2)
    );
    const cone = ringMesh(
      V.pocketIn,
      V.floorInY + 0.12,
      V.coneTopR,
      V.coneTopY,
      96
    );
    add(RAPIER.ColliderDesc.trimesh(cone.verts, cone.idx).setFriction(0.2));
    const innerStep = ringMesh(
      V.pocketIn,
      V.floorInY,
      V.pocketIn,
      V.floorInY + 0.12,
      96
    );
    add(RAPIER.ColliderDesc.trimesh(innerStep.verts, innerStep.idx));
    add(
      RAPIER.ColliderDesc.cylinder(
        (V.turretTop - V.coneTopY) / 2,
        V.coneTopR
      ).setTranslation(0, (V.turretTop + V.coneTopY) / 2, 0)
    );
    const fretLen = (V.pocketOut - V.pocketIn) / 2;
    const fretMid = (V.pocketOut + V.pocketIn) / 2;
    for (let p = 0; p < P; p++) {
      const a = (p / P) * TAU;
      add(
        RAPIER.ColliderDesc.cuboid(fretLen, V.fretH / 2, 0.015)
          .setTranslation(
            Math.cos(a) * fretMid,
            V.floorOutY + V.fretH / 2,
            Math.sin(a) * fretMid
          )
          .setRotation(yRot(-a))
          .setRestitution(V.fretBounce)
          .setFriction(0.2)
      );
    }

    const ball = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, 3, 0)
        .setLinearDamping(V.ballDamping)
        .setAngularDamping(0.2)
    );
    world.createCollider(
      RAPIER.ColliderDesc.ball(V.ballR)
        .setRestitution(V.ballBounce)
        .setFriction(0.3),
      ball
    );

    const wheelAngle = () => {
      const q = wheel.rotation();
      return 2 * Math.atan2(q.y, q.w);
    };
    let unwrapped = wheelAngle();
    let lastRaw = unwrapped;
    const trackAngle = () => {
      const raw = wheelAngle();
      let d = raw - lastRaw;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      unwrapped += d;
      lastRaw = raw;
      return unwrapped;
    };

    // 녹화: 공 위치(mm), 휠 각도(1e-4 rad)의 변화량
    const ballRec = [];
    const wheelRec = [];
    let prev = [0, 0, 0, 0];
    let frames = 0;
    const record = () => {
      const t = ball.translation();
      const q = [
        Math.round(t.x * 1000),
        Math.round(t.y * 1000),
        Math.round(t.z * 1000),
        Math.round(trackAngle() * 1e4),
      ];
      ballRec.push(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]);
      wheelRec.push(q[3] - prev[3]);
      prev = q;
      frames++;
    };

    const lidded = new Set();
    const rounds = [];
    const order = [];
    let step = 0;

    const launch = (round) => {
      const phi = rng() * TAU;
      const [lo, hi] = round === 0 ? V.launch : V.launchNext;
      const speed = lo + rng() * (hi - lo);
      const omega = V.spin[0] + rng() * (V.spin[1] - V.spin[0]);
      // v2 부터: 판마다 안쪽으로 살짝 던지는 정도가 달라서 트랙을 도는 시간이 달라진다 (v1 은 난수를 더 쓰지 않음)
      const inward = V.launchInward
        ? V.launchInward[0] + rng() * (V.launchInward[1] - V.launchInward[0])
        : 0;
      const r = V.trackOut - 0.25;
      const y = V.trackOutY - slope * 0.25 + V.ballR + 0.02;
      ball.setTranslation(
        { x: r * Math.cos(phi), y, z: r * Math.sin(phi) },
        true
      );
      // 휠과 반대 방향(세계 각도가 커지는 쪽)으로 굴린다
      ball.setLinvel(
        inward
          ? {
              x: -Math.sin(phi) * speed - Math.cos(phi) * inward,
              y: 0,
              z: Math.cos(phi) * speed - Math.sin(phi) * inward,
            }
          : { x: -Math.sin(phi) * speed, y: 0, z: Math.cos(phi) * speed },
        true
      );
      ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
      wheel.setAngvel({ x: 0, y: omega, z: 0 }, true);
    };

    let pending = null; // 직전 판의 당첨자 칸을 덮을 차례
    for (let round = 0; round < winnerCount; round++) {
      if (pending) {
        for (const p of pending) {
          add(RAPIER.ColliderDesc.convexHull(lidPoints(p, P, V)));
          lidded.add(p);
        }
        pending = null;
      }
      launch(round);
      const startFrame = frames;
      record();
      let calm = 0;
      let settled = null;
      const startStep = step;
      while (step - startStep < V.maxRoundSeconds * HZ) {
        world.step();
        step++;
        const t = ball.translation();
        const v = ball.linvel();
        const w = wheel.angvel().y;
        // 공이 그릇 밖으로 튀어 나가면 트랙으로 되돌린다 (안전장치, 모든 판에 같은 규칙)
        const r = Math.sqrt(t.x * t.x + t.z * t.z);
        if (r > V.wallR + 0.3 || t.y < -2 || t.y > 3) {
          ball.setTranslation(
            { x: (t.x / (r || 1)) * 3.8, y: 0.1, z: (t.z / (r || 1)) * 3.8 },
            true
          );
          ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
        // 휠과 함께 움직이며(상대 속도가 거의 0) 칸 안에 있으면 멈춘 것
        const rx = v.x - w * t.z;
        const rz = v.z + w * t.x;
        const rel = Math.sqrt(rx * rx + v.y * v.y + rz * rz);
        const inPocket =
          r > V.pocketIn && r < V.pocketOut && t.y < V.rimY - 0.02;
        calm = inPocket && rel < V.settleSpeed ? calm + 1 : 0;
        if (step % SAMPLE === 0) record();
        if (calm >= V.settleSeconds * HZ) {
          const local =
            (((Math.atan2(t.z, t.x) + trackAngle()) % TAU) + TAU) % TAU;
          const p = Math.min(P - 1, Math.floor(local / (TAU / P)));
          settled = { p, frame: frames };
          break;
        }
      }
      if (!settled || lidded.has(settled.p))
        throw new Error('제한 시간 안에 공이 칸에 멈추지 않았어요');
      const who = owner[settled.p];
      order.push(who);
      rounds.push({
        start: startFrame,
        settle: settled.frame,
        pocket: settled.p,
        winner: who,
      });
      // 잠깐 멈춘 모습을 보여준 뒤 다음 판
      for (let k = 0; k < V.holdSeconds * HZ; k++) {
        world.step();
        step++;
        if (step % SAMPLE === 0) record();
      }
      pending = owner.map((o, p) => (o === who ? p : -1)).filter((p) => p >= 0);
    }

    const recording = {
      v: 1,
      kind: 'roulette',
      version,
      n,
      winnerCount,
      fps: HZ / SAMPLE,
      frames,
      layout: {
        P,
        owner,
        ...Object.fromEntries(
          [
            'ballR',
            'trackOut',
            'trackOutY',
            'trackIn',
            'trackInY',
            'wallR',
            'wallTop',
            'deflectorR',
            'deflectors',
            'rimOut',
            'rimIn',
            'rimOutY',
            'rimY',
            'pocketIn',
            'pocketOut',
            'floorInY',
            'floorOutY',
            'fretH',
            'coneTopR',
            'coneTopY',
            'turretTop',
          ].map((k) => [k, V[k]])
        ),
      },
      rounds,
      ball: ballRec,
      wheel: wheelRec,
      order,
    };
    return {
      raw: JSON.stringify(recording),
      order,
      frames,
      seconds: step / HZ,
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
  MAX_PLAYERS,
  MAX_WINNERS,
  pocketCount,
  engineId,
  versionOf,
};
