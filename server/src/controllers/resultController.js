const { User, Draw, DrawResult } = require('../models');
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

// 랜딩 페이지용 공개 통계: 숫자만 내보낸다 (추첨 제목·참가자·seed 는 포함하지 않는다).
// 전체 해시 체인을 다시 계산하는 비용이 있어서 60초 동안은 결과를 재사용한다.
const PUBLIC_STATS_TTL = 60 * 1000;
let publicStatsCache = null;

const publicStats = async (req, res) => {
  const now = Date.now();
  if (!publicStatsCache || now - publicStatsCache.at > PUBLIC_STATS_TTL) {
    const [users, drawn, c] = await Promise.all([
      User.countDocuments(),
      Draw.countDocuments({ status: 'drawn' }),
      chainStatus(),
    ]);
    publicStatsCache = {
      at: now,
      data: { users, drawn, results: c.count, chainOk: c.ok },
    };
  }
  res.json(publicStatsCache.data);
};

module.exports = { chain, results, stats, publicStats };
