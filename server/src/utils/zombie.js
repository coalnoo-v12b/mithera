// 좀비 탈출: 참가자들이 좀비 떼를 피해 큰길을 달려 생존 바리게이트 안 생존선을 먼저 넘은 순서대로 당첨된다.
// 물리 엔진 대신 정해진 규칙으로 움직이는 사람·좀비·경찰 시뮬레이션을 서버에서 끝까지 돌리고, 그 기록을 화면이 재생한다.
// seed 는 참가자가 서는 자리, 달리기 빠르기, 출발 반응 시간, 자동차·장애물 자리, 좀비의 빠르기와 기습 타이밍,
// 경찰의 사격 타이밍·명중 여부, 통로 앞 몸싸움 추첨, 같은 순간 들어왔을 때의 순서에만 쓰인다.
// 모든 참가자에게 같은 규칙과 같은 분포가 적용된다. 같은 seed + 같은 버전이면 항상 같은 기록이 나와야 하므로
// Math.random, 시간, sin/cos 를 쓰지 않는다.
//
// 규칙 (zombie-v1)
// - 참가자들은 바리게이트에서 멀리 떨어진 큰길에 흩어져 서 있다가 출발 신호에 맞춰(반응 시간은 제각각) 달린다.
//   길 한가운데에는 좀비 무리가 흩어져 길을 막고 있어서 그 사이를 뚫고 가야 하고, 뒤에서는 좀비 떼가 쫓아오며,
//   맨 앞 사람이 양옆 골목에 다가가면 골목에서 좀비가 튀어나온다. 달리는 사람은 가까운 좀비를 비켜 가지만
//   앞으로는 꼭 나아가고, 좀비는 가까이 가면 확 덮친다.
// - 길에는 엎어진 택시·자동차(돌아가야 하는 벽)와 쇼핑카트·고깔·쓰레기봉투(처음 부딪히면 넘어질 수 있음)가 있다.
// - 좀비에게 붙잡히면 1.3~2초 버틴다. 그사이 바리게이트 위 경찰이 그 좀비를 맞히면(파란 물감탄) 좀비는 어지러워
//   주저앉고 참가자는 풀려나, 잠깐 좀비를 밀치며 바리게이트로 전력 질주한다 (구출). 못 맞히면 물리고, 1~2초 뒤
//   좀비가 되어(탈락) 다른 참가자를 쫓아가 물어서 감염시킨다.
// - 물리면 살아 있는 사람이 당첨 정원보다 적어지거나 물린 사람이 참가자의 25%를 넘게 될 때는, 붙잡힌 사람을
//   경찰이 반드시 구한다. 그래서 정원은 언제나 다 찬다.
// - 바리게이트에는 좁은 통로가 3개 있다. 셔터가 내려가 있다가, 살아 있는 사람의 3/4이 통로 앞에 모이면(늦어도
//   가장 느린 사람이 막힘 없이 왔을 시간의 1.4배가 지나면) 올라간다. 경찰은 통로 앞 무리 전체에서 똑같은 확률로 다음 사람을 불러 들여보낸다
//   (먼저 와서 앞에 서 있었다고 더 잘 불리지 않는다. 무리가 클수록 한꺼번에 여럿을 부른다). 불린 사람은 무리를
//   헤치고 통로로 가고, 무리는 길을 비켜 준다. 사람을 붙잡은 좀비가 통로 바로 앞에 있으면 그 통로는 잠깐 새로
//   부르지 않는다.
// - 바리게이트 안쪽 금색 생존선을 넘은 순서대로 당첨이고, 한 사람은 한 번만 센다. 같은 스텝(1/20초)이면 seed 로
//   정한 순서. 생존선을 넘은 사람은 다시 잡히지 않는다. 좀비는 경찰이 지키는 바리게이트 바로 앞까지는 못 온다.
// - 땅 위의 사람·좀비는 서로, 그리고 자동차·장애물·바리게이트와 몸이 (어깨가 살짝 닿는 것 말고는) 겹치지 않는다.
const crypto = require('crypto');

const ALGO = 'midura-zombie-v1';
const MAX_PEOPLE = 500;
const MAX_WINNERS = 200;

// 규칙 값은 버전으로 고정한다. 이미 추첨에 쓴 버전은 절대 바꾸지 않는다 (옛 결과를 다시 돌려 검증할 수 있어야 하므로).
const VERSIONS = {
  'zombie-v1': {
    half: 11, // 차도 폭의 절반 (m)
    startZ: 8, // 참가자 대열 앞줄 (뒤로 갈수록 z 가 작다)
    runway: 50, // 대열 앞줄에서 바리게이트까지
    startHalf: 13.5, // 참가자가 서는 폭의 절반 (인도까지)
    spacing: 0.9, // 처음 서 있는 간격
    gates: [-4.2, 0, 4.2], // 바리게이트 통로 가운데
    gateHalf: 0.85, // 통로 폭의 절반
    lineIn: 1.2, // 바리게이트 앞면에서 이만큼 안쪽이 생존선
    openShare: 0.75, // 살아 있는 사람 가운데 이만큼이 통로 앞에 모이면 셔터가 처음 올라간다
    openLate: 1.4, // 그래도 가장 느린 사람이 막힘 없이 왔을 시간의 이만큼이 지나면 올라간다
    radius: 0.36, // 사람·좀비 몸 반지름
    downRadius: 0.55, // 넘어진 사람
    run: [3.3, 4.5], // 달리기 빠르기 (m/s)
    react: [0, 1.4], // 출발 반응 시간
    press: 1.6, // 통로 앞 무리 속에서 밀고 들어가는 빠르기
    room: 0.16, // 무리 속에서 남겨 두는 틈
    shove: 0.16, // 통로로 헤치고 가는 사람이 무리 속 사람과 어깨를 맞대고 파고드는 만큼
    yieldR: 1.3, // 헤치고 오는 사람이 이만큼 가까우면 무리 속 사람이 옆으로 비켜 준다
    crowdR: 5, // 통로 앞에서 이만큼 안이면 무리 속
    pick: 18, // 통로 앞 무리가 퍼질 수 있는 거리 (이 안에서 무리 맨 뒤 사람에게 닿으면 무리에 낀다)
    slots: 8, // 통로마다 한꺼번에 들어가고 있을 수 있는 사람 (가장 많을 때)
    slotPer: 10, // 통로 앞 무리가 이만큼 늘 때마다 경찰이 한 명씩 더 들여보낸다
    barge: 4.0, // 뽑힌 사람이 무리를 헤치고 통로로 가는 빠르기
    pickWait: 12, // 이 시간 안에 통로에 못 닿으면 놓치고 다시 뽑는다
    passSpeed: 3.2, // 통로를 지나가는 빠르기
    rethink: 2, // 이 간격마다 다른 통로가 더 빠른지 다시 생각한다
    // 좀비
    horde: [0.12, 12, 60], // 뒤쪽 좀비 떼 수: 참가자 수 × 비율 (최소, 최대)
    hordeZ: [-14, -8], // 좀비 떼가 서 있는 자리 (참가자 대열 뒤, 맨 앞줄이 뒤의 값)
    wall: [0.12, 12, 60], // 길 한가운데를 막고 있는 좀비 무리 수: 비율 (최소, 최대)
    wallZ: [0.28, 0.72], // 그 무리가 흩어져 있는 구간 (대열 앞줄에서 바리게이트까지 중 비율)
    wallGap: 1.3, // 그 무리끼리 떨어져 서 있는 거리
    dodge: 3.5, // 달리는 사람이 이만큼 가까운 좀비는 비켜 간다
    dodgeW: 1.8, // 비켜 가는 힘 (가려는 쪽 대비)
    dodgeFwd: 0.55, // 비켜 가는 동안에도 가려는 쪽으로 나아가는 몫
    zSpeed: [2.2, 3.0], // 좀비 빠르기
    ambush: [0.02, 3, 8], // 골목 하나에서 나오는 좀비 수: 비율 (최소, 최대)
    ambushAhead: 4, // 맨 앞 사람이 골목 이만큼 앞까지 오면 기습한다
    ambushDelay: [0, 1.2], // 그때부터 튀어나오기까지
    ambushSpeed: [2.5, 3.2],
    sense: 11, // 좀비가 사람을 알아채는 거리
    maxChasers: 3, // 한 사람을 한꺼번에 쫓는 좀비는 많아야 이만큼
    biteShare: 0.25, // 물려서 탈락하는 사람은 많아야 참가자의 이만큼 (그 뒤로는 경찰이 반드시 구한다)
    grabR: 0.8, // 이만큼 붙으면 붙잡는다
    lunge: [1.5, 1.4], // 쫓던 사람이 이만큼 가까우면 이만큼 빨라져 덮친다
    struggle: [1.3, 2.0], // 붙잡혀 버티는 시간
    turn: [1, 2], // 물려서 좀비가 되기까지
    turnedSpeed: [1.9, 2.5], // 좀비가 된 참가자의 빠르기
    immune: 3.5, // 구출된 뒤 다시 붙잡히지 않는 시간 (그동안 좀비를 밀치며 전력 질주)
    escape: 1.2, // 구출된 뒤 전력 질주 빠르기 (평소 대비)
    dizzy: [3, 5], // 경찰에게 맞은 좀비가 주저앉아 있는 시간
    zombieLine: -2.4, // 좀비는 바리게이트 앞 이만큼까지만 온다
    shutterR: 3, // 사람을 붙잡은 좀비가 통로 앞 이만큼 안에 있으면 통로를 잠깐 막는다
    // 경찰 (바리게이트 위)
    copFire: [0.55, 1.0], // 다시 쏘기까지
    copSpeed: 38, // 물감탄 빠르기
    copRange: 75,
    hitGrab: 0.85, // 사람을 붙잡은 좀비를 맞힐 확률
    hitOther: 0.65,
    // 넘어짐 (쇼핑카트·고깔·쓰레기봉투)
    trip: [0.55, 0.35, 0.45], // 장애물 종류별로 부딪혔을 때 넘어질 확률
    tripTime: [0.9, 1.5],
    cheer: 2.5, // 생존한 뒤 환호하다 들어가기까지
  },
};
const LATEST = 'zombie-v1';
const engineId = (version) => `midura-agents ${version} dt=50ms`;
const versionOf = (engine) => {
  const m = /zombie-v\d+/.exec(engine || '');
  return m && VERSIONS[m[0]] ? m[0] : LATEST;
};

const HZ = 20;
const DT = 1 / HZ;
const SAMPLE = 2; // 2스텝마다 1프레임 기록 (10fps, 화면에서 보간)
const MAX_TICKS = HZ * 240;
const TAIL_TICKS = HZ * 2.5;
const ITERS = 6; // 몸 겹침을 푸는 반복 횟수

// 참가자 상태 (기록의 events 에 숫자로 남는다)
const ST = {
  READY: 0, // 출발 전
  RUN: 1, // 바리게이트로 달리는 중
  WAIT: 2, // 통로 앞 무리 속에서 밀치는 중
  GRABBED: 3, // 좀비에게 붙잡혀 버티는 중
  TRIP: 4, // 장애물에 걸려 넘어져 있음
  PASS: 5, // 통로로 들어가는 중 (몸싸움 끝에 뽑힘)
  SAFE: 6, // 생존선을 넘어 환호하는 중
  GONE: 7, // 안쪽으로 들어가 화면에서 사라짐
  TURNING: 8, // 물려서 좀비가 되는 중
  ZOMBIE: 9, // 좀비가 되어 쫓는 중
  ZGRAB: 10, // 좀비가 된 뒤 다른 사람을 붙잡는 중
  ZDIZZY: 11, // 좀비가 된 뒤 경찰에게 맞아 주저앉음
};
// 처음부터 좀비인 무리(참가자가 아님)의 상태
const ZS = {
  HIDDEN: 0, // 골목 안에 숨어 있음 (아직 안 나옴)
  SHAMBLE: 1, // 어슬렁거리며 바리게이트 쪽으로
  CHASE: 2, // 사람을 쫓는 중
  GRAB: 3, // 사람을 붙잡음
  DIZZY: 4, // 경찰에게 맞아 주저앉음
};
// 장애물 종류: 0 쇼핑카트, 1 고깔, 2 쓰레기봉투
const HAZ_R = [0.55, 0.28, 0.4];

const cm = (v) => Math.round(v * 100);

// seed 에서 난수열을 만든다: HMAC 으로 상태를 정하고 sfc32 로 뽑는다
function makeRng(seed, version) {
  const d = crypto
    .createHmac('sha256', seed)
    .update('zombie:' + version)
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

const between = (rng, [lo, hi]) => lo + (hi - lo) * rng();

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 방향을 정해진 각도만큼 돌린다 (sin/cos 대신 고정 값)
const TURNS = [
  [0.8660254037844386, 0.5], // 30도
  [0.5, 0.8660254037844386], // 60도
  [0, 1], // 90도
];

async function simulate({ seed, n, winnerCount, version = LATEST }) {
  const P = VERSIONS[version];
  if (!P) throw new Error('알 수 없는 좀비 탈출 버전이에요');
  if (!Number.isInteger(n) || n < 1 || n > MAX_PEOPLE)
    throw new Error(`좀비 탈출은 1~${MAX_PEOPLE}명까지 참여할 수 있어요`);
  if (
    !Number.isInteger(winnerCount) ||
    winnerCount < 1 ||
    winnerCount > Math.min(n, MAX_WINNERS)
  )
    throw new Error('당첨 인원이 올바르지 않아요');

  const rng = makeRng(seed, version);
  const W = winnerCount;
  const half = P.half;
  const R = P.radius;

  // ---- 배치 ----
  const cols = Math.floor((2 * P.startHalf - 1) / P.spacing) + 1;
  const rows = Math.ceil(n / cols);
  const depth = (rows - 1) * P.spacing;
  const front = P.startZ + depth; // 대열 맨 앞줄
  const ZB = Math.round((front + P.runway) * 10) / 10; // 바리게이트 앞면
  const lineZ = ZB + P.lineIn;
  const gates = P.gates;
  const NG = gates.length;

  // 같은 스텝에 들어오면 이 순서로 줄 세운다 (시작 전에 seed 로 정함)
  const rank = new Int32Array(n);
  shuffle(
    Array.from({ length: n }, (_, i) => i),
    rng
  ).forEach((i, k) => {
    rank[i] = k;
  });

  // 참가자 자리: 큰길에 줄을 맞춰 흩어져 서고, 누가 어디 설지는 seed 로 섞는다
  const spots = [];
  for (let k = 0; k < n; k++) {
    const col = k % cols;
    const row = Math.floor(k / cols);
    spots.push([
      -P.startHalf + 0.5 + col * P.spacing + (rng() - 0.5) * 0.2,
      front - row * P.spacing + (rng() - 0.5) * 0.2,
    ]);
  }
  shuffle(spots, rng);

  // 자동차 (돌아가야 하는 벽): 대열과 바리게이트 사이 길 위, 가운데·양옆 차선에 seed 로
  const cars = [];
  {
    const lanes = shuffle([-7.5, -2.5, 2.5, 7.5], rng);
    const count = 4;
    for (let k = 0; k < count; k++) {
      const z =
        front + 6 + ((k + 0.5) / count) * (P.runway - 14) + (rng() - 0.5) * 3;
      // 0: 엎어진 택시(길이 방향), 1: 옆으로 선 승용차
      const kind = k === 0 ? 0 : rng() < 0.5 ? 0 : 1;
      cars.push({
        x: lanes[k] + (rng() - 0.5) * 1.5,
        z,
        len: kind === 0 ? 4.2 : 3.9,
        wid: 1.9,
        along: kind === 0 ? 1 : 0, // 1: 길 방향(z)으로 길쭉, 0: 가로(x)로 길쭉
        kind,
      });
    }
  }
  // 장애물 (넘어질 수 있음): 쇼핑카트·고깔·쓰레기봉투를 길 곳곳에
  const hazards = [];
  {
    const count = 14 + Math.min(12, Math.floor(n / 25));
    let tries = 0;
    while (hazards.length < count && tries < 400) {
      tries++;
      const kind = Math.floor(rng() * 3);
      const x = (rng() * 2 - 1) * (half - 1);
      const z = front + 2.5 + rng() * (P.runway - 8);
      // 자동차·다른 장애물과 너무 붙지 않게
      const clash =
        cars.some(
          (c) =>
            Math.abs(x - c.x) < (c.along ? c.wid : c.len) / 2 + 1.6 &&
            Math.abs(z - c.z) < (c.along ? c.len : c.wid) / 2 + 1.6
        ) || hazards.some((h) => (h.x - x) ** 2 + (h.z - z) ** 2 < 2.2 ** 2);
      if (clash) continue;
      hazards.push({ x, z, kind });
    }
  }
  // 골목 (양옆): 기습 좀비가 나오는 곳
  const alleys = [];
  for (const back of [10, 24, 40])
    alleys.push([-half - 2.5, ZB - back], [half + 2.5, ZB - back]);
  // 경찰: 바리게이트 위 (왼쪽 버스 지붕 둘, 통로 사이 발판, 오른쪽 끝)
  const cops = [
    [-9.4, 2.9, ZB + 0.3],
    [-7.2, 2.9, ZB + 0.3],
    [-2.1, 1.6, ZB + 0.9],
    [2.1, 1.6, ZB + 0.9],
    [7.0, 1.6, ZB + 0.9],
    [9.6, 1.6, ZB + 0.9],
  ];

  // ---- 움직이지 않는 몸: 자동차, 장애물, 바리게이트 ----
  const statics = []; // [x, z, r, 장애물 번호(자동차·바리게이트는 -1)]
  for (const c of cars) {
    const L = c.len / 2 - c.wid / 2;
    const r = c.wid / 2;
    const steps = Math.ceil((2 * L) / 0.5);
    for (let s = 0; s <= steps; s++) {
      const d = -L + (2 * L * s) / steps;
      statics.push(c.along ? [c.x, c.z + d, r, -1] : [c.x + d, c.z, r, -1]);
    }
  }
  hazards.forEach((h, hk) => statics.push([h.x, h.z, HAZ_R[h.kind], hk]));
  // 바리게이트: 통로를 뺀 나머지를 촘촘한 원으로 막는다 (앞면 ZB 에 맞춰 뒤로 물린 원)
  const fenceR = 0.35;
  for (let x = -half - 3; x <= half + 3 + 1e-9; x += 0.4) {
    if (gates.some((g) => Math.abs(x - g) < P.gateHalf + fenceR - 0.05))
      continue;
    statics.push([x, ZB + fenceR, fenceR, -1]);
  }
  // 정적 몸 격자 (빠르게 찾기)
  const sgrid = new Map();
  const skey = (cx, cz) => (cx + 2048) * 4096 + (cz + 2048);
  statics.forEach((s, k) => {
    const cx = Math.floor(s[0] / 2);
    const cz = Math.floor(s[1] / 2);
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++) {
        const kk = skey(cx + a, cz + b);
        const list = sgrid.get(kk);
        if (list) list.push(k);
        else sgrid.set(kk, [k]);
      }
  });
  const staticsNear = (px, pz, fn) => {
    const list = sgrid.get(skey(Math.floor(px / 2), Math.floor(pz / 2)));
    if (list) for (const k of list) fn(statics[k], k);
  };

  // ---- 참가자 ----
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  const st = new Int8Array(n);
  const vRun = new Float64Array(n);
  const reactAt = new Int32Array(n);
  const gate = new Int8Array(n); // 가려는 통로
  const until = new Int32Array(n); // 지금 상태가 끝나는 스텝
  const immune = new Int32Array(n); // 이 스텝까지 다시 붙잡히지 않음
  const tripped = Array.from({ length: n }, () => new Set()); // 이미 걸려 본 장애물
  const side = new Int8Array(n); // 장애물을 비켜 갈 때 먼저 볼 쪽
  const slide = new Array(n); // 넘어질 때 앞으로 미끄러지는 몫
  const passAt = new Int32Array(n); // 통로로 뽑힌 스텝
  const cheer = new Array(n); // 생존 뒤 환호할 자리
  const zSpeedR = new Float64Array(n); // 좀비가 된 뒤 빠르기
  for (let i = 0; i < n; i++) {
    x[i] = spots[i][0];
    z[i] = spots[i][1];
    vRun[i] = between(rng, P.run);
    reactAt[i] = Math.round(between(rng, P.react) * HZ);
    side[i] = rng() < 0.5 ? -1 : 1;
    zSpeedR[i] = between(rng, P.turnedSpeed);
  }
  const nearestGate = (px) => {
    let best = 0;
    for (let g = 1; g < NG; g++)
      if (Math.abs(px - gates[g]) < Math.abs(px - gates[best])) best = g;
    return best;
  };
  for (let i = 0; i < n; i++) gate[i] = nearestGate(x[i]);

  // ---- 처음부터 좀비인 무리 ----
  const backN = Math.min(
    P.horde[2],
    Math.max(P.horde[1], Math.round(n * P.horde[0]))
  );
  // 길 한가운데 무리: 자동차·장애물·서로와 떨어진 자리에 흩어져 선다
  const wallSpots = [];
  {
    const want = Math.min(
      P.wall[2],
      Math.max(P.wall[1], Math.round(n * P.wall[0]))
    );
    const z0 = front + P.runway * P.wallZ[0];
    const z1 = front + P.runway * P.wallZ[1];
    let tries = 0;
    while (wallSpots.length < want && tries < want * 60) {
      tries++;
      const wx = (rng() * 2 - 1) * (half - 0.6);
      const wz = z0 + rng() * (z1 - z0);
      let ok = !wallSpots.some(
        ([ax, az]) => (ax - wx) ** 2 + (az - wz) ** 2 < P.wallGap ** 2
      );
      if (ok)
        staticsNear(wx, wz, ([sx, sz, sr]) => {
          if ((sx - wx) ** 2 + (sz - wz) ** 2 < (sr + R + 0.3) ** 2) ok = false;
        });
      if (ok) wallSpots.push([wx, wz]);
    }
  }
  const hordeN = backN + wallSpots.length;
  const perAlley = Math.min(
    P.ambush[2],
    Math.max(P.ambush[1], Math.round(n * P.ambush[0]))
  );
  const zn = hordeN + perAlley * alleys.length;
  const zx = new Float64Array(zn);
  const zz = new Float64Array(zn);
  const zst = new Int8Array(zn);
  const zv = new Float64Array(zn);
  const zUntil = new Int32Array(zn);
  const zSpawn = new Int32Array(zn).fill(-1); // 골목 좀비가 나오는 스텝 (기습이 정해지기 전에는 -1)
  const zAlley = new Int8Array(zn).fill(-1); // 골목 좀비가 숨어 있는 골목
  {
    // 좀비 떼는 참가자 대열 뒤에 듬성듬성 서 있다 (겹치지 않게 격자에서 조금씩 흔든다)
    const gap = 1.1;
    const zcols = Math.floor((2 * half - 1) / gap) + 1;
    for (let j = 0; j < backN; j++) {
      zx[j] = -half + 0.5 + (j % zcols) * gap + (rng() - 0.5) * 0.3;
      zz[j] =
        P.hordeZ[1] - Math.floor(j / zcols) * gap * 1.4 + (rng() - 0.5) * 0.3;
      zv[j] = between(rng, P.zSpeed);
      zst[j] = ZS.SHAMBLE;
    }
    // 길 한가운데 무리: 참가자들은 이 무리를 뚫고 바리게이트로 가야 한다
    wallSpots.forEach(([wx, wz], k) => {
      const j = backN + k;
      zx[j] = wx;
      zz[j] = wz;
      zv[j] = between(rng, P.zSpeed);
      zst[j] = ZS.SHAMBLE;
    });
  }
  {
    let j = hordeN;
    alleys.forEach(([ax, az], a) => {
      for (let k = 0; k < perAlley; k++, j++) {
        // 골목 안쪽에 줄지어 숨어 있다가 한 명씩 튀어나온다
        zx[j] = ax + Math.sign(ax) * (k % 3) * 0.9;
        zz[j] = az + (Math.floor(k / 3) - 1) * 0.9;
        zv[j] = between(rng, P.ambushSpeed);
        zst[j] = ZS.HIDDEN;
        zAlley[j] = a;
      }
    });
  }
  const alleyAt = new Int32Array(alleys.length).fill(-1); // 골목마다 기습이 시작되는 스텝
  const alleyFirst = new Int32Array(alleys.length).fill(-1); // 골목마다 첫 좀비 번호
  for (let j = zn - 1; j >= hordeN; j--) alleyFirst[zAlley[j]] = j;
  const zTarget = new Int32Array(zn).fill(-1);
  const zGrab = new Int32Array(zn).fill(-1); // 붙잡은 참가자
  // 좀비가 된 참가자의 목표·붙잡은 사람
  const rTarget = new Int32Array(n).fill(-1);
  const rGrab = new Int32Array(n).fill(-1);
  // 붙잡힌 참가자를 붙잡은 쪽: 0 이상은 무리 좀비 j, 음수는 좀비가 된 참가자 -(i+1)
  const grabbedBy = new Int32Array(n).fill(-2147483648);
  const NONE = -2147483648;

  const events = [];
  const zevents = [];
  const setSt = (tick, i, s) => {
    if (st[i] === s) return;
    st[i] = s;
    events.push([tick, i, s]);
  };
  const setZ = (tick, j, s) => {
    if (zst[j] === s) return;
    zst[j] = s;
    zevents.push([tick, j, s]);
  };

  const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;
  const isZombieR = (s) =>
    s === ST.TURNING || s === ST.ZOMBIE || s === ST.ZGRAB || s === ST.ZDIZZY;
  let aliveCount = n;
  const maxBites = Math.floor(n * P.biteShare); // 물려서 탈락하는 사람은 많아야 이만큼
  let doomed = 0; // 물릴 수도 있는 붙잡힘 수 (정원 보장 계산용)
  const grabFate = new Int8Array(n); // 1: 물릴 수 있음, 2: 경찰이 반드시 구함

  // ---- 땅 위 몸 겹침 ----
  const onGroundR = (i) => st[i] !== ST.GONE;
  const radiusR = (i) =>
    st[i] === ST.TRIP || st[i] === ST.ZDIZZY ? P.downRadius : R;
  const massR = (i) => {
    const s = st[i];
    if (s === ST.SAFE) return 50;
    if (s === ST.GRABBED || s === ST.ZGRAB) return 8;
    if (s === ST.PASS) return 6;
    if (s === ST.TRIP || s === ST.ZDIZZY || s === ST.TURNING) return 4;
    // 구출된 직후에는 좀비를 밀치며 빠져나간다
    if (s === ST.RUN && tick < immune[i]) return 3;
    return 1;
  };
  const onGroundZ = (j) => zst[j] !== ZS.HIDDEN;
  const radiusZ = (j) => (zst[j] === ZS.DIZZY ? P.downRadius : R);
  const massZ = (j) => (zst[j] === ZS.GRAB ? 8 : zst[j] === ZS.DIZZY ? 4 : 1.2);
  // 몸 목록: 0..n-1 은 참가자, n..n+zn-1 은 좀비 무리
  const N = n + zn;
  const bx = (k) => (k < n ? x[k] : zx[k - n]);
  const bz = (k) => (k < n ? z[k] : zz[k - n]);
  const onGround = (k) => (k < n ? onGroundR(k) : onGroundZ(k - n));
  const radius = (k) => (k < n ? radiusR(k) : radiusZ(k - n));
  const mass = (k) => (k < n ? massR(k) : massZ(k - n));
  const move = (k, dx, dz) => {
    if (k < n) {
      x[k] += dx;
      z[k] += dz;
    } else {
      zx[k - n] += dx;
      zz[k - n] += dz;
    }
  };
  // 1m 칸 격자 (칸마다 그 안의 몸 번호를 이어 붙여 둔다). 바깥으로 나간 몸은 가장자리 칸에 넣는다
  const GX0 = -half - 8;
  const GZ0 = P.hordeZ[0] - 12;
  const GW = Math.ceil(2 * (half + 8)) + 1;
  const GH = Math.ceil(ZB + 12 - GZ0) + 1;
  const cellStart = new Int32Array(GW * GH + 1);
  const cellFill = new Int32Array(GW * GH);
  const cellItems = new Int32Array(N);
  const cellOfBody = new Int32Array(N);
  const cx0 = (px) => Math.min(GW - 1, Math.max(0, Math.floor(px - GX0)));
  const cz0 = (pz) => Math.min(GH - 1, Math.max(0, Math.floor(pz - GZ0)));
  const buildGrid = () => {
    cellStart.fill(0);
    for (let k = 0; k < N; k++) {
      if (!onGround(k)) {
        cellOfBody[k] = -1;
        continue;
      }
      const c = cx0(bx(k)) + cz0(bz(k)) * GW;
      cellOfBody[k] = c;
      cellStart[c + 1]++;
    }
    for (let c = 0; c < GW * GH; c++) cellStart[c + 1] += cellStart[c];
    cellFill.set(cellStart.subarray(0, GW * GH));
    for (let k = 0; k < N; k++) {
      const c = cellOfBody[k];
      if (c >= 0) cellItems[cellFill[c]++] = k;
    }
  };
  const eachInCells = (px, pz, reach, fn) => {
    const cx = cx0(px);
    const cz = cz0(pz);
    const a0 = Math.max(0, cx - reach);
    const a1 = Math.min(GW - 1, cx + reach);
    const b0 = Math.max(0, cz - reach);
    const b1 = Math.min(GH - 1, cz + reach);
    for (let b = b0; b <= b1; b++)
      for (let a = a0; a <= a1; a++) {
        const c = a + b * GW;
        for (let q = cellStart[c]; q < cellStart[c + 1]; q++) fn(cellItems[q]);
      }
  };
  const neighbors = (px, pz, fn) => eachInCells(px, pz, 1, fn);
  // 바리게이트 안쪽(통로를 지나는 사람·생존자)인지
  const inside = (k) =>
    k < n && (st[k] === ST.PASS || st[k] === ST.SAFE) && z[k] > ZB - 0.8;
  const clamp = (k) => {
    let px = bx(k);
    let pz = bz(k);
    const lim = half + 4;
    if (px < -lim) px = -lim;
    if (px > lim) px = lim;
    if (k < n && (st[k] === ST.PASS || st[k] === ST.SAFE)) {
      // 통로 안: 통로 양옆 기둥을 넘지 않는다
      if (pz > ZB - 0.6 && pz < ZB + 1) {
        const g = gates[gate[k]];
        const m = P.gateHalf - R;
        if (px < g - m) px = g - m;
        if (px > g + m) px = g + m;
      }
    } else if (pz > ZB - 0.4 - R) pz = ZB - 0.4 - R;
    // 좀비는 경찰이 지키는 바리게이트 바로 앞까지는 못 온다 (넘어가 있으면 조금씩 물러난다)
    if ((k >= n || isZombieR(st[k])) && pz > P.zombieLine + ZB)
      pz = Math.max(P.zombieLine + ZB, pz - 0.06);
    move(k, px - bx(k), pz - bz(k));
  };
  const resolve = () => {
    for (let iter = 0; iter < ITERS; iter++) {
      buildGrid();
      for (let k = 0; k < N; k++) {
        if (!onGround(k)) continue;
        const rk = radius(k);
        const mk = mass(k);
        const ink = inside(k);
        let px = 0;
        let pz = 0;
        neighbors(bx(k), bz(k), (j) => {
          if (j === k || !onGround(j) || inside(j) !== ink) return;
          // 붙잡은 좀비와 붙잡힌 사람은 붙어 있다
          if (k < n && j >= n && zGrab[j - n] === k) return;
          if (j < n && k >= n && zGrab[k - n] === j) return;
          if (k < n && j < n && (rGrab[j] === k || rGrab[k] === j)) return;
          const r = rk + radius(j);
          const dx = bx(k) - bx(j);
          const dz = bz(k) - bz(j);
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) return;
          const share = mass(j) / (mk + mass(j));
          if (d2 < 1e-12) {
            px += (k < j ? 0.05 : -0.05) * share;
            return;
          }
          const d = Math.sqrt(d2);
          px += (dx / d) * (r - d) * share;
          pz += (dz / d) * (r - d) * share;
        });
        staticsNear(bx(k), bz(k), ([sx, sz, sr]) => {
          if (ink && sz > ZB) return; // 안쪽 사람은 바리게이트 원과 안 부딪힌다 (통로 기둥은 clamp 로)
          const r = rk + sr;
          const dx = bx(k) - sx || (k % 2 ? 1e-3 : -1e-3);
          const dz = bz(k) - sz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) return;
          const d = Math.sqrt(d2);
          px += (dx / d) * (r - d);
          pz += (dz / d) * (r - d);
        });
        move(k, px, pz);
        clamp(k);
      }
    }
  };

  // ---- 걸음: 빈 곳으로만, 앞에 정적인 몸이 있으면 비켜 간다 ----
  // barging: 통로로 뽑혀 헤치고 가는 사람. 먼저 불린 헤치는 사람에게는 그대로 막히고(나중에 불린 사람은
  // 신경 쓰지 않아서 서로 막혀 멈추는 일이 없다), 무리 속 사람과는 어깨가 조금 닿는 데까지만 파고든다
  const blockedBody = (k, nx, nz, barging = false) => {
    let hit = false;
    // 무리 속 사람은 앞사람과 조금 틈을 둔다 (헤치고 지나가는 사람이 밀어낼 자리가 생기게)
    const rk = radius(k) + (k < n && st[k] === ST.WAIT ? P.room / 2 : 0);
    const ink = inside(k);
    neighbors(nx, nz, (j) => {
      if (hit || j === k || !onGround(j) || inside(j) !== ink) return;
      // 구출된 직후의 사람은 좀비에게 막히지 않는다 (밀치고 빠져나간다)
      if (
        k < n &&
        tick < immune[k] &&
        (j >= n ||
          st[j] === ST.ZOMBIE ||
          st[j] === ST.ZGRAB ||
          st[j] === ST.TURNING)
      )
        return;
      const passer = j < n && st[j] === ST.PASS;
      if (
        barging &&
        passer &&
        (passAt[j] > passAt[k] || (passAt[j] === passAt[k] && j > k))
      )
        return;
      const r = rk + radius(j) - (barging && !passer ? P.shove : 0);
      const dn = (nx - bx(j)) ** 2 + (nz - bz(j)) ** 2;
      if (dn >= r * r) return;
      if (dn < (bx(k) - bx(j)) ** 2 + (bz(k) - bz(j)) ** 2) hit = true;
    });
    return hit;
  };
  // 앞으로 look 만큼 가는 길에 자동차·장애물·바리게이트가 있는지.
  // 참가자는 처음 보는 쇼핑카트·고깔은 못 보고 달려들고(부딪히면 넘어질 수 있다), 한 번 부딪힌 것은 돌아간다
  const blockedStatic = (k, px, pz, ux, uz, look, rk) => {
    let hit = false;
    for (const t of [0.5, 1]) {
      const qx = px + ux * look * t;
      const qz = pz + uz * look * t;
      staticsNear(qx, qz, ([sx, sz, sr, hk]) => {
        if (hit || (k < n && hk >= 0 && !tripped[k].has(hk))) return;
        const r = rk + sr + 0.12;
        if ((qx - sx) ** 2 + (qz - sz) ** 2 < r * r) hit = true;
      });
      if (hit) return true;
    }
    return false;
  };
  // avoid: 자동차·장애물을 미리 비켜 간다, bodies: 사람에게 막히면 멈춘다 ('pass' 면 헤치고 가는 사람끼리만)
  const stepTo = (k, tx, tz, speed, sideHint, avoid = true, bodies = true) => {
    const px = bx(k);
    const pz = bz(k);
    const dx = tx - px;
    const dz = tz - pz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1e-9) return;
    const s = Math.min(d, speed * DT);
    const ux = dx / d;
    const uz = dz / d;
    const rk = radius(k);
    let open = null; // 자동차·장애물에는 안 막히는 첫 방향
    const tryDir = (vx, vz, f) => {
      if (avoid && blockedStatic(k, px, pz, vx, vz, Math.min(2.2, d), rk))
        return false;
      if (!open) open = [vx, vz];
      if (
        bodies &&
        blockedBody(k, px + vx * s * f, pz + vz * s * f, bodies === 'pass')
      )
        return false;
      move(k, vx * s * f, vz * s * f);
      return true;
    };
    if (tryDir(ux, uz, 1)) return;
    for (const [c, sn] of TURNS) {
      for (const sg of [sideHint, -sideHint]) {
        const vx = ux * c - sg * uz * sn;
        const vz = sg * ux * sn + uz * c;
        if (tryDir(vx, vz, 0.8)) return;
      }
    }
    // 달리던 사람이 사방으로 막히면 좀비·사람을 밀치며 천천히 비집고 나간다 (갇혀서 못 움직이는 일이 없게)
    if (open && k < n && st[k] === ST.RUN)
      move(k, open[0] * s * 0.4, open[1] * s * 0.4);
  };

  // ---- 경찰 ----
  const copNext = cops.map(() => Math.round((1 + rng() * 1) * HZ));
  const shots = []; // [쏜 스텝, 경찰, 닿은 스텝, 종류(0 무리 좀비/1 좀비 된 참가자), 대상, 명중, x, z(cm)]
  const flying = [];
  const aimedZ = new Uint8Array(zn);
  const aimedR = new Uint8Array(n);
  const rescues = []; // [스텝, 참가자]
  const bites = []; // [스텝, 참가자]

  // 붙잡힌 사람 풀어 주기 (구출)
  const release = (tick, i) => {
    const by = grabbedBy[i];
    if (by === NONE) return;
    if (by >= 0) {
      zGrab[by] = -1;
    } else {
      const zi = -by - 1;
      rGrab[zi] = -1;
    }
    grabbedBy[i] = NONE;
    if (grabFate[i] === 1) doomed--;
    grabFate[i] = 0;
    immune[i] = tick + Math.round(P.immune * HZ);
    rescues.push([tick, i]);
    setSt(tick, i, ST.RUN);
  };
  // 붙잡기: 정원을 지킬 수 있으면 물릴 수 있는 붙잡힘, 아니면 경찰이 반드시 구하는 붙잡힘
  const grab = (tick, i, by) => {
    grabbedBy[i] = by;
    const len = Math.round(between(rng, P.struggle) * HZ);
    until[i] = tick + len;
    if (
      aliveCount - doomed - 1 >= W &&
      n - aliveCount + doomed + 1 <= maxBites
    ) {
      grabFate[i] = 1;
      doomed++;
    } else {
      grabFate[i] = 2;
      // 가장 가까운 경찰이 곧바로 쏜다 (버티는 시간 안에 닿게)
      const [gx, gz] = by >= 0 ? [zx[by], zz[by]] : [x[-by - 1], z[-by - 1]];
      let best = 0;
      for (let c = 1; c < cops.length; c++)
        if (
          dist2(cops[c][0], cops[c][2], gx, gz) <
          dist2(cops[best][0], cops[best][2], gx, gz)
        )
          best = c;
      const d = Math.sqrt(dist2(cops[best][0], cops[best][2], gx, gz));
      const hit =
        tick +
        Math.min(len - 1, Math.max(3, Math.round((d / P.copSpeed + 0.1) * HZ)));
      flying.push(shots.length);
      shots.push([
        tick,
        best,
        hit,
        by >= 0 ? 0 : 1,
        by >= 0 ? by : -by - 1,
        0,
        0,
        0,
        1,
      ]);
    }
    setSt(tick, i, ST.GRABBED);
  };

  // ---- 통로 몸싸움 ----
  const gateRes = Array.from({ length: NG }, () => new Array(P.slots).fill(-1));
  const gateOpen = new Uint8Array(NG); // 처음에는 셔터가 내려가 있다
  const gatesLog = [];
  // 셔터는 살아 있는 사람 절반이 통로 앞 무리에 모이거나, 가장 느린 사람도 왔을 시간이 되면 사이렌과 함께 올라간다
  const openBy = Math.round(
    ((P.runway + depth) / P.run[0] + P.react[1]) * P.openLate * HZ
  );
  let opensAt = -1;
  const unpick = (i) => {
    for (const r of gateRes)
      for (let q = 0; q < r.length; q++) if (r[q] === i) r[q] = -1;
  };

  const pos = Array.from({ length: n }, () => []);
  const last = Array.from({ length: n }, () => [0, 0]);
  const zpos = Array.from({ length: zn }, () => []);
  const zlast = Array.from({ length: zn }, () => [0, 0]);
  let frames = 0;
  const record = () => {
    for (let i = 0; i < n; i++) {
      const c = [cm(x[i]), cm(z[i])];
      pos[i].push(c[0] - last[i][0], c[1] - last[i][1]);
      last[i] = c;
    }
    for (let j = 0; j < zn; j++) {
      const c = [cm(zx[j]), cm(zz[j])];
      zpos[j].push(c[0] - zlast[j][0], c[1] - zlast[j][1]);
      zlast[j] = c;
    }
    frames++;
  };

  const order = [];
  const arrivals = [];
  let tick = 0;
  let stopAt = -1;
  record();

  // 좀비의 목표: 알아챌 수 있는 가장 가까운 사람 (붙잡히지 않았고, 안 넘어졌거나 넘어져도 됨, 구출 직후는 제외)
  const targetable = (i) =>
    (st[i] === ST.RUN || st[i] === ST.WAIT || st[i] === ST.TRIP) &&
    tick >= immune[i];
  // 한 사람을 쫓는 좀비 수 (너무 많이 몰리면 다른 사람을 찾는다)
  const chasers = new Int32Array(n);
  const findTarget = (px, pz, prev) => {
    if (prev >= 0) chasers[prev]--;
    let best = -1;
    let bd = P.sense * P.sense;
    eachInCells(px, pz, Math.ceil(P.sense), (k) => {
      if (k >= n || !targetable(k) || chasers[k] >= P.maxChasers) return;
      const d = dist2(px, pz, x[k], z[k]);
      if (
        d < bd - 1e-9 ||
        (Math.abs(d - bd) <= 1e-9 && best >= 0 && rank[k] < rank[best])
      ) {
        bd = d;
        best = k;
      }
    });
    if (best >= 0) chasers[best]++;
    return best;
  };

  while (tick < MAX_TICKS) {
    tick++;
    buildGrid();
    const firing = order.length < W;
    // 아직 바리게이트 밖에 있는 사람들의 가운데 (아무도 못 알아챈 좀비는 그쪽으로 어슬렁거린다)
    let herdZ = ZB - 2;
    {
      let sum = 0;
      let cnt = 0;
      for (let i = 0; i < n; i++) {
        const s = st[i];
        if (
          s === ST.READY ||
          s === ST.RUN ||
          s === ST.TRIP ||
          s === ST.GRABBED ||
          s === ST.WAIT
        ) {
          sum += z[i];
          cnt++;
        }
      }
      if (cnt) herdZ = Math.min(ZB - 2, sum / cnt);
    }

    // 1) 골목 기습: 맨 앞 사람이 골목 가까이 오면 잠시 뒤 숨어 있던 좀비가 골목 입구(길 가장자리)로
    //    차례로 튀어나온다. 입구에 누가 서 있으면 비킬 때까지 기다린다
    alleys.forEach(([, az], a) => {
      if (alleyAt[a] >= 0) return;
      let lead = -Infinity;
      for (let i = 0; i < n; i++)
        if (!isZombieR(st[i]) && z[i] > lead) lead = z[i];
      if (lead < az - P.ambushAhead) return;
      alleyAt[a] = tick + Math.round(between(rng, P.ambushDelay) * HZ);
      for (let j = alleyFirst[a]; j < zn && zAlley[j] === a; j++)
        zSpawn[j] = alleyAt[a] + (j - alleyFirst[a]) * 3;
    });
    for (let j = hordeN; j < zn; j++) {
      if (zst[j] !== ZS.HIDDEN || zSpawn[j] < 0 || tick < zSpawn[j]) continue;
      const ex = Math.sign(zx[j]) * (half + 0.6);
      let free = true;
      neighbors(ex, zz[j], (k) => {
        if (
          free &&
          onGround(k) &&
          dist2(ex, zz[j], bx(k), bz(k)) < (2 * R + 0.1) ** 2
        )
          free = false;
      });
      if (!free) continue;
      zx[j] = ex;
      setZ(tick, j, ZS.SHAMBLE);
      buildGrid();
    }

    // 2) 좀비 무리: 사람을 알아채면 쫓고, 붙으면 붙잡는다
    for (let j = 0; j < zn; j++) {
      const s = zst[j];
      if (s === ZS.HIDDEN) continue;
      if (s === ZS.DIZZY) {
        if (tick >= zUntil[j]) setZ(tick, j, ZS.SHAMBLE);
        continue;
      }
      if (s === ZS.GRAB || tick < zUntil[j]) continue;
      if ((tick + j) % 10 === 0 || (zTarget[j] >= 0 && !targetable(zTarget[j])))
        zTarget[j] = findTarget(zx[j], zz[j], zTarget[j]);
      const t = zTarget[j];
      const k = n + j;
      if (t >= 0) {
        setZ(tick, j, ZS.CHASE);
        // 가까이 가면 확 덮친다
        const lunge =
          dist2(zx[j], zz[j], x[t], z[t]) < P.lunge[0] ** 2 ? P.lunge[1] : 1;
        stepTo(k, x[t], z[t], zv[j] * lunge, j % 2 ? 1 : -1);
        if (
          dist2(zx[j], zz[j], x[t], z[t]) < P.grabR * P.grabR &&
          targetable(t)
        ) {
          if (st[t] === ST.PASS) unpick(t);
          zGrab[j] = t;
          setZ(tick, j, ZS.GRAB);
          grab(tick, t, j);
        }
      } else {
        setZ(tick, j, ZS.SHAMBLE);
        // 아직 아무도 못 알아챘으면: 사람들보다 앞(바리게이트 쪽)에 있으면 사람들 쪽으로,
        // 사람들 곁이나 뒤에 있으면 바리게이트 쪽으로 어슬렁 (조금씩 가운데로)
        stepTo(
          k,
          zx[j] * 0.98,
          Math.min(ZB - 2, zz[j] + (zz[j] > herdZ + 4 ? -3 : 3)),
          zv[j] * 0.6,
          j % 2 ? 1 : -1
        );
      }
    }
    // 좀비가 된 참가자
    for (let i = 0; i < n; i++) {
      const s = st[i];
      if (s === ST.ZDIZZY) {
        if (tick >= until[i]) setSt(tick, i, ST.ZOMBIE);
        continue;
      }
      if (s !== ST.ZOMBIE || tick < until[i]) continue;
      if ((tick + i) % 10 === 0 || (rTarget[i] >= 0 && !targetable(rTarget[i])))
        rTarget[i] = findTarget(x[i], z[i], rTarget[i]);
      const t = rTarget[i];
      if (t >= 0) {
        const lunge =
          dist2(x[i], z[i], x[t], z[t]) < P.lunge[0] ** 2 ? P.lunge[1] : 1;
        stepTo(i, x[t], z[t], zSpeedR[i] * lunge, side[i]);
        if (
          dist2(x[i], z[i], x[t], z[t]) < P.grabR * P.grabR &&
          targetable(t)
        ) {
          if (st[t] === ST.PASS) unpick(t);
          rGrab[i] = t;
          setSt(tick, i, ST.ZGRAB);
          grab(tick, t, -(i + 1));
        }
      } else
        stepTo(
          i,
          x[i] * 0.98,
          Math.min(ZB - 2, z[i] + (z[i] > herdZ + 4 ? -3 : 3)),
          zSpeedR[i] * 0.6,
          side[i]
        );
    }

    // 3) 붙잡힘이 끝나는 순간: 구출 못 받았으면 물린다 (정원 보장 붙잡힘은 경찰 사격으로 이미 풀렸다)
    for (let i = 0; i < n; i++) {
      if (st[i] !== ST.GRABBED || tick < until[i]) continue;
      if (grabFate[i] !== 1) continue; // 반드시 구하는 붙잡힘은 사격이 닿을 때 풀린다
      const by = grabbedBy[i];
      doomed--;
      aliveCount--;
      grabFate[i] = 0;
      grabbedBy[i] = NONE;
      // 문 좀비는 잠깐 멈춰 있다가 다시 쫓는다
      if (by >= 0) {
        zGrab[by] = -1;
        zUntil[by] = tick + HZ;
        setZ(tick, by, ZS.SHAMBLE);
      } else {
        const zi = -by - 1;
        rGrab[zi] = -1;
        until[zi] = tick + HZ;
        setSt(tick, zi, ST.ZOMBIE);
      }
      bites.push([tick, i]);
      until[i] = tick + Math.round(between(rng, P.turn) * HZ);
      setSt(tick, i, ST.TURNING);
    }

    // 4) 경찰: 물감탄이 닿는 순간 맞았는지 정하고, 다시 쏜다
    for (let a = 0; a < flying.length; a++) {
      const sh = shots[flying[a]];
      if (sh[2] !== tick) continue;
      flying.splice(a--, 1);
      const [, , , kind, t, , , , sure] = sh;
      const zxp = kind === 0 ? zx[t] : x[t];
      const zzp = kind === 0 ? zz[t] : z[t];
      sh[6] = cm(zxp);
      sh[7] = cm(zzp);
      if (kind === 0) aimedZ[t] = 0;
      else aimedR[t] = 0;
      const grabbing = kind === 0 ? zst[t] === ZS.GRAB : st[t] === ST.ZGRAB;
      const valid =
        kind === 0
          ? zst[t] === ZS.CHASE || zst[t] === ZS.SHAMBLE || grabbing
          : st[t] === ST.ZOMBIE || grabbing;
      const roll = rng();
      if (!valid || (!sure && roll >= (grabbing ? P.hitGrab : P.hitOther))) {
        // 빗나감: 옆 땅에 물감이 튄다
        sh[6] += cm((rng() - 0.5) * 1.6);
        sh[7] += cm((rng() - 0.5) * 1.2);
        sh.length = 8;
        continue;
      }
      sh[5] = 1;
      sh.length = 8;
      const dz = Math.round(between(rng, P.dizzy) * HZ);
      if (kind === 0) {
        const g = zGrab[t];
        if (g >= 0) release(tick, g);
        zUntil[t] = tick + dz;
        if (zTarget[t] >= 0) chasers[zTarget[t]]--;
        zTarget[t] = -1;
        setZ(tick, t, ZS.DIZZY);
      } else {
        const g = rGrab[t];
        if (g >= 0) release(tick, g);
        until[t] = tick + dz;
        if (rTarget[t] >= 0) chasers[rTarget[t]]--;
        rTarget[t] = -1;
        setSt(tick, t, ST.ZDIZZY);
      }
    }
    if (firing) {
      cops.forEach(([cxp, , czp], c) => {
        if (tick < copNext[c]) return;
        // 목표 고르기: 사람을 붙잡은 좀비 > 통로 앞까지 온 좀비 > 바리게이트 가까운 좀비
        let best = null;
        let bestScore = Infinity;
        const consider = (kind, t, px, pz, grabbing) => {
          const d2 = dist2(cxp, czp, px, pz);
          if (d2 > P.copRange * P.copRange) return;
          if (!grabbing && pz < ZB - 18) return;
          const nearGate = gates.some(
            (g) => dist2(px, pz, g, ZB - 0.9) < (P.shutterR + 1) ** 2
          );
          const score = (grabbing ? 0 : nearGate ? 1000 : 2000) + d2;
          if (score < bestScore - 1e-9) {
            bestScore = score;
            best = [kind, t, px, pz];
          }
        };
        for (let j = 0; j < zn; j++) {
          const s = zst[j];
          if (
            aimedZ[j] ||
            !(s === ZS.CHASE || s === ZS.SHAMBLE || s === ZS.GRAB)
          )
            continue;
          consider(0, j, zx[j], zz[j], s === ZS.GRAB);
        }
        for (let i = 0; i < n; i++) {
          const s = st[i];
          if (aimedR[i] || !(s === ST.ZOMBIE || s === ST.ZGRAB)) continue;
          consider(1, i, x[i], z[i], s === ST.ZGRAB);
        }
        if (!best) {
          copNext[c] = tick + Math.round(0.3 * HZ);
          return;
        }
        copNext[c] = tick + Math.round(between(rng, P.copFire) * HZ);
        const [kind, t, px, pz] = best;
        if (kind === 0) aimedZ[t] = 1;
        else aimedR[t] = 1;
        const d = Math.sqrt(dist2(cxp, czp, px, pz));
        flying.push(shots.length);
        shots.push([
          tick,
          c,
          tick + Math.max(3, Math.round((d / P.copSpeed + 0.1) * HZ)),
          kind,
          t,
          0,
          0,
          0,
          0,
        ]);
      });
    }

    // 5) 통로 셔터: 사람이 모이면 처음 올라가고, 그 뒤로는 사람을 붙잡은 좀비가 통로 바로 앞에 있으면
    //    경찰이 그 통로로 새로 부르지 않는다 (이미 불려서 헤치고 오는 사람은 그대로 들어온다)
    if (opensAt < 0) {
      let waiting = 0;
      let living = 0;
      for (let i = 0; i < n; i++) {
        if (st[i] === ST.WAIT) waiting++;
        if (!isZombieR(st[i])) living++;
      }
      if (waiting >= Math.ceil(living * P.openShare) || tick >= openBy)
        opensAt = tick;
    }
    for (let g = 0; g < NG && opensAt >= 0; g++) {
      let threat = false;
      const ex = gates[g];
      const ez = ZB - 0.9;
      const r2 = P.shutterR * P.shutterR;
      for (let j = 0; j < zn && !threat; j++)
        if (zst[j] === ZS.GRAB && dist2(zx[j], zz[j], ex, ez) < r2)
          threat = true;
      for (let i = 0; i < n && !threat; i++)
        if (st[i] === ST.ZGRAB && dist2(x[i], z[i], ex, ez) < r2) threat = true;
      const open = threat ? 0 : 1;
      if (open === gateOpen[g]) continue;
      gateOpen[g] = open;
      gatesLog.push([tick, g, open]);
    }

    const crowd = new Int32Array(NG);
    for (let i = 0; i < n; i++) if (st[i] === ST.WAIT) crowd[gate[i]]++;
    // 6) 통로 몸싸움: 열린 통로마다 다음에 들어갈 사람을 그 통로 앞 무리 전체에서 똑같은 확률로 뽑는다
    //    (먼저 와서 앞에 서 있었다고 더 잘 뽑히지 않는다)
    for (let g = 0; g < NG; g++) {
      const res = gateRes[g];
      for (let q = 0; q < P.slots; q++) {
        const r0 = res[q];
        if (
          r0 >= 0 &&
          (st[r0] !== ST.PASS || tick - passAt[r0] > P.pickWait * HZ)
        ) {
          if (st[r0] === ST.PASS && z[r0] < ZB - 0.6) setSt(tick, r0, ST.WAIT);
          res[q] = -1;
        }
      }
      if (!gateOpen[g]) continue;
      const open = Math.min(P.slots, 1 + Math.floor(crowd[g] / P.slotPer));
      for (let q = 0; q < open; q++) {
        if (res[q] >= 0) continue;
        const pool = [];
        for (let i = 0; i < n; i++)
          if (st[i] === ST.WAIT && gate[i] === g) pool.push(i);
        if (!pool.length) break;
        const i = pool[Math.floor(rng() * pool.length)];
        res[q] = i;
        passAt[i] = tick;
        setSt(tick, i, ST.PASS);
      }
    }

    // 7) 참가자 움직임 (번호 순서로)
    const every = Math.round(P.rethink * HZ);
    for (let i = 0; i < n; i++) {
      const s = st[i];
      if (s === ST.READY) {
        if (tick >= reactAt[i]) setSt(tick, i, ST.RUN);
        continue;
      }
      if (s === ST.RUN || s === ST.WAIT) {
        // 가끔 옆 통로가 확실히 더 빠른지 다시 생각한다 (무리가 적고 가까운 쪽)
        if ((tick + i * 7) % every === 0) {
          const cost = (g) =>
            Math.sqrt(dist2(x[i], z[i], gates[g], ZB - 0.9)) / vRun[i] +
            crowd[g] * 0.3;
          let best = gate[i];
          let bc = cost(best) - 1.5;
          for (let g = 0; g < NG; g++) {
            if (g === gate[i] || Math.abs(gates[g] - gates[gate[i]]) > 4.3)
              continue;
            const c = cost(g);
            if (c < bc) {
              bc = c;
              best = g;
            }
          }
          gate[i] = best;
        }
        const ex = gates[gate[i]];
        const ez = ZB - 0.9;
        const d = Math.sqrt(dist2(x[i], z[i], ex, ez));
        // 통로 앞 무리: 통로 가까이 왔거나, 같은 통로 무리의 맨 뒤 사람에게 닿으면 무리에 낀다
        let join = s === ST.WAIT ? d < P.pick + 3 : d < P.crowdR;
        if (!join && d < P.pick)
          neighbors(x[i], z[i], (k) => {
            if (
              !join &&
              k < n &&
              k !== i &&
              st[k] === ST.WAIT &&
              dist2(x[i], z[i], x[k], z[k]) < (2 * R + 0.3) ** 2
            )
              join = true;
          });
        // 무리 속에서 통로로 뽑힌 사람이 뒤에서 헤치고 오면 그 길에서 옆으로 비켜 준다
        let yieldTo = -1;
        if (join) {
          let bd = P.yieldR * P.yieldR;
          neighbors(x[i], z[i], (k) => {
            if (k >= n || st[k] !== ST.PASS || z[k] > z[i] + 0.2) return;
            const dd = dist2(x[i], z[i], x[k], z[k]);
            if (dd < bd) {
              bd = dd;
              yieldTo = k;
            }
          });
        }
        if (yieldTo >= 0) {
          const k = yieldTo;
          const gx = gates[gate[k]] - x[k];
          const gz = ZB - 0.6 - z[k];
          const gl = Math.sqrt(gx * gx + gz * gz) || 1;
          // 헤치고 오는 사람의 진행 방향 기준으로 내가 어느 쪽에 있는지
          const cross = (gx / gl) * (z[i] - z[k]) - (gz / gl) * (x[i] - x[k]);
          const sg = cross >= 0 ? 1 : -1;
          stepTo(
            i,
            x[i] - sg * (gz / gl),
            z[i] + sg * (gx / gl),
            P.press,
            sg,
            false
          );
        } else if (join) stepTo(i, ex, ez, P.press, side[i], d > P.crowdR);
        else if (tick < immune[i])
          // 구출된 직후: 좀비를 신경 쓰지 않고 바리게이트로 전력 질주
          stepTo(i, ex, ez, vRun[i] * P.escape, side[i], d > P.crowdR);
        else {
          // 달리는 중: 가까운 좀비(특히 앞을 막는 좀비)를 피해 비켜 가며 바리게이트로
          const gx = (ex - x[i]) / (d || 1);
          const gz = (ez - z[i]) / (d || 1);
          let ax = 0;
          let az = 0;
          eachInCells(x[i], z[i], Math.ceil(P.dodge), (k) => {
            if (k === i) return;
            const zombie =
              k >= n
                ? zst[k - n] !== ZS.DIZZY && zst[k - n] !== ZS.HIDDEN
                : st[k] === ST.ZOMBIE ||
                  st[k] === ST.ZGRAB ||
                  st[k] === ST.TURNING;
            if (!zombie) return;
            const dx = x[i] - bx(k);
            const dz = z[i] - bz(k);
            const dd = Math.sqrt(dx * dx + dz * dz);
            if (dd > P.dodge || dd < 1e-6) return;
            const ahead = -(dx * gx + dz * gz) / dd; // 가려는 쪽에 있으면 양수
            const w = (1 - dd / P.dodge) * (0.4 + Math.max(0, ahead));
            ax += (dx / dd) * w;
            az += (dz / dd) * w;
          });
          let vx = gx + ax * P.dodgeW;
          let vz = gz + az * P.dodgeW;
          // 비켜 가더라도 앞으로는 꼭 나아간다 (좀비 무리 앞에서 멈춰 서지 않게)
          if (vx * gx + vz * gz < P.dodgeFwd) {
            const back = vx * gx + vz * gz - P.dodgeFwd;
            vx -= gx * back;
            vz -= gz * back;
          }
          const vl = Math.sqrt(vx * vx + vz * vz) || 1;
          stepTo(
            i,
            x[i] + (vx / vl) * 3,
            z[i] + (vz / vl) * 3,
            vRun[i],
            side[i],
            d > P.crowdR
          );
        }
        setSt(tick, i, join ? ST.WAIT : ST.RUN);
        // 장애물에 부딪히면 넘어질 수 있다 (장애물마다 한 번)
        if (!join)
          hazards.forEach((h, hk) => {
            if (st[i] !== ST.RUN || tripped[i].has(hk)) return;
            const r = HAZ_R[h.kind] + R + 0.08;
            if (dist2(x[i], z[i], h.x, h.z) >= r * r) return;
            tripped[i].add(hk);
            if (rng() < P.trip[h.kind]) {
              const dz = z[i] < h.z ? 1 : -1;
              slide[i] = { dx: (x[i] - h.x) * 0.3, dz: dz * 0.5 };
              until[i] = tick + Math.round(between(rng, P.tripTime) * HZ);
              setSt(tick, i, ST.TRIP);
            }
          });
        continue;
      }
      if (s === ST.TRIP) {
        if (slide[i]) {
          move(i, slide[i].dx * 0.25, slide[i].dz * 0.25);
          slide[i].dx *= 0.75;
          slide[i].dz *= 0.75;
        }
        if (tick >= until[i]) {
          slide[i] = null;
          setSt(tick, i, ST.RUN);
        }
        continue;
      }
      if (s === ST.PASS) {
        // 무리를 헤치고 통로 앞으로, 그다음 통로를 지나 생존선 너머로
        const g = gates[gate[i]];
        if (z[i] < ZB - 0.7)
          stepTo(i, g, ZB - 0.6, P.barge, side[i], true, 'pass');
        else {
          const dx = g - x[i];
          // 통로 안에서는 앞사람을 밀지 않고 한 줄로 지나간다
          const sp = P.passSpeed * DT;
          const mx = Math.max(-sp, Math.min(sp, dx));
          if (!blockedBody(i, x[i] + mx, z[i] + sp)) move(i, mx, sp);
          else if (!blockedBody(i, x[i], z[i] + sp)) move(i, 0, sp);
        }
        continue;
      }
      if (s === ST.SAFE) {
        const c = cheer[i];
        const t = (tick - c.at) / HZ;
        if (t > P.cheer) {
          setSt(tick, i, ST.GONE);
          continue;
        }
        const dx = c.x - x[i];
        const dz = c.z - z[i];
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > 0.02) {
          const sp = Math.min(d, 2.4 * DT);
          move(i, (dx / d) * sp, (dz / d) * sp);
        }
        continue;
      }
      if (s === ST.TURNING) {
        if (tick >= until[i]) setSt(tick, i, ST.ZOMBIE);
      }
    }

    // 8) 몸이 겹치지 않게 밀어내기
    resolve();

    // 9) 생존선을 넘은 사람: 같은 스텝이면 seed 로 정한 순서대로
    const now = [];
    for (let i = 0; i < n; i++)
      if (st[i] === ST.PASS && z[i] >= lineZ) now.push(i);
    now.sort((a, b) => rank[a] - rank[b]);
    for (const i of now) {
      unpick(i);
      const g = gate[i];
      // 통로 뒤 환호 자리: 통로마다 3열로 돌아가며 (겹치지 않게)
      const slot = arrivals.filter(([k]) => gate[k] === g).length % 12;
      cheer[i] = {
        at: tick,
        x: gates[g] + ((slot % 3) - 1) * 0.95,
        z: ZB + 3 + Math.floor(slot / 3) * 0.95,
      };
      setSt(tick, i, ST.SAFE);
      arrivals.push([i, tick]);
      order.push(i);
    }

    if (tick % SAMPLE === 0) record();
    if (stopAt < 0 && order.length >= W) stopAt = tick + TAIL_TICKS;
    if (stopAt >= 0 && tick >= stopAt) break;
  }
  if (order.length < W)
    throw new Error('제한 시간 안에 추첨이 끝나지 않았어요');
  if (tick % SAMPLE !== 0) record();

  const recording = {
    v: 1,
    kind: 'zombie',
    version,
    n,
    winnerCount: W,
    hz: HZ,
    fps: HZ / SAMPLE,
    frames,
    ticks: tick,
    layout: {
      half,
      ZB,
      lineZ,
      gates,
      gateHalf: P.gateHalf,
      opensAt,
      front,
      cars: cars.map((c) => [
        Math.round(c.x * 100) / 100,
        Math.round(c.z * 100) / 100,
        c.len,
        c.wid,
        c.along,
        c.kind,
      ]),
      hazards: hazards.map((h) => [
        Math.round(h.x * 100) / 100,
        Math.round(h.z * 100) / 100,
        h.kind,
      ]),
      alleys,
      cops,
    },
    events,
    pos,
    zn,
    horde: hordeN, // 좀비 0..horde-1 은 처음부터 길에 있고, 나머지는 골목에 숨어 있다가 나온다
    zevents,
    zpos,
    shots: shots.filter((s) => s[2] <= tick).map((s) => s.slice(0, 8)),
    rescues,
    bites,
    gates: gatesLog,
    arrivals,
    order,
  };
  return {
    raw: JSON.stringify(recording),
    order,
    frames,
    seconds: tick / HZ,
    engine: engineId(version),
  };
}

module.exports = {
  simulate,
  ALGO,
  LATEST,
  MAX_PEOPLE,
  MAX_WINNERS,
  ST,
  ZS,
  engineId,
  versionOf,
};
