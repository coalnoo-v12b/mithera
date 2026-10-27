// 로또 추첨기 녹화(server/src/utils/lotto.js)를 화면에서 쓰기 좋게 푼다.
// 녹화에는 공마다 mm 단위 위치의 변화량이 20fps 로 들어 있다.
export function decodeLotto(rec) {
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
      pos[o] = x / 1000;
      pos[o + 1] = y / 1000;
      pos[o + 2] = z / 1000;
    }
  });
  const captureAt = new Array(n).fill(Infinity);
  const arriveAt = new Array(n).fill(Infinity);
  rec.captures.forEach(([i, f]) => {
    captureAt[i] = f;
  });
  rec.arrivals.forEach(([i, f]) => {
    arriveAt[i] = f;
  });
  return { n, F, pos, captureAt, arriveAt };
}

// f 프레임에 배출구 덮개가 열려 있는지
export function gateOpenAt(rec, f) {
  let open = false;
  for (const [frame, o] of rec.gate) {
    if (frame > f) break;
    open = !!o;
  }
  return open;
}
