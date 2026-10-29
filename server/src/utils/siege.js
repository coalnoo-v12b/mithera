// 성벽 탈환전: 병사들이 사다리로 성벽에 오르거나, 공성추가 부순 성문으로 들어간다. 먼저 성에 들어온 순서대로 당첨이다.
// 물리 엔진 대신 정해진 규칙으로 움직이는 병사 시뮬레이션을 서버에서 끝까지 돌리고, 그 기록을 화면이 재생한다.
// seed 는 병사가 서는 자리, 달리기·오르기 속도, 출발 반응 시간, 물대포·물총의 발사 타이밍·목표·명중 여부,
// 같은 순간 들어왔을 때의 순서에만 쓰인다. 모든 병사에게 같은 규칙과 같은 분포가 적용된다.
// 같은 seed + 같은 버전이면 항상 같은 기록이 나와야 하므로 Math.random, 시간, sin/cos 를 쓰지 않는다.
//
// 규칙 (siege-v1)
// - 사다리는 성문 양쪽에 3개씩 모두 6개이고, 하나에 두 줄로 나란히 오를 수 있다 (오르는 줄 12개).
//   병사들은 사다리 발치로 몰려가 줄 없이 뒤엉켜 밀치고, 한 줄의 아래쪽이 비면 그 순간 그 줄 발치에 손이 닿는
//   병사 중 아직 사다리를 못 타 본 사람이, 그다음은 가장 가까운 사람이 오른다. 자기 사다리가 너무 붐비면 옆 사다리로
//   옮겨 가기도 한다. 사다리에서 떨어지면 벽에 부딪혀 뒤로 굴러떨어진다.
// - 사다리 위에서는 줄마다 한 줄로 오른다. 앞사람과 최소 간격을 지키고, 추월하지 않는다.
// - 땅 위 병사는 서로 몸이 겹치지 않는다. 빈 곳으로만 걸음을 옮기고, 막히면 옆으로 비키거나 기다린다.
// - 공성추는 성문 앞까지 굴러가 일정한 간격으로 문을 친다. 성벽 꼭대기에서 올라서기 시작한 병사가 정원의 60%
//   (최소 1명)가 되는 순간의 타격에 문이 부서진다. 올라서는 데 0.7초가 걸리므로 그 순간 성에 들어온 인원은 늘 정원보다
//   적다. 그래서 문은 언제나 당첨 정원이 다 차기 전에 열린다.
// - 문이 열리면 성문 가까운 병사는 사다리와 성문 중 빨리 들어갈 수 있는 쪽을 고르고, 공성추 양옆으로 몰려 들어간다.
//   성 안뜰의 물대포 2문이 성문으로 몰려오는 병사를 쏘아 뒤로 밀어낸다 (성문 가까이 있다고 유리하지 않게).
// - 도착: 성벽 쪽은 사다리에서 성벽 위 통로(도착 구역)에 발을 디딘 순간, 성문 쪽은 문 안쪽 도착선을 넘은 순간.
//   두 길의 도착을 시각 순서대로 합쳐서 순위를 정하고, 한 사람은 한 번만 센다.
// - 방어: 양쪽 탑의 물대포 4문이 사다리 쪽 무리와 사다리를 오르는 병사에게 물을 쏜다. 땅에서 맞으면 넘어지거나
//   밀려나고, 사다리에서 맞으면 떨어진다. 성벽 위 수비군은 물총으로 옆 사다리를 오르는 병사를 떨어뜨리고, 사다리마다
//   꼭대기의 수비군이 막 올라온 병사에게 물바가지를 부어 떨어뜨린다. 탑의 물대포는 가운데 성문·공성추 길에는 쏘지 않는다.
//   맞으면 잠시 뒤 일어나 다시 사다리나 성문으로 간다 (탈락 없음).
//   한 병사는 최대 2번까지만 맞고, 50초가 지나거나 당첨 정원이 다 차면 더 쏘지 않는다.
// - 들어온 병사는 다시 맞지 않는다. 확정된 당첨은 취소되지 않는다.
// - 같은 스텝(1/20초)에 함께 들어오면 시작 전에 seed 로 정한 순서를 따른다.
const crypto = require('crypto');

const ALGO = 'midura-siege-v1';
const MAX_PEOPLE = 500;
const MAX_WINNERS = 200;

// 규칙 값은 버전으로 고정한다. 이미 추첨에 쓴 버전은 절대 바꾸지 않는다 (옛 결과를 다시 돌려 검증할 수 있어야 하므로).
const VERSIONS = {
  'siege-v1': {
    H: 6, // 성벽 높이 (m)
    walk: 3.2, // 성벽 위 통로 폭 (= 성벽 두께)
    perSide: 3, // 성문 한쪽의 사다리 수
    innerLadder: 6, // 성문 바로 옆 사다리의 위치
    ladderGap: 5, // 사다리 사이 간격
    laneHalf: 0.45, // 사다리 하나의 두 줄이 가운데에서 떨어진 거리
    lean: 1.5, // 사다리 아래쪽이 벽에서 떨어진 거리
    topZ: 0.3, // 사다리 꼭대기에서 발이 멈추는 곳 (벽 앞)
    topDrop: 0.6, // 사다리 꼭대기 발판이 성벽 위보다 낮은 정도
    arriveZ: 1.0, // 벽 앞면에서 이만큼 안쪽이 성벽 도착 구역의 시작
    footBack: 0.45, // 사다리 발치(오르기 시작하는 자리)가 사다리 아래 끝보다 앞쪽인 거리
    reach: 0.75, // 발치에서 이만큼 안에 있어야 사다리를 잡는다
    climbGap: 1.0, // 사다리 위 앞사람과의 최소 간격 (사다리 길이 기준)
    run: [3.6, 4.8], // 달리기 속도 (m/s)
    press: 1.5, // 무리 속에서 밀고 들어가는 속도
    crowdR: 4, // 발치에서 이만큼 안이면 무리 속
    climb: [0.95, 1.35], // 오르는 속도
    react: [0, 0.8], // 출발 반응 시간 (s)
    step: 0.7, // 사다리 꼭대기에서 성벽 위로 올라서는 시간
    radius: 0.38, // 병사 몸 반지름 (겹침 판정)
    downRadius: 0.6, // 넘어져 누운 병사가 차지하는 반지름
    rethink: 2, // 이 간격(s)마다 옆 사다리가 더 빠른지 다시 생각한다
    switchGain: 1.5, // 옆으로 옮기려면 이만큼(s) 이상 빨라야 한다
    waitPer: 0.75, // 발치까지 나보다 가까운 한 사람당 기다리는 시간 (어림)
    // 성문과 공성추
    gateHalf: 2.6, // 성문 너비의 절반
    laneX: 1.75, // 공성추 양옆으로 지나가는 자리
    gateArrive: 1.2, // 벽 앞면에서 이만큼 안쪽이 성문 도착선
    gatePer: 0.15, // 성문으로 가는 앞사람 한 명당 기다리는 시간 (어림)
    gatePenalty: 3, // 안뜰 물대포에 밀려날 것까지 친 성문 쪽 시간 (어림)
    ramHalf: 0.95, // 공성추(밀어 주는 공병 포함)의 너비 절반
    ramLength: 5.4, // 공성추 앞끝부터 공병까지 길이
    ramStart: 9.5, // 처음 공성추 앞끝이 벽에서 떨어진 거리
    ramSpeed: 2.4,
    ramStrike: 1.0, // 문을 치는 간격 (s)
    ramMinStrikes: 2, // 문이 부서지려면 최소 이만큼 쳐야 한다
    gateShare: 0.6, // 성벽 꼭대기에 오른 인원이 정원의 이 비율이 되면 문이 부서진다
    // 물대포 (양쪽 탑에 2문씩)
    cannonFire: [1.1, 1.8], // 다시 쏘기까지 걸리는 시간
    cannonFirst: 1.8,
    cannonSpeed: 18,
    cannonClimber: 0.45, // 사다리 위 병사를 노릴 확률
    hitCannonClimber: 0.7, // 사다리 위에서 물대포에 맞아 떨어질 확률
    cannonMinX: 3.5, // 성문 가운데에서 이만큼 떨어진 병사만 노리고 맞힌다
    splash: 2.0, // 물이 퍼지는 반지름
    hitCenter: 0.8, // 노린 병사가 맞을 확률
    hitSplash: 0.4, // 주변 병사가 맞을 확률
    knockFall: 0.6, // 맞은 병사가 넘어질 확률 (아니면 밀려나기만 한다)
    push: [1.0, 1.8], // 밀려나는 거리
    slide: 0.45, // 밀려나는 시간
    stagger: 0.5, // 밀려나기만 했을 때 다시 움직이기까지
    down: [1.4, 2.3], // 넘어져 있는 시간
    // 성 안뜰 물대포 (문이 부서진 뒤 성문으로 몰려오는 병사를 뒤로 밀어낸다)
    gateFire: [0.6, 1.1],
    gateCannonSpeed: 22,
    gateSplash: 1.6,
    gateHitCenter: 0.8,
    gateHitSplash: 0.55,
    gatePush: [1.6, 2.6],
    // 사다리 꼭대기 수비군의 물바가지
    guardCool: [0.3, 0.7], // 한 번 붓고 다시 붓기까지
    guardTime: 0.3, // 붓는 데 걸리는 시간 (그동안 꼭대기에서 버틴다)
    guardHit: 0.6, // 맞아 떨어질 확률
    // 물총 (성벽 위 수비군)
    gunFire: [0.7, 1.2],
    gunFirst: 2.5,
    gunSpeed: 16,
    hitGun: 0.55, // 사다리 위 병사가 맞아 떨어질 확률
    downFall: [2.0, 3.0], // 사다리에서 떨어진 뒤 쓰러져 있는 시간
    maxHits: 2, // 한 병사가 맞을 수 있는 최대 횟수
    guard: 2, // 일어난 뒤 다시 맞지 않는 시간
    ceaseFire: 50, // 이 시간이 지나면 더 쏘지 않는다 (경기가 끝나지 않는 일 방지)
    gravity: 9.8,
  },
};
const LATEST = 'siege-v1';
const engineId = (version) => `midura-agents ${version} dt=50ms`;
const versionOf = (engine) => {
  const m = /siege-v\d+/.exec(engine || '');
  return m && VERSIONS[m[0]] ? m[0] : LATEST;
};

const HZ = 20;
const DT = 1 / HZ;
const SAMPLE = 2; // 2스텝마다 1프레임 기록 (10fps, 화면에서 보간)
const MAX_TICKS = HZ * 300;
const TAIL_TICKS = HZ * 2.5;
const ITERS = 5; // 몸 겹침을 푸는 반복 횟수

// 병사 상태 (기록의 events 에 숫자로 남는다)
const ST = {
  READY: 0, // 출발 전
  RUN: 1, // 사다리나 성문 쪽으로 달리는 중
  QUEUE: 2, // 사다리 발치 무리 속에서 밀치는 중
  CLIMB: 3, // 사다리를 오르는 중
  STEP: 4, // 성벽 위로 올라서는 중
  ARRIVED: 5, // 성에 들어와서 안쪽으로 이동 중
  FALL: 6, // 사다리에서 떨어지는 중
  DOWN: 7, // 물에 맞아 넘어져 있음
  GONE: 8, // 성 안으로 들어가 화면에서 사라짐
  GATE: 9, // 성문으로 몰려 들어가는 중
  PUSH: 10, // 물에 맞아 밀려남 (넘어지지는 않음)
};
// 들어온 길
const ROUTE = { WALL: 0, GATE: 1 };

const cm = (v) => Math.round(v * 100);

// seed 에서 난수열을 만든다: HMAC 으로 상태를 정하고 sfc32 로 뽑는다
function makeRng(seed, version) {
  const d = crypto
    .createHmac('sha256', seed)
    .update('siege:' + version)
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

// 인원에 맞춘 성벽·성문·사다리·탑 배치. 기록에 그대로 담아서 화면이 같은 모양으로 그린다.
function layoutFor(n, P) {
  const ladders = [];
  for (let k = P.perSide - 1; k >= 0; k--)
    ladders.push(-(P.innerLadder + k * P.ladderGap));
  for (let k = 0; k < P.perSide; k++)
    ladders.push(P.innerLadder + k * P.ladderGap);
  // 오르는 줄: 사다리마다 두 줄 (사다리 k 의 줄은 2k, 2k+1)
  const lanes = [];
  ladders.forEach((lx) => lanes.push(lx - P.laneHalf, lx + P.laneHalf));
  const outer = P.innerLadder + (P.perSide - 1) * P.ladderGap;
  const FW = 2 * outer + P.ladderGap;
  const WZ = Math.round((18 + Math.sqrt(n) * 0.5) * 10) / 10;
  const towerX = FW / 2 + 3.5;
  // 물대포: 탑마다 2문
  const cannons = [];
  for (const s of [-1, 1])
    for (const dz of [-0.8, 0.8])
      cannons.push([s * towerX, 10.8, WZ + 1.2 + dz]);
  // 수비군: 성문과 첫 사다리 사이, 사다리 사이마다, 맨 바깥 사다리 바깥에 한 명씩
  const defenders = [];
  for (const s of [-1, 1]) {
    defenders.push([s * (P.gateHalf + P.innerLadder) * 0.5, P.H, WZ + 0.9]);
    for (let k = 0; k < P.perSide; k++)
      defenders.push([
        s * (P.innerLadder + (k + 0.5) * P.ladderGap),
        P.H,
        WZ + 0.9,
      ]);
  }
  // 사다리 꼭대기 수비군: 사다리 바깥쪽 옆 (성벽 위에 올라선 병사가 지나는 자리를 비켜서)
  const guards = ladders.map((lx) => [
    lx + (lx < 0 ? -1.45 : 1.45),
    P.H,
    WZ + 0.6,
  ]);
  // 성 안뜰 물대포: 성문 통로 바로 안쪽 양옆 (들어온 병사가 지나는 길을 비켜서)
  const gateCannons = [-1, 1].map((sd) => [sd * 3.2, 1.3, WZ + P.walk + 4.5]);
  return {
    H: P.H,
    walk: P.walk,
    WZ,
    FW,
    lanes,
    guards,
    gateCannons,
    lean: P.lean,
    topZ: P.topZ,
    topDrop: P.topDrop,
    arriveZ: P.arriveZ,
    ladders,
    towers: [
      [-towerX, WZ + 1.2],
      [towerX, WZ + 1.2],
    ],
    cannons,
    defenders,
    gate: {
      half: P.gateHalf,
      arriveZ: WZ + P.gateArrive,
      lanes: [-P.laneX, P.laneX],
    },
  };
}

async function simulate({ seed, n, winnerCount, version = LATEST }) {
  const P = VERSIONS[version];
  if (!P) throw new Error('알 수 없는 성벽 탈환전 버전이에요');
  if (!Number.isInteger(n) || n < 1 || n > MAX_PEOPLE)
    throw new Error(`성벽 탈환전은 1~${MAX_PEOPLE}명까지 참여할 수 있어요`);
  if (
    !Number.isInteger(winnerCount) ||
    winnerCount < 1 ||
    winnerCount > Math.min(n, MAX_WINNERS)
  )
    throw new Error('당첨 인원이 올바르지 않아요');

  const rng = makeRng(seed, version);
  const Lay = layoutFor(n, P);
  const { H, WZ, FW, lean, ladders } = Lay;
  const NL = ladders.length;
  const baseZ = WZ - lean;
  const footZ = baseZ - P.footBack;
  const topY = H - P.topDrop;
  const topZ = WZ - P.topZ;
  const ladLen = Math.sqrt(topY * topY + (topZ - baseZ) * (topZ - baseZ));
  const arriveZ = WZ + P.arriveZ;
  const gateZ = Lay.gate.arriveZ;
  const innerL = NL / 2 - 1; // 성문 왼쪽 바로 옆 사다리 번호
  const innerR = NL / 2;
  // 성벽 꼭대기에서 올라서기 시작한 병사가 이만큼 되면 문이 부서진다 (그 순간 들어온 인원은 많아야 gateAt - 1 명)
  const gateAt = Math.max(1, Math.floor(winnerCount * P.gateShare));
  let topped = 0;

  // 같은 스텝에 들어오면 이 순서로 줄 세운다 (시작 전에 seed 로 정함)
  const rank = new Int32Array(n);
  shuffle(
    Array.from({ length: n }, (_, i) => i),
    rng
  ).forEach((i, k) => {
    rank[i] = k;
  });

  // 대열: 성벽 폭만큼 넓게 줄을 맞춰 서고, 누가 어느 자리에 설지는 seed 로 섞는다
  const cols = Math.max(4, Math.floor(FW / 1.0));
  const spots = [];
  for (let k = 0; k < n; k++) {
    const col = k % cols;
    const row = Math.floor(k / cols);
    spots.push([
      -FW / 2 + (col + 0.5) * (FW / cols) + (rng() - 0.5) * 0.2,
      -row * 1.05 + (rng() - 0.5) * 0.2,
    ]);
  }
  shuffle(spots, rng);

  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  const st = new Int8Array(n);
  const lad = new Int32Array(n); // 맡은 사다리
  const lane = new Int32Array(n); // 오르고 있는 줄
  const tries = new Int32Array(n); // 지금까지 사다리를 잡은 횟수
  const topAt = new Int32Array(n); // 꼭대기에서 물바가지를 받고 버티는 중이면 결판나는 스텝 (아니면 0)
  const dumpOf = new Int32Array(n).fill(-1); // 그때의 물바가지 기록 번호
  const route = new Int8Array(n); // 0: 사다리, 1: 성문
  const vRun = new Float64Array(n);
  const vClimb = new Float64Array(n);
  const reactAt = new Int32Array(n);
  const climbP = new Float64Array(n); // 사다리 위 위치 (아래에서부터 m)
  const timer = new Float64Array(n); // 지금 상태가 된 뒤 흐른 시간
  const until = new Int32Array(n); // 쓰러져 있다 일어날 스텝
  const settle = new Int32Array(n); // 이 스텝까지는 밀려나는 중
  const guardUntil = new Int32Array(n);
  const hits = new Int8Array(n);
  const aimed = new Uint8Array(n); // 날아오는 물줄기의 목표인지
  const slide = new Array(n); // 밀려나는 방향과 거리
  const fall = new Array(n); // 떨어질 때의 시작·착지 위치
  const nearest = (px) => {
    let best = 0;
    for (let k = 1; k < NL; k++)
      if (Math.abs(px - ladders[k]) < Math.abs(px - ladders[best])) best = k;
    return best;
  };
  for (let i = 0; i < n; i++) {
    x[i] = spots[i][0];
    z[i] = spots[i][1];
    vRun[i] = between(rng, P.run);
    vClimb[i] = between(rng, P.climb);
    reactAt[i] = Math.round(between(rng, P.react) * HZ);
    lad[i] = nearest(x[i]);
  }
  const LANES = Lay.lanes;
  const NLANE = LANES.length;
  const climbers = Array.from({ length: NLANE }, () => []); // 줄마다, 위에 있는 사람부터
  const onLadder = (k) => climbers[2 * k].length + climbers[2 * k + 1].length;

  // 공성추
  const ram = {
    front: WZ - P.ramStart,
    stop: WZ - 0.45,
    arriveTick: -1,
    strikes: [],
    breakTick: -1,
  };
  const ramCircles = () => {
    const list = [];
    for (let d = 0.5; d <= P.ramLength; d += 0.8) list.push(ram.front - d);
    return list;
  };
  let gateOpen = false;

  const events = [];
  const setSt = (tick, i, s) => {
    if (st[i] === s) return;
    st[i] = s;
    timer[i] = 0;
    events.push([tick, i, s]);
  };

  const dist = (i, tx, tz) => {
    const dx = tx - x[i];
    const dz = tz - z[i];
    return Math.sqrt(dx * dx + dz * dz);
  };
  const pending = (j) =>
    st[j] === ST.RUN || st[j] === ST.QUEUE || st[j] === ST.GATE;
  // 사다리 k 까지 걸릴 시간 어림: 발치까지 거리 + 나보다 발치에 가까운 사람 수만큼 기다림 + 오르기
  const ladderCost = (i, k) => {
    const d = dist(i, ladders[k], footZ);
    let ahead = 0;
    for (let j = 0; j < n; j++)
      if (
        j !== i &&
        route[j] === ROUTE.WALL &&
        lad[j] === k &&
        pending(j) &&
        dist(j, ladders[k], footZ) < d
      )
        ahead++;
    return (
      d / vRun[i] +
      (ahead + onLadder(k)) * P.waitPer +
      ladLen / vClimb[i] +
      P.step
    );
  };
  const sideOf = (px) => (px < 0 ? -1 : 1);
  const gateCost = (i) => {
    let ahead = 0;
    for (let j = 0; j < n; j++)
      if (j !== i && route[j] === ROUTE.GATE && pending(j)) ahead++;
    return (
      dist(i, sideOf(x[i]) * P.laneX, gateZ) / vRun[i] +
      ahead * P.gatePer +
      P.gatePenalty
    );
  };
  // 지금 자리에서 갈 곳: 바로 옆 사다리들(가로지르지 않을 만큼 가까운 곳)과, 열렸으면 가까운 성문 중 가장 빠른 곳
  const choose = (i) => {
    let best = { gate: false, k: nearest(x[i]) };
    let bestCost = Infinity;
    for (let k = 0; k < NL; k++) {
      if (Math.abs(ladders[k] - x[i]) > P.ladderGap + 0.1) continue;
      const c = ladderCost(i, k);
      if (c < bestCost - 1e-9) {
        best = { gate: false, k };
        bestCost = c;
      }
    }
    if (gateOpen && Math.abs(x[i]) < P.innerLadder + 1) {
      const c = gateCost(i);
      if (Math.abs(x[i]) < P.laneX + 0.5 || c < bestCost - 0.5)
        best = { gate: true };
    }
    return best;
  };
  const assign = (i, r) => {
    route[i] = r.gate ? ROUTE.GATE : ROUTE.WALL;
    if (!r.gate) lad[i] = r.k;
  };

  // 무리 속 걸음: 다른 몸과 닿는 쪽으로는 들어가지 않는다. 앞이 막히면 옆으로(±60도) 비켜 보고,
  // 그래도 막히면 그 자리에서 기다린다 (밀치며 비집고 들어가는 모습, 몸은 겹치지 않음).
  const COS60 = 0.5;
  const SIN60 = 0.8660254037844386;
  const blocked = (i, nx, nz) => {
    let hit = false;
    const ri = radiusOf(i);
    neighbors(nx, nz, (j) => {
      if (hit || j === i || !onGround(j)) return;
      const r = ri + radiusOf(j);
      const dn = (nx - x[j]) ** 2 + (nz - z[j]) ** 2;
      if (dn >= r * r) return;
      if (dn < (x[i] - x[j]) ** 2 + (z[i] - z[j]) ** 2) hit = true;
    });
    return hit;
  };
  const stepTo = (i, tx, tz, speed, tick) => {
    const dx = tx - x[i];
    const dz = tz - z[i];
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1e-9) return;
    const s = Math.min(d, speed * DT);
    const ux = dx / d;
    const uz = dz / d;
    if (!blocked(i, x[i] + ux * s, z[i] + uz * s)) {
      x[i] += ux * s;
      z[i] += uz * s;
      return;
    }
    // 어느 쪽부터 비켜 볼지는 사람·스텝마다 번갈아 (무리가 한쪽으로 쏠리지 않게)
    const first = (i + tick) % 2 ? 1 : -1;
    for (const sg of [first, -first]) {
      const vx = ux * COS60 - sg * uz * SIN60;
      const vz = sg * ux * SIN60 + uz * COS60;
      const ss = s * 0.7;
      if (!blocked(i, x[i] + vx * ss, z[i] + vz * ss)) {
        x[i] += vx * ss;
        z[i] += vz * ss;
        return;
      }
    }
  };

  // 사다리 위 위치 → 좌표
  const placeOnLadder = (i) => {
    const t = climbP[i] / ladLen;
    x[i] = LANES[lane[i]];
    y[i] = topY * t;
    z[i] = baseZ + (topZ - baseZ) * t;
  };
  // 사다리 위에서 앞사람과의 간격 계산에 쓰는 위치 (올라서는 중이면 꼭대기 너머로 친다)
  const effP = (i) =>
    st[i] === ST.STEP
      ? ladLen + Math.min(1, timer[i] / P.step) * P.climbGap
      : climbP[i];

  // ---- 몸이 겹치지 않게 하기: 땅 위의 모든 몸이 서로 밀어낸다 ----
  const onGround = (i) => {
    const s = st[i];
    return (
      s === ST.READY ||
      s === ST.RUN ||
      s === ST.QUEUE ||
      s === ST.GATE ||
      s === ST.DOWN ||
      s === ST.PUSH ||
      (s === ST.ARRIVED && route[i] === ROUTE.GATE)
    );
  };
  // 넘어지는 동안(밀려나는 동안·떨어진 직후) 누운 몸이 차지하는 자리가 조금씩 넓어진다
  const radiusOf = (i) => {
    if (st[i] !== ST.DOWN) return P.radius;
    const left = settle[i] - tick;
    if (left <= 0) return P.downRadius;
    const u = 1 - left / Math.round(P.slide * HZ);
    return P.radius + (P.downRadius - P.radius) * Math.max(0, u);
  };
  // 무거울수록 덜 밀린다: 넘어진 병사 > 비틀거리는 병사 > 서 있는 병사. 성문 안으로 들어간 병사는 뒤로 밀리지 않는다.
  const mass = (i) => {
    const s = st[i];
    if (s === ST.ARRIVED) return 50;
    if (s === ST.DOWN) return 4;
    if (s === ST.PUSH) return 2;
    return 1;
  };
  const grid = new Map();
  const key = (cx, cz) => (cx + 2048) * 4096 + (cz + 2048);
  const buildGrid = () => {
    grid.clear();
    for (let i = 0; i < n; i++) {
      if (!onGround(i)) continue;
      const c = key(Math.floor(x[i]), Math.floor(z[i]));
      const list = grid.get(c);
      if (list) list.push(i);
      else grid.set(c, [i]);
    }
  };
  const neighbors = (px, pz, fn) => {
    const cx = Math.floor(px);
    const cz = Math.floor(pz);
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++) {
        const list = grid.get(key(cx + a, cz + b));
        if (list) for (const j of list) fn(j);
      }
  };
  const clampGround = (i) => {
    const lim = FW / 2 + 6;
    if (x[i] < -lim) x[i] = -lim;
    if (x[i] > lim) x[i] = lim;
    const r = P.radius;
    const inGate = gateOpen && Math.abs(x[i]) < P.gateHalf - r;
    if (inGate) {
      if (z[i] > WZ - 0.4) {
        // 성문 통로 안: 양쪽 벽을 넘지 않는다
        const g = P.gateHalf - r;
        if (x[i] < -g) x[i] = -g;
        if (x[i] > g) x[i] = g;
      }
    } else if (Math.abs(x[i]) < P.gateHalf + 1) {
      if (z[i] > WZ - 0.4 - r) z[i] = WZ - 0.4 - r;
    } else if (z[i] > baseZ - 0.3) z[i] = baseZ - 0.3;
  };
  const resolve = () => {
    const circles = ramCircles();
    for (let iter = 0; iter < ITERS; iter++) {
      buildGrid();
      for (let i = 0; i < n; i++) {
        if (!onGround(i) || st[i] === ST.ARRIVED) continue;
        const ri = radiusOf(i);
        const mi = mass(i);
        let px = 0;
        let pz = 0;
        neighbors(x[i], z[i], (j) => {
          if (j === i || !onGround(j)) return;
          const r = ri + radiusOf(j);
          const dx = x[i] - x[j];
          const dz = z[i] - z[j];
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) return;
          // 서로 반씩이 아니라 무게에 따라 나눠서 밀린다 (상대도 자기 차례에 나머지만큼 밀린다)
          const share = mass(j) / (mi + mass(j));
          if (d2 < 1e-12) {
            px += (i < j ? 0.05 : -0.05) * share;
            return;
          }
          const d = Math.sqrt(d2);
          px += (dx / d) * (r - d) * share;
          pz += (dz / d) * (r - d) * share;
        });
        // 공성추(공병 포함)는 움직이지 않는 몸
        for (const cz of circles) {
          const r = ri + P.ramHalf;
          const dx = x[i] || (i % 2 ? 1e-3 : -1e-3);
          const dz = z[i] - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          const d = Math.sqrt(d2);
          px += (dx / d) * (r - d);
          pz += (dz / d) * (r - d);
        }
        x[i] += px;
        z[i] += pz;
        clampGround(i);
      }
    }
  };

  // 물대포·물총
  const cannons = Lay.cannons.map(() => ({
    next: Math.round((P.cannonFirst + rng() * P.cannonFire[1]) * HZ),
  }));
  const guns = Lay.defenders.map(() => ({
    next: Math.round((P.gunFirst + rng() * P.gunFire[1]) * HZ),
  }));
  const gateGuns = Lay.gateCannons.map(() => ({ next: 0 }));
  const cannonShots = []; // [쏜 스텝, 대포, 닿은 스텝, 노린 병사, x, y, z(cm)]
  const gateShots = []; // [쏜 스텝, 안뜰 대포, 닿은 스텝, 노린 병사, x, y, z(cm)]
  const dumps = []; // [부은 스텝, 사다리, 닿은 스텝, 노린 병사, 명중 0/1, x, y, z(cm)]
  const guardNext = new Int32Array(NL);
  const flyingS = [];
  const gunShots = []; // [쏜 스텝, 수비군, 닿은 스텝, 노린 병사, 명중 0/1, x, y, z(cm)]
  const flyingC = [];
  const flyingG = [];
  const canBeHit = (i, tick) =>
    hits[i] < P.maxHits && tick >= guardUntil[i] && !aimed[i];

  // 물대포에 맞음: 대포 반대쪽으로 밀려나고, 넘어지거나 비틀거린다
  const knock = (tick, i, from, push = P.push) => {
    hits[i]++;
    let dx = x[i] - from[0];
    let dz = z[i] - from[2];
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    dx /= d;
    dz /= d;
    const len = between(rng, push);
    const falls = rng() < P.knockFall;
    slide[i] = { dx: dx * len, dz: dz * len };
    settle[i] = tick + Math.round(P.slide * HZ);
    until[i] =
      settle[i] + Math.round((falls ? between(rng, P.down) : P.stagger) * HZ);
    setSt(tick, i, falls ? ST.DOWN : ST.PUSH);
  };
  // 사다리에서 떨어짐: 아래 무리 쪽으로 떨어져 눕는다
  const knockOff = (tick, i, side) => {
    hits[i]++;
    const list = climbers[lane[i]];
    list.splice(list.indexOf(i), 1);
    topAt[i] = 0;
    fall[i] = {
      x0: x[i],
      z0: z[i],
      y0: y[i],
      x1: x[i] + side * 1.3,
      z1: baseZ - 0.6 - rng() * 1.8, // 벽에 부딪혀 뒤로 굴러떨어진다
      time: Math.max(0.25, Math.sqrt((2 * y[i]) / P.gravity)),
    };
    setSt(tick, i, ST.FALL);
  };

  const pos = Array.from({ length: n }, () => []);
  const last = Array.from({ length: n }, () => [0, 0, 0]);
  let frames = 0;
  const record = () => {
    for (let i = 0; i < n; i++) {
      const c = [cm(x[i]), cm(y[i]), cm(z[i])];
      const l = last[i];
      pos[i].push(c[0] - l[0], c[1] - l[1], c[2] - l[2]);
      last[i] = c;
    }
    frames++;
  };

  const order = [];
  const arrivals = [];
  const byRank = (a, b) => rank[a] - rank[b];
  let tick = 0;
  let stopAt = -1;
  record();

  // 문이 열리는 순간: 성문 옆 사다리로 가던 병사들이 사다리와 성문 중 빨리 들어갈 곳을 고른다 (성문에 가까운 사람부터)
  const openGate = () => {
    gateOpen = true;
    ram.breakTick = tick;
    gateGuns.forEach((g) => {
      g.next = tick + Math.round((0.5 + rng() * 0.6) * HZ);
    });
    const cand = [];
    for (let i = 0; i < n; i++) {
      if (st[i] !== ST.RUN && st[i] !== ST.QUEUE) continue;
      if (route[i] !== ROUTE.WALL || (lad[i] !== innerL && lad[i] !== innerR))
        continue;
      cand.push([i, dist(i, sideOf(x[i]) * P.laneX, gateZ)]);
    }
    cand.sort((a, b) => a[1] - b[1] || rank[a[0]] - rank[b[0]]);
    for (const [i] of cand) {
      const center = Math.abs(x[i]) < P.laneX + 0.5;
      if (center || gateCost(i) < ladderCost(i, lad[i]) - 0.5)
        route[i] = ROUTE.GATE;
    }
  };

  while (tick < MAX_TICKS) {
    tick++;
    const arrivedNow = [];

    // 0) 공성추: 문 앞까지 굴러가서 일정한 간격으로 친다
    if (ram.arriveTick < 0) {
      ram.front = Math.min(ram.stop, ram.front + P.ramSpeed * DT);
      if (ram.front >= ram.stop) ram.arriveTick = tick;
    } else if (
      !gateOpen &&
      (tick - ram.arriveTick) % Math.round(P.ramStrike * HZ) === 0
    ) {
      ram.strikes.push(tick);
    }

    // 1) 사다리: 줄마다 위에 있는 사람부터 움직여서 앞사람을 추월하지 않게 한다
    const firing = tick < P.ceaseFire * HZ && order.length < winnerCount;
    for (let ln = 0; ln < NLANE; ln++) {
      const list = climbers[ln];
      const k = ln >> 1;
      for (let c = 0; c < list.length; c++) {
        const i = list[c];
        timer[i] += DT;
        if (st[i] === ST.STEP) {
          const s = Math.min(1, timer[i] / P.step);
          // 꼭대기 발판에서 성벽 위 도착 구역으로 넘어간다 (흉벽을 넘느라 살짝 높게)
          x[i] = LANES[ln];
          y[i] = topY + (H - topY) * s + 0.5 * 4 * s * (1 - s);
          z[i] = topZ + (arriveZ - topZ) * s;
          if (s >= 1) arrivedNow.push(i);
          continue;
        }
        const limit = c === 0 ? ladLen : effP(list[c - 1]) - P.climbGap;
        climbP[i] = Math.max(
          climbP[i],
          Math.min(climbP[i] + vClimb[i] * DT, limit)
        );
        placeOnLadder(i);
        if (c !== 0 || climbP[i] < ladLen) continue;
        // 꼭대기: 수비군이 물바가지를 부으면 잠깐 버티다가 떨어지거나 올라선다
        if (
          topAt[i] === 0 &&
          firing &&
          tick >= guardNext[k] &&
          canBeHit(i, tick)
        ) {
          guardNext[k] = tick + Math.round(between(rng, P.guardCool) * HZ);
          topAt[i] = tick + Math.round(P.guardTime * HZ);
          aimed[i] = 1;
          dumpOf[i] = dumps.length;
          dumps.push([
            tick,
            k,
            topAt[i],
            i,
            rng() < P.guardHit ? 1 : 0,
            cm(x[i]),
            cm(y[i] + 1.1),
            cm(z[i]),
          ]);
        }
        if (topAt[i] > tick) continue;
        if (topAt[i] > 0) {
          const dmp = dumps[dumpOf[i]];
          aimed[i] = 0;
          topAt[i] = 0;
          if (dmp[4] && firing) {
            knockOff(tick, i, ln % 2 ? 1 : -1);
            c--;
            continue;
          }
          dmp[4] = 0;
        }
        setSt(tick, i, ST.STEP);
        topped++;
      }
    }

    // 2) 사다리 아래쪽이 비면, 그 순간 발치에 가장 가까운 병사가 잡고 오른다 (같으면 seed 로 정한 순서)
    buildGrid();
    for (let ln = 0; ln < NLANE; ln++) {
      const list = climbers[ln];
      const k = ln >> 1;
      if (list.length && effP(list[list.length - 1]) < P.climbGap) continue;
      // 발치 가까이(손이 닿는 곳)에 있는 병사 중 아직 사다리를 못 잡아 본 사람이 먼저, 그다음은 더 가까운 사람
      // (같으면 seed 로 정한 순서). 되도록 많은 병사가 사다리를 타 보게 한다.
      let pick = -1;
      let pickD = Infinity;
      neighbors(LANES[ln], footZ, (j) => {
        if (route[j] !== ROUTE.WALL || lad[j] !== k) return;
        if (st[j] !== ST.RUN && st[j] !== ST.QUEUE) return;
        const d = dist(j, LANES[ln], footZ);
        if (d >= P.reach) return;
        const better =
          pick < 0 ||
          tries[j] < tries[pick] ||
          (tries[j] === tries[pick] &&
            (d < pickD - 1e-9 ||
              (Math.abs(d - pickD) <= 1e-9 && rank[j] < rank[pick])));
        if (better) {
          pick = j;
          pickD = d;
        }
      });
      if (pick < 0) continue;
      climbP[pick] = 0;
      lane[pick] = ln;
      tries[pick]++;
      setSt(tick, pick, ST.CLIMB);
      list.push(pick);
      placeOnLadder(pick);
    }

    // 3) 땅 위 병사들 (번호 순서로 처리해서 결과가 늘 같게)
    for (let i = 0; i < n; i++) {
      const s = st[i];
      if (s === ST.READY) {
        if (tick >= reactAt[i]) setSt(tick, i, ST.RUN);
        continue;
      }
      if (s === ST.RUN || s === ST.QUEUE || s === ST.GATE) {
        timer[i] += DT;
        // 가끔(사람마다 다른 때에) 옆 사다리나 성문이 더 빠른지 다시 생각한다
        if ((tick + i * 7) % Math.round(P.rethink * HZ) === 0) {
          const cur =
            route[i] === ROUTE.GATE ? gateCost(i) : ladderCost(i, lad[i]);
          const r = choose(i);
          const next = r.gate ? gateCost(i) : ladderCost(i, r.k);
          if (
            (r.gate
              ? route[i] !== ROUTE.GATE
              : r.k !== lad[i] || route[i] !== ROUTE.WALL) &&
            next < cur - P.switchGain
          )
            assign(i, r);
        }
        if (route[i] === ROUTE.GATE) {
          // 성문으로: 공성추 뒤에 있으면 옆으로 비켜서, 공성추 옆을 지나 문 안으로 몰려 들어간다
          const sd = sideOf(x[i]);
          const lx = sd * P.laneX;
          if (z[i] < ram.front + 0.3 && Math.abs(x[i]) < P.ramHalf + 0.6)
            stepTo(i, sd * (P.ramHalf + 0.9), z[i] + 0.8, vRun[i], tick);
          else if (z[i] < WZ - 0.6) stepTo(i, lx, WZ - 0.3, vRun[i], tick);
          else stepTo(i, lx, gateZ + 5, vRun[i], tick);
          setSt(tick, i, z[i] > WZ - 6 ? ST.GATE : ST.RUN);
          continue;
        }
        // 사다리로: 멀리서는 달려가고, 발치 무리 속에서는 밀치며 조금씩 다가간다
        const k = lad[i];
        const d = dist(i, ladders[k], footZ);
        stepTo(i, ladders[k], footZ, d < P.crowdR ? P.press : vRun[i], tick);
        setSt(tick, i, d < P.crowdR ? ST.QUEUE : ST.RUN);
        continue;
      }
      if (s === ST.FALL) {
        timer[i] += DT;
        const f = fall[i];
        const u = Math.min(1, timer[i] / f.time);
        x[i] = f.x0 + (f.x1 - f.x0) * u;
        z[i] = f.z0 + (f.z1 - f.z0) * u;
        y[i] = Math.max(0, f.y0 - 0.5 * P.gravity * timer[i] * timer[i]);
        if (u >= 1) {
          y[i] = 0;
          slide[i] = null;
          settle[i] = tick + Math.round(P.slide * HZ);
          until[i] = tick + Math.round(between(rng, P.downFall) * HZ);
          setSt(tick, i, ST.DOWN);
        }
        continue;
      }
      if (s === ST.DOWN || s === ST.PUSH) {
        timer[i] += DT;
        const sl = slide[i];
        if (sl && tick <= settle[i]) {
          // 처음에 세게, 끝에 천천히 (u(2-u) 곡선의 이번 스텝 몫만큼)
          const u1 = Math.min(1, timer[i] / P.slide);
          const u0 = Math.max(0, u1 - DT / P.slide);
          const e = u1 * (2 - u1) - u0 * (2 - u0);
          x[i] += sl.dx * e;
          z[i] += sl.dz * e;
          clampGround(i);
        }
        if (tick >= until[i]) {
          slide[i] = null;
          guardUntil[i] = tick + P.guard * HZ;
          assign(i, choose(i));
          setSt(tick, i, ST.RUN);
        }
        continue;
      }
      if (s === ST.ARRIVED) {
        timer[i] += DT;
        const t = timer[i];
        if (route[i] === ROUTE.GATE) {
          // 성문 안쪽으로 걸어 들어가 사라진다
          z[i] += vRun[i] * DT;
          if (t > 2) setSt(tick, i, ST.GONE);
          continue;
        }
        // 출구를 비우고 통로 안쪽으로 걸어간 뒤 성 안 계단으로 내려간다
        if (t <= 1.3) {
          z[i] = arriveZ + ((WZ + P.walk - 0.5 - arriveZ) * t) / 1.3;
          y[i] = H;
        } else if (t <= 2.6) {
          const u = (t - 1.3) / 1.3;
          z[i] = WZ + P.walk - 0.5 + 1.4 * u;
          y[i] = H - 2.6 * u;
        } else {
          setSt(tick, i, ST.GONE);
        }
      }
    }

    // 4) 몸이 겹치지 않게 서로 밀어내기
    resolve();
    for (let i = 0; i < n; i++)
      if (st[i] === ST.GATE && route[i] === ROUTE.GATE && z[i] >= gateZ)
        arrivedNow.push(i);

    // 5) 들어온 병사: 두 길을 합쳐서, 같은 스텝이면 seed 로 정한 순서대로
    arrivedNow.sort(byRank).forEach((i) => {
      if (st[i] === ST.STEP) {
        const list = climbers[lane[i]];
        list.splice(list.indexOf(i), 1);
        y[i] = H;
        z[i] = arriveZ;
      }
      setSt(tick, i, ST.ARRIVED);
      arrivals.push([i, tick, route[i]]);
      order.push(i);
    });

    // 6) 성문: 정해진 인원이 성벽 꼭대기에 올랐고 공성추가 충분히 쳤으면 그 순간의 타격에 부서진다
    if (
      !gateOpen &&
      ram.strikes.length >= P.ramMinStrikes &&
      topped >= gateAt
    ) {
      if (ram.strikes[ram.strikes.length - 1] !== tick) ram.strikes.push(tick);
      openGate();
    }

    // 7) 물대포·물총: 물줄기가 닿는 순간 맞았는지 정한다. 물은 그 순간 목표가 있던 자리로 날아간다.
    for (let a = 0; a < flyingC.length; a++) {
      const shot = cannonShots[flyingC[a]];
      if (shot[2] !== tick) continue;
      flyingC.splice(a--, 1);
      const t = shot[3];
      aimed[t] = 0;
      const from = Lay.cannons[shot[1]];
      if (st[t] === ST.CLIMB) {
        // 사다리 위 병사를 노린 물대포
        const roll = rng();
        const side = rng() < 0.5 ? -1 : 1;
        shot[4] = cm(x[t]);
        shot[5] = cm(y[t] + 0.9);
        shot[6] = cm(z[t]);
        if (firing && roll < P.hitCannonClimber) knockOff(tick, t, side);
        continue;
      }
      const cx = x[t];
      const cz = Math.min(z[t], WZ - 0.6);
      shot[4] = cm(cx);
      shot[5] = 5;
      shot[6] = cm(cz);
      if (!firing) continue;
      const victims = [];
      for (let i = 0; i < n; i++) {
        const s = st[i];
        if (s !== ST.RUN && s !== ST.QUEUE && s !== ST.READY) continue;
        if (hits[i] >= P.maxHits || tick < guardUntil[i]) continue;
        if (Math.abs(x[i]) < P.cannonMinX) continue;
        const dx = x[i] - cx;
        const dz = z[i] - cz;
        if (dx * dx + dz * dz > P.splash * P.splash) continue;
        victims.push(i);
      }
      for (const i of victims)
        if (rng() < (i === t ? P.hitCenter : P.hitSplash)) knock(tick, i, from);
    }
    const inGateZone = (i) =>
      route[i] === ROUTE.GATE &&
      (st[i] === ST.RUN || st[i] === ST.GATE) &&
      z[i] >= WZ - 7 &&
      z[i] < gateZ &&
      Math.abs(x[i]) < P.gateHalf + 2;
    for (let a = 0; a < flyingS.length; a++) {
      const shot = gateShots[flyingS[a]];
      if (shot[2] !== tick) continue;
      flyingS.splice(a--, 1);
      const t = shot[3];
      aimed[t] = 0;
      const cx = x[t];
      const cz = z[t];
      shot[4] = cm(cx);
      shot[5] = y[t] > 0.3 ? cm(y[t] + 0.9) : 5;
      shot[6] = cm(cz);
      if (!firing) continue;
      const victims = [];
      for (let i = 0; i < n; i++) {
        if (!inGateZone(i) || hits[i] >= P.maxHits || tick < guardUntil[i])
          continue;
        const dx = x[i] - cx;
        const dz = z[i] - cz;
        if (dx * dx + dz * dz > P.gateSplash * P.gateSplash) continue;
        victims.push(i);
      }
      for (const i of victims)
        if (rng() < (i === t ? P.gateHitCenter : P.gateHitSplash))
          knock(tick, i, Lay.gateCannons[shot[1]], P.gatePush);
    }
    for (let a = 0; a < flyingG.length; a++) {
      const shot = gunShots[flyingG[a]];
      if (shot[2] !== tick) continue;
      flyingG.splice(a--, 1);
      const i = shot[3];
      aimed[i] = 0;
      const roll = rng();
      const side = rng() < 0.5 ? -1 : 1;
      if (firing && st[i] === ST.CLIMB && roll < P.hitGun) {
        shot[4] = 1;
        shot[5] = cm(x[i]);
        shot[6] = cm(y[i] + 1.0);
        shot[7] = cm(z[i]);
        knockOff(tick, i, side);
      } else {
        // 빗나간 물줄기는 병사 옆 성벽에 부딪힌다
        shot[5] = cm(x[i] + side * 0.6);
        shot[6] = cm(Math.max(0.3, y[i] + 0.8));
        shot[7] = cm(WZ - 0.05);
      }
    }
    if (firing) {
      const ground = [];
      const climbing = [];
      for (let i = 0; i < n; i++) {
        if (!canBeHit(i, tick) || Math.abs(x[i]) < P.cannonMinX) continue;
        const s = st[i];
        if (s === ST.RUN || s === ST.QUEUE) ground.push(i);
        else if (s === ST.CLIMB && y[i] > 1.2) climbing.push(i);
      }
      cannons.forEach((cn, c) => {
        if (tick < cn.next) return;
        cn.next = tick + Math.round(between(rng, P.cannonFire) * HZ);
        const pickClimber = climbing.length && rng() < P.cannonClimber;
        const pool = pickClimber || !ground.length ? climbing : ground;
        if (!pool.length) return;
        const j = Math.floor(rng() * pool.length);
        const i = pool[j];
        pool.splice(j, 1);
        const [ax, ay, az] = Lay.cannons[c];
        const d = Math.sqrt(
          (x[i] - ax) ** 2 + (y[i] - ay) ** 2 + (z[i] - az) ** 2
        );
        aimed[i] = 1;
        flyingC.push(cannonShots.length);
        cannonShots.push([
          tick,
          c,
          tick + Math.max(6, Math.round((d / P.cannonSpeed + 0.35) * HZ)),
          i,
          0,
          0,
          0,
        ]);
      });
      guns.forEach((gn, g) => {
        if (tick < gn.next) return;
        const [gx, gy, gz] = Lay.defenders[g];
        const targets = [];
        for (let ln = 0; ln < NLANE; ln++) {
          if (Math.abs(LANES[ln] - gx) > P.ladderGap / 2 + 0.6) continue;
          for (const i of climbers[ln])
            if (st[i] === ST.CLIMB && y[i] > 1.2 && canBeHit(i, tick))
              targets.push(i);
        }
        if (!targets.length) {
          gn.next = tick + Math.round(0.3 * HZ);
          return;
        }
        gn.next = tick + Math.round(between(rng, P.gunFire) * HZ);
        const i = targets[Math.floor(rng() * targets.length)];
        const d = Math.sqrt(
          (x[i] - gx) ** 2 + (y[i] - gy) ** 2 + (z[i] - gz) ** 2
        );
        aimed[i] = 1;
        flyingG.push(gunShots.length);
        gunShots.push([
          tick,
          g,
          tick + Math.max(3, Math.round((d / P.gunSpeed + 0.15) * HZ)),
          i,
          0,
          0,
          0,
          0,
        ]);
      });
    }

    if (firing && gateOpen) {
      const near = [];
      for (let i = 0; i < n; i++)
        if (inGateZone(i) && canBeHit(i, tick)) near.push(i);
      gateGuns.forEach((gg, g) => {
        if (tick < gg.next) return;
        gg.next = tick + Math.round(between(rng, P.gateFire) * HZ);
        if (!near.length) return;
        const j = Math.floor(rng() * near.length);
        const i = near[j];
        near.splice(j, 1);
        const [ax, ay, az] = Lay.gateCannons[g];
        const d = Math.sqrt(
          (x[i] - ax) ** 2 + (y[i] - ay) ** 2 + (z[i] - az) ** 2
        );
        aimed[i] = 1;
        flyingS.push(gateShots.length);
        gateShots.push([
          tick,
          g,
          tick + Math.max(4, Math.round((d / P.gateCannonSpeed + 0.2) * HZ)),
          i,
          0,
          0,
          0,
        ]);
      });
    }

    if (tick % SAMPLE === 0) record();
    if (stopAt < 0 && order.length >= winnerCount) stopAt = tick + TAIL_TICKS;
    if (stopAt >= 0 && tick >= stopAt) break;
  }
  if (order.length < winnerCount)
    throw new Error('제한 시간 안에 추첨이 끝나지 않았어요');
  if (tick % SAMPLE !== 0) record();

  const recording = {
    v: 1,
    kind: 'siege',
    version,
    n,
    winnerCount,
    hz: HZ,
    fps: HZ / SAMPLE,
    frames,
    ticks: tick,
    layout: Lay,
    ram: {
      start: WZ - P.ramStart,
      stop: ram.stop,
      speed: P.ramSpeed,
      length: P.ramLength,
      half: P.ramHalf,
      arriveTick: ram.arriveTick,
      strikes: ram.strikes,
      breakTick: ram.breakTick,
      gateAt,
    },
    events,
    // 끝날 때까지 닿지 않은 물줄기는 기록에서 뺀다 (화면에 없는 사건이 남지 않게)
    cannonShots: cannonShots.filter((s) => s[2] <= tick),
    gunShots: gunShots.filter((s) => s[2] <= tick),
    gateShots: gateShots.filter((s) => s[2] <= tick),
    dumps: dumps.filter((s) => s[2] <= tick),
    arrivals,
    pos,
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
  ROUTE,
  engineId,
  versionOf,
};
