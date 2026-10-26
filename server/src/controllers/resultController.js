const { Draw, DrawResult } = require('../models');
const { GENESIS, hashResult } = require('../utils/lottery');

// 전체 해시 체인 검증 (결과가 하나라도 바뀌면 깨짐)
async function chainStatus() {
  const all = await DrawResult.find().sort({ seq: 1 });
  let prevHash = GENESIS;
  let brokenAt = null;
  all.forEach((r, i) => {
    if (
      brokenAt == null &&
      (r.prevHash !== prevHash || hashResult(r) !== r.hash || r.seq !== i + 1)
    ) {
      brokenAt = r.seq;
    }
    prevHash = r.hash;
  });
  return {
    all,
    ok: brokenAt == null,
    count: all.length,
    brokenAt,
    head: prevHash,
  };
}

const chain = async (req, res) => {
  const { ok, count, brokenAt, head } = await chainStatus();
  res.json({ ok, count, brokenAt, head });
};

// 체인 시각화/브라우저 검증용: 각 결과의 해시 정보만 (참가자·seed 같은 상세는 포함하지 않음)
const results = async (req, res) => {
  const c = await chainStatus();
  res.json({
    ok: c.ok,
    brokenAt: c.brokenAt,
    results: c.all.map((r) => ({
      seq: r.seq,
      drawId: String(r.draw),
      title: r.title,
      drawnAt: r.drawnAt,
      prevHash: r.prevHash,
      hash: r.hash,
    })),
  });
};

// 목록 화면 상단의 통계
const stats = async (req, res) => {
  const [draws, drawn, c] = await Promise.all([
    Draw.countDocuments(),
    Draw.countDocuments({ status: 'drawn' }),
    chainStatus(),
  ]);
  res.json({ draws, drawn, results: c.count, chainOk: c.ok });
};

module.exports = { chain, results, stats };
