const {
  ALGO,
  GENESIS,
  sha256,
  pickWinners,
  hashParticipants,
  hashResult,
  verifyResult,
} = require('../src/utils/lottery');
const race = require('../src/utils/race');
const { DrawResult } = require('../src/models');

const seed = 'ab'.repeat(32);
const ids = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'];

const buildRecord = (prevHash = GENESIS) => {
  const winners = pickWinners(ids, 2, seed).map((id) => ({
    id,
    nickname: `nick-${id}`,
  }));
  const rec = {
    seq: 1,
    draw: 'draw-1',
    title: '테스트 추첨',
    participants: ids.map((id) => ({ id, nickname: `nick-${id}` })),
    participantsHash: hashParticipants(ids),
    commitment: sha256(seed),
    seed,
    algo: ALGO,
    winnerCount: 2,
    winners,
    drawnAt: '2026-01-01T00:00:00.000Z',
    prevHash,
  };
  rec.hash = hashResult(rec);
  return rec;
};

describe('pickWinners', () => {
  it('같은 seed 면 항상 같은 당첨자를 뽑는다', () => {
    expect(pickWinners(ids, 3, seed)).toEqual(pickWinners(ids, 3, seed));
  });

  it('참가자 중에서 중복 없이 winnerCount 명을 뽑는다', () => {
    const winners = pickWinners(ids, 4, seed);
    expect(winners).toHaveLength(4);
    expect(new Set(winners).size).toBe(4);
    winners.forEach((w) => expect(ids).toContain(w));
  });

  it('입력 배열을 바꾸지 않는다', () => {
    const copy = [...ids];
    pickWinners(copy, 2, seed);
    expect(copy).toEqual(ids);
  });
});

describe('verifyResult', () => {
  it('정상 결과는 모든 검증을 통과한다', () => {
    const checks = verifyResult(buildRecord(), null);
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it('당첨자를 바꾸면 검증에 실패한다', () => {
    const rec = buildRecord();
    rec.winners = [{ id: 'zzz', nickname: 'cheater' }];
    expect(verifyResult(rec, null).some((c) => !c.ok)).toBe(true);
  });

  it('직전 결과의 해시가 이어지지 않으면 실패한다', () => {
    const rec = buildRecord('f'.repeat(64));
    expect(verifyResult(rec, null).some((c) => !c.ok)).toBe(true);
  });
});

describe('race.simulate', () => {
  it('같은 seed 면 녹화가 완전히 같다 (재현 가능)', () => {
    const opts = { seed, n: 6, winnerCount: 2 };
    expect(race.simulate(opts).raw).toBe(race.simulate(opts).raw);
  }, 30000);
});

describe('DrawResult 잠금', () => {
  it('저장된 결과의 수정/삭제 시도는 거부된다', async () => {
    await expect(
      DrawResult.updateOne({ seq: 1 }, { title: 'x' }).exec()
    ).rejects.toThrow('수정하거나 삭제할 수 없어요');
    await expect(DrawResult.deleteMany({}).exec()).rejects.toThrow(
      '수정하거나 삭제할 수 없어요'
    );
  });
});
