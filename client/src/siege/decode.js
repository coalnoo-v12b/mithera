// 성벽 탈환전 기록(server/src/utils/siege.js)을 화면에서 쓰기 좋게 푼다.
// 기록에는 병사마다 cm 단위 위치의 변화량이 10fps 로, 상태가 바뀐 순간·물줄기·공성추 타격이 스텝(1/20초) 단위로 들어 있다.

// 병사 상태 번호 (server/src/utils/siege.js 의 ST 와 같아야 한다)
export const ST = {
  READY: 0,
  RUN: 1,
  QUEUE: 2,
  CLIMB: 3,
  STEP: 4,
  ARRIVED: 5,
  FALL: 6,
  DOWN: 7,
  GONE: 8,
  GATE: 9,
  PUSH: 10,
};
// 들어온 길 (server/src/utils/siege.js 의 ROUTE 와 같아야 한다)
export const ROUTE = { WALL: 0, GATE: 1 };

// 병사 팀 색 (참가자 번호로 돌아가며)
export const TEAM_COLORS = ['#2f6fe0', '#14a39a', '#8b55e8'];

export function decodeSiege(rec) {
  const { n, frames: F } = rec;
  const pos = new Float32Array(F * n * 3);
  rec.pos.forEach((flat, i) => {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let f = 0; f < F; f++) {
      x += flat[f * 3];
      y += flat[f * 3 + 1];
      z += flat[f * 3 + 2];
      const o = (f * n + i) * 3;
      pos[o] = x / 100;
      pos[o + 1] = y / 100;
      pos[o + 2] = z / 100;
    }
  });
  // 병사마다 [스텝, 상태, 스텝, 상태, ...]
  const events = Array.from({ length: n }, () => []);
  rec.events.forEach(([tick, i, s]) => events[i].push(tick, s));
  let zBack = 0;
  for (let i = 0; i < n; i++) zBack = Math.min(zBack, pos[i * 3 + 2]);
  // 병사마다 들어온 길 (아직 못 들어왔으면 -1)
  const route = new Int8Array(n).fill(-1);
  rec.arrivals.forEach(([i, , r]) => {
    route[i] = r;
  });
  return {
    n,
    F,
    pos,
    events,
    zBack,
    route,
    perFrame: rec.hz / rec.fps, // 한 프레임이 몇 스텝인지
  };
}
