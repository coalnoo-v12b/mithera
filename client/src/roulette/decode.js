// 룰렛 녹화(server/src/utils/roulette.js)를 화면에서 쓰기 좋게 푼다.
// 녹화에는 공 위치(mm)와 휠 각도(1e-4 rad)의 변화량이 30fps 로 들어 있다.
export function decodeRoulette(rec) {
  const F = rec.frames;
  const ball = new Float32Array(F * 3);
  const wheel = new Float32Array(F);
  let x = 0;
  let y = 0;
  let z = 0;
  let a = 0;
  for (let f = 0; f < F; f++) {
    x += rec.ball[f * 3];
    y += rec.ball[f * 3 + 1];
    z += rec.ball[f * 3 + 2];
    a += rec.wheel[f];
    ball[f * 3] = x / 1000;
    ball[f * 3 + 1] = y / 1000;
    ball[f * 3 + 2] = z / 1000;
    wheel[f] = a / 1e4;
  }
  return { F, ball, wheel };
}

// 휠 기준 각도 α 의 칸 번호 (서버와 같은 규칙: 세계 각도 + 휠 각도)
export function pocketAt(rec, x, z, wheelAngle) {
  const TAU = Math.PI * 2;
  const { P } = rec.layout;
  const local = (((Math.atan2(z, x) + wheelAngle) % TAU) + TAU) % TAU;
  return Math.min(P - 1, Math.floor(local / (TAU / P)));
}
