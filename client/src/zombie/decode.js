// 좀비 탈출 기록(server/src/utils/zombie.js)을 화면에서 쓰기 좋게 푼다.
// 기록에는 참가자·좀비마다 cm 단위 위치의 변화량이 10fps 로, 상태가 바뀐 순간·물감탄·구출·물림이 스텝(1/20초) 단위로 들어 있다.

// 참가자 상태 번호 (server/src/utils/zombie.js 의 ST 와 같아야 한다)
export const ST = {
  READY: 0,
  RUN: 1,
  WAIT: 2,
  GRABBED: 3,
  TRIP: 4,
  PASS: 5,
  SAFE: 6,
  GONE: 7,
  TURNING: 8,
  ZOMBIE: 9,
  ZGRAB: 10,
  ZDIZZY: 11,
};
// 처음부터 좀비인 무리의 상태 (server/src/utils/zombie.js 의 ZS 와 같아야 한다)
export const ZS = { HIDDEN: 0, SHAMBLE: 1, CHASE: 2, GRAB: 3, DIZZY: 4 };

// 참가자 조끼 색 (참가자 번호로 돌아가며)
export const VEST_COLORS = ['#ff8a3d', '#2f8fe0', '#2bb673', '#e8b923'];

const flatten = (list, count, F) => {
  const out = new Float32Array(F * count * 2);
  list.forEach((flat, i) => {
    let x = 0;
    let z = 0;
    for (let f = 0; f < F; f++) {
      x += flat[f * 2];
      z += flat[f * 2 + 1];
      const o = (f * count + i) * 2;
      out[o] = x / 100;
      out[o + 1] = z / 100;
    }
  });
  return out;
};

export function decodeZombie(rec) {
  const { n, zn, frames: F } = rec;
  const pos = flatten(rec.pos, n, F);
  const zpos = flatten(rec.zpos, zn, F);
  // 참가자·좀비마다 [스텝, 상태, 스텝, 상태, ...]
  const events = Array.from({ length: n }, () => []);
  rec.events.forEach(([tick, i, s]) => events[i].push(tick, s));
  const zevents = Array.from({ length: zn }, () => []);
  rec.zevents.forEach(([tick, j, s]) => zevents[j].push(tick, s));
  // 좀비 떼는 처음부터 길에 있고, 골목 좀비는 처음 나올 때까지 숨어 있다
  const zstart = Int8Array.from({ length: zn }, (_, j) =>
    j < rec.horde ? ZS.SHAMBLE : ZS.HIDDEN
  );
  let zBack = 0;
  for (let i = 0; i < n; i++) zBack = Math.min(zBack, pos[i * 2 + 1]);
  for (let j = 0; j < zn; j++) zBack = Math.min(zBack, zpos[j * 2 + 1]);
  return {
    n,
    zn,
    F,
    pos,
    zpos,
    events,
    zevents,
    zstart,
    zBack,
    perFrame: rec.hz / rec.fps, // 한 프레임이 몇 스텝인지
  };
}
