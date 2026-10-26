// 사다리타기 로직 (화면과 분리). 가로줄은 무작위로 그리고, 도착 칸의 "당첨/꽝" 표시는 서버가 정한 결과에 맞춰 나중에 붙인다.

// rungs[level] = 그 층에서 가로줄이 (c, c+1) 사이에 놓이는 c 의 Set. 이웃한 줄은 겹치지 않는다.
export function makeRungs(n, levels, rnd = Math.random) {
  const rungs = [];
  for (let l = 0; l < levels; l++) {
    const set = new Set();
    for (let c = 0; c < n - 1; c++) {
      if (set.has(c - 1)) continue;
      if (rnd() < 0.45) set.add(c);
    }
    rungs.push(set);
  }
  return rungs;
}

// start 열에서 출발해 내려갔을 때의 도착 열과, 가로로 꺾이는 지점들
export function walk(start, rungs) {
  let c = start;
  const steps = [];
  rungs.forEach((set, l) => {
    if (set.has(c)) {
      steps.push({ l, from: c, to: c + 1 });
      c += 1;
    } else if (set.has(c - 1)) {
      steps.push({ l, from: c, to: c - 1 });
      c -= 1;
    }
  });
  return { end: c, steps };
}

// 출발 열 -> 도착 열. 항상 일대일 대응(순열)이다.
export const endsOf = (n, rungs) =>
  Array.from({ length: n }, (_, s) => walk(s, rungs).end);
