const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const lotto = require('../utils/lotto');
const roulette = require('../utils/roulette');
const { fail } = require('../utils/http');

// 개발용 실험 화면(client /#/lab/lotto, /#/lab/roulette)에서 쓰는 미리보기. 결과를 저장하지 않는다.
// app.js 에서 production 이 아닐 때만 연결한다.
const router = express.Router();

router.get('/lotto', compression(), async (req, res) => {
  const n = Number(req.query.n);
  const w = Number(req.query.w);
  if (!Number.isInteger(n) || n < 1 || n > lotto.MAX_BALLS)
    return fail(res, 400, `공은 1~${lotto.MAX_BALLS}개로 정해줘`);
  if (!Number.isInteger(w) || w < 1 || w > Math.min(n, lotto.MAX_WINNERS))
    return fail(res, 400, '당첨 인원이 올바르지 않아요');
  const seed = /^[0-9a-f]{64}$/.test(String(req.query.seed || ''))
    ? req.query.seed
    : crypto.randomBytes(32).toString('hex');
  const sim = await lotto.simulate({ seed, n, winnerCount: w });
  res.json({ seed, raw: sim.raw, engine: sim.engine });
});

router.get('/roulette', compression(), async (req, res) => {
  const n = Number(req.query.n);
  const w = Number(req.query.w);
  if (!Number.isInteger(n) || n < 1 || n > roulette.MAX_PLAYERS)
    return fail(res, 400, `참가자는 1~${roulette.MAX_PLAYERS}명으로 정해줘`);
  if (!Number.isInteger(w) || w < 1 || w > Math.min(n, roulette.MAX_WINNERS))
    return fail(res, 400, '당첨 인원이 올바르지 않아요');
  const seed = /^[0-9a-f]{64}$/.test(String(req.query.seed || ''))
    ? req.query.seed
    : crypto.randomBytes(32).toString('hex');
  const sim = await roulette.simulate({ seed, n, winnerCount: w });
  res.json({ seed, raw: sim.raw, engine: sim.engine });
});

module.exports = router;
