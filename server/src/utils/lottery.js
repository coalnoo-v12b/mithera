const crypto = require('crypto');

// 추첨 알고리즘 (공개 · 재현 가능)
const ALGO = 'hmac-sha256-fisher-yates-v1';
const GENESIS = '0'.repeat(64);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// seed 와 카운터로부터 [0, n) 범위의 균등 난수를 만든다. (편향 제거를 위해 rejection sampling)
function makeRng(seed) {
  let counter = 0;
  return (n) => {
    const limit = 2 ** 32 - (2 ** 32 % n);
    for (;;) {
      const block = crypto
        .createHmac('sha256', seed)
        .update(String(counter++))
        .digest();
      for (let i = 0; i + 4 <= block.length; i += 4) {
        const v = block.readUInt32BE(i);
        if (v < limit) return v % n;
      }
    }
  };
}

// 정렬된 참가자 id 배열을 Fisher-Yates 로 섞어 앞에서부터 winnerCount 명을 당첨자로 한다.
function pickWinners(sortedIds, winnerCount, seed) {
  const rng = makeRng(seed);
  const a = [...sortedIds];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, winnerCount);
}

const hashParticipants = (sortedIds) => sha256(sortedIds.join(','));

// 해시 대상 필드와 순서를 고정한다.
const payloadOf = (r) => ({
  seq: r.seq,
  drawId: String(r.draw || r.drawId),
  title: r.title,
  participants: r.participants.map((p) => ({ id: p.id, nickname: p.nickname })),
  participantsHash: r.participantsHash,
  commitment: r.commitment,
  seed: r.seed,
  algo: r.algo,
  winnerCount: r.winnerCount,
  winners: r.winners.map((p) => ({ id: p.id, nickname: p.nickname })),
  drawnAt: r.drawnAt,
  prevHash: r.prevHash,
  // 기존 결과의 해시가 바뀌지 않도록, 물리 결과에만 필드를 덧붙인다
  ...(r.recordingHash
    ? { engine: r.engine, recordingHash: r.recordingHash }
    : {}),
});

const hashResult = (r) => sha256(JSON.stringify(payloadOf(r)));

// 검증: 누구나 같은 결과를 다시 계산해서 확인할 수 있다
function verifyResult(r, prev) {
  const ids = r.participants.map((p) => p.id);
  const sorted = [...ids].sort();
  const redo = pickWinners(sorted, r.winnerCount, r.seed);
  return [
    [
      'seed가 마감 때 공개한 commitment와 일치',
      sha256(r.seed) === r.commitment,
    ],
    [
      '참가자 목록이 마감 때 확정한 해시와 일치',
      hashParticipants(sorted) === r.participantsHash &&
        JSON.stringify(ids) === JSON.stringify(sorted),
    ],
    [
      '공개된 알고리즘으로 다시 계산한 당첨자가 저장된 결과와 일치',
      JSON.stringify(redo) === JSON.stringify(r.winners.map((w) => w.id)),
    ],
    ['결과 해시가 내용과 일치 (변조 없음)', hashResult(r) === r.hash],
    [
      '직전 결과와 해시 체인이 이어짐',
      r.prevHash === (prev ? prev.hash : GENESIS),
    ],
  ].map(([label, ok]) => ({ label, ok }));
}

module.exports = {
  ALGO,
  GENESIS,
  sha256,
  pickWinners,
  hashParticipants,
  hashResult,
  verifyResult,
};
