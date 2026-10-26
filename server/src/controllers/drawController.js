const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { User, Draw, DrawResult, RaceRecording, Counter } = require('../models');
const race = require('../utils/race');
const {
  ALGO,
  GENESIS,
  sha256,
  pickWinners,
  hashParticipants,
  hashResult,
  verifyResult,
} = require('../utils/lottery');
const { isId, fail } = require('../utils/http');
const { parseNoQuery } = require('../utils/drawNo');

const STYLES = ['wheel', 'cards', 'marbles', 'ladder'];

// 추첨을 마감·실행할 수 있는 사람: 만든 사람 또는 관리자
const isOwner = (req, d) => String(d.createdBy) === String(req.user._id);
const canManage = (req, d) => req.isAdmin || isOwner(req, d);
const NOT_MANAGER = '추첨을 만든 사람이나 관리자만 할 수 있어요';

const resultOut = (r) => ({
  seq: r.seq,
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
  hash: r.hash,
  engine: r.engine || null,
  recordingHash: r.recordingHash || null,
});

async function drawOut(d, req) {
  const uid = String(req.user._id);
  const joined = d.participants.some((p) => String(p._id || p) === uid);
  const manage = canManage(req, d);
  const canSee = joined || manage;
  const out = {
    id: String(d._id),
    no: d.no ?? null,
    canManage: manage,
    title: d.title,
    description: d.description,
    style: d.style,
    winnerCount: d.winnerCount,
    drawAt: d.drawAt,
    status: d.status,
    createdAt: d.createdAt,
    closedAt: d.closedAt,
    participantCount: d.participants.length,
    joined,
    hasPassword: !!d.hasPassword,
    commitment: d.commitment || null,
    participantsHash: d.participantsHash || null,
  };
  if (canSee) {
    const users = await User.find({ _id: { $in: d.participants } }, 'nickname');
    out.participants = users.map((u) => ({
      id: String(u._id),
      nickname: u.nickname,
    }));
    if (d.status === 'drawn') {
      const r = await DrawResult.findOne({ draw: d._id });
      out.result = r ? resultOut(r) : null;
    }
  }
  return out;
}

// 참여자 또는 관리자만 볼 수 있는 추첨을 불러온다. 실패하면 응답을 보내고 null 을 돌려준다.
async function findDrawForMember(req, res) {
  if (!isId(req.params.id)) {
    fail(res, 400, '잘못된 요청이에요');
    return null;
  }
  const d = await Draw.findById(req.params.id);
  if (!d) {
    fail(res, 404, '추첨을 찾을 수 없어요');
    return null;
  }
  const uid = String(req.user._id);
  if (!canManage(req, d) && !d.participants.some((p) => String(p) === uid)) {
    fail(res, 403, '참여한 추첨만 조회할 수 있어요');
    return null;
  }
  return d;
}

// 검색어: "20261026-3" 은 그 번호, "20261026" 은 그날의 모든 추첨,
// 그 밖의 글자는 이름에 포함된 추첨을 찾는다. (번호처럼 보여도 이름 검색은 함께 한다)
const searchFilter = (q) => {
  if (!q) return {};
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const byTitle = { title: new RegExp(esc, 'i') };
  const p = parseNoQuery(q);
  if (!p) return byTitle;
  const byNo = p.exact ? { no: p.exact } : { no: new RegExp(`^${p.day}-`) };
  return { $or: [byNo, byTitle] };
};

// 목록 범위: 내가 참여한 추첨 / 내가 만든 추첨. 없으면 전체. 검색어와 함께 쓸 수 있다.
const SCOPES = {
  joined: (user) => ({ participants: user._id }),
  mine: (user) => ({ createdBy: user._id }),
};

const list = async (req, res) => {
  const q = String(req.query.q || '')
    .trim()
    .slice(0, 50);
  const scope = SCOPES[req.query.filter];
  const parts = [scope && scope(req.user), q && searchFilter(q)].filter(
    Boolean
  );
  const filter = parts.length > 1 ? { $and: parts } : parts[0] || {};
  const draws = await Draw.find(filter).sort({ createdAt: -1 }).limit(100);
  const uid = String(req.user._id);
  res.json({
    draws: draws.map((d) => ({
      id: String(d._id),
      no: d.no ?? null,
      title: d.title,
      style: d.style,
      status: d.status,
      winnerCount: d.winnerCount,
      drawAt: d.drawAt,
      participantCount: d.participants.length,
      joined: d.participants.some((p) => String(p) === uid),
      mine: isOwner(req, d),
      hasPassword: !!d.hasPassword,
      createdAt: d.createdAt,
    })),
  });
};

const create = async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const description = String(b.description || '').trim();
  const winnerCount = Number(b.winnerCount);
  const style = STYLES.includes(b.style) ? b.style : 'wheel';
  const drawAt = new Date(b.drawAt);
  if (!b.drawAt || isNaN(drawAt.getTime()))
    return fail(res, 400, '추첨 날짜와 시간을 입력해줘');
  if (!title || title.length > 60)
    return fail(res, 400, '추첨 이름을 1~60자로 입력해줘');
  if (description.length > 300)
    return fail(res, 400, '설명은 300자까지 입력할 수 있어요');
  if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 100)
    return fail(res, 400, '당첨 인원은 1~100명으로 정해줘');
  // 참여 비밀번호는 선택. 비워 두면 누구나 참여할 수 있다.
  const password = String(b.password || '');
  if (password && (password.length < 4 || password.length > 30))
    return fail(res, 400, '참여 비밀번호는 4~30자로 입력해줘');
  const d = await Draw.create({
    no: await Counter.nextDrawNo(),
    title,
    description,
    winnerCount,
    style,
    drawAt,
    createdBy: req.user._id,
    ...(password
      ? { hasPassword: true, passwordHash: await bcrypt.hash(password, 10) }
      : {}),
  });
  res.json({ draw: await drawOut(d, req) });
};

const get = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 400, '잘못된 요청이에요');
  const d = await Draw.findById(req.params.id);
  if (!d) return fail(res, 404, '추첨을 찾을 수 없어요');
  res.json({ draw: await drawOut(d, req) });
};

const join = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 400, '잘못된 요청이에요');
  const target = await Draw.findById(req.params.id).select('+passwordHash');
  if (!target) return fail(res, 404, '추첨을 찾을 수 없어요');
  if (target.hasPassword) {
    const password = String((req.body && req.body.password) || '');
    if (!password || !(await bcrypt.compare(password, target.passwordHash)))
      return fail(res, 403, '참여 비밀번호가 맞지 않아요');
  }
  const r = await Draw.updateOne(
    { _id: req.params.id, status: 'open' },
    { $addToSet: { participants: req.user._id } }
  );
  if (!r.matchedCount)
    return fail(res, 409, '참여를 받는 중인 추첨이 아니에요');
  res.json({ ok: true });
};

const leave = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 400, '잘못된 요청이에요');
  const r = await Draw.updateOne(
    { _id: req.params.id, status: 'open' },
    { $pull: { participants: req.user._id } }
  );
  if (!r.matchedCount)
    return fail(res, 409, '마감된 추첨은 참여를 취소할 수 없어요');
  res.json({ ok: true });
};

// 마감: 참가자 확정 + 난수 seed 확정 후 commitment(seed 의 해시) 공개
const close = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 400, '잘못된 요청이에요');
  const cur = await Draw.findById(req.params.id);
  if (!cur) return fail(res, 404, '추첨을 찾을 수 없어요');
  if (!canManage(req, cur)) return fail(res, 403, NOT_MANAGER);
  if (cur.status !== 'open') return fail(res, 409, '이미 마감된 추첨이에요');
  if (cur.participants.length < cur.winnerCount)
    return fail(
      res,
      400,
      `참여자가 당첨 인원(${cur.winnerCount}명)보다 적어요`
    );
  // 먼저 상태를 바꿔 더 이상 참여/취소가 되지 않게 잠근 뒤 참가자를 확정한다
  const d = await Draw.findOneAndUpdate(
    { _id: cur._id, status: 'open' },
    { $set: { status: 'closed', closedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!d) return fail(res, 409, '이미 마감된 추첨이에요');
  if (d.participants.length < d.winnerCount) {
    await Draw.updateOne(
      { _id: d._id },
      { $set: { status: 'open' }, $unset: { closedAt: '' } }
    );
    return fail(res, 400, `참여자가 당첨 인원(${d.winnerCount}명)보다 적어요`);
  }
  const seed = crypto.randomBytes(32).toString('hex');
  const ids = d.participants.map(String).sort();
  await Draw.updateOne(
    { _id: d._id },
    {
      $set: {
        seed,
        commitment: sha256(seed),
        participantsHash: hashParticipants(ids),
      },
    }
  );
  res.json({ draw: await drawOut(await Draw.findById(d._id), req) });
};

// 추첨 실행: 서버가 확정한 seed 로 당첨자를 정하고, 결과를 해시 체인에 잠가서 저장
const run = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 400, '잘못된 요청이에요');
  const owner = await Draw.findById(req.params.id).select('createdBy');
  if (!owner) return fail(res, 404, '추첨을 찾을 수 없어요');
  if (!canManage(req, owner)) return fail(res, 403, NOT_MANAGER);
  const d = await Draw.findOneAndUpdate(
    { _id: req.params.id, status: 'closed', commitment: { $exists: true } },
    { $set: { status: 'drawing' } },
    { returnDocument: 'after' }
  ).select('+seed');
  if (!d)
    return fail(
      res,
      409,
      '마감된 추첨만 실행할 수 있어요 (이미 실행됐을 수도 있어요)'
    );

  try {
    const ids = d.participants.map(String).sort();
    const users = await User.find({ _id: { $in: ids } }, 'nickname');
    const nick = new Map(users.map((u) => [String(u._id), u.nickname]));
    const snap = (id) => ({ id, nickname: nick.get(id) || '(탈퇴)' });

    // 구슬 레이스는 물리 엔진이 승자를 정한다. 그 외 연출은 seed 로 섞어서 뽑는다.
    const isRace = d.style === 'marbles';
    let winnerIds;
    let physics = {};
    if (isRace) {
      const sim = race.simulate({
        seed: d.seed,
        n: ids.length,
        winnerCount: d.winnerCount,
      });
      winnerIds = sim.order.slice(0, d.winnerCount).map((i) => ids[i]);
      const hash = sha256(sim.raw);
      const ex = await RaceRecording.findOne({ draw: d._id });
      if (!ex) await RaceRecording.create({ draw: d._id, raw: sim.raw, hash });
      else if (ex.hash !== hash) throw new Error('이전 시도의 녹화와 달라요');
      physics = { engine: sim.engine, recordingHash: hash };
    } else {
      winnerIds = pickWinners(ids, d.winnerCount, d.seed);
    }

    let saved = null;
    for (let attempt = 0; attempt < 5 && !saved; attempt++) {
      const last = await DrawResult.findOne().sort({ seq: -1 });
      const rec = {
        seq: (last ? last.seq : 0) + 1,
        draw: d._id,
        title: d.title,
        participants: ids.map(snap),
        participantsHash: d.participantsHash,
        commitment: d.commitment,
        seed: d.seed,
        algo: isRace ? race.ALGO : ALGO,
        winnerCount: d.winnerCount,
        winners: winnerIds.map(snap),
        drawnAt: new Date().toISOString(),
        prevHash: last ? last.hash : GENESIS,
        ...physics,
      };
      rec.hash = hashResult(rec);
      try {
        saved = await DrawResult.create(rec);
      } catch (e) {
        if (!(e.code === 11000 && e.keyPattern && e.keyPattern.seq)) throw e; // seq 충돌만 재시도
      }
    }
    if (!saved) throw new Error('결과 저장 실패');
    await Draw.updateOne({ _id: d._id }, { $set: { status: 'drawn' } });
    res.json({ draw: await drawOut(await Draw.findById(d._id), req) });
  } catch (e) {
    await Draw.updateOne(
      { _id: d._id, status: 'drawing' },
      { $set: { status: 'closed' } }
    );
    throw e;
  }
};

// 물리 결과 검증: 같은 seed 로 시뮬레이션을 처음부터 다시 돌려 녹화가 한 글자도 다르지 않은지 확인한다
async function verifyRaceResult(r, prev) {
  const ids = r.participants.map((p) => p.id);
  const sorted = [...ids].sort();
  const rec = await RaceRecording.findOne({ draw: r.draw });
  const raw = rec ? rec.raw : '';
  let winnersMatch = false;
  let resimSame = false;
  if (rec) {
    try {
      const order = JSON.parse(raw).order;
      winnersMatch =
        JSON.stringify(order.slice(0, r.winnerCount).map((i) => sorted[i])) ===
        JSON.stringify(r.winners.map((w) => w.id));
    } catch {
      /* 녹화가 깨져 있으면 불일치 */
    }
    // 결과에 기록된 엔진/트랙 버전 그대로 다시 돌린다 (물리 조건을 바꾼 뒤에도 옛 결과가 계속 검증되도록)
    resimSame =
      race.simulate({
        seed: r.seed,
        n: sorted.length,
        winnerCount: r.winnerCount,
        version: race.versionOf(r.engine),
      }).raw === raw;
  }
  return [
    [
      'seed 가 마감 때 공개한 commitment 와 일치',
      sha256(r.seed) === r.commitment,
    ],
    [
      '참가자 목록이 마감 때 확정한 해시와 일치',
      hashParticipants(sorted) === r.participantsHash &&
        JSON.stringify(ids) === JSON.stringify(sorted),
    ],
    [
      '저장된 녹화의 해시가 결과에 기록된 값과 일치',
      !!rec && sha256(raw) === r.recordingHash && rec.hash === r.recordingHash,
    ],
    ['당첨자가 녹화에 담긴 결승선 도착 순서와 일치', winnersMatch],
    [
      '같은 seed 로 물리 시뮬레이션을 다시 돌려도 똑같은 녹화가 나옴',
      resimSame,
    ],
    ['결과 해시가 내용과 일치 (변조 없음)', hashResult(r) === r.hash],
    [
      '직전 결과와 해시 체인이 이어짐',
      r.prevHash === (prev ? prev.hash : GENESIS),
    ],
  ].map(([label, ok]) => ({ label, ok }));
}

// 구슬 레이스 녹화 (참여자/관리자만)
const recording = async (req, res) => {
  const d = await findDrawForMember(req, res);
  if (!d) return;
  const rec = await RaceRecording.findOne({ draw: d._id });
  if (!rec) return fail(res, 404, '녹화가 없어요');
  res.json({ raw: rec.raw, hash: rec.hash });
};

// 검증: 누구나 같은 결과를 다시 계산해서 확인할 수 있다 (참여자/관리자만 호출 가능)
const verify = async (req, res) => {
  const d = await findDrawForMember(req, res);
  if (!d) return;
  const r = await DrawResult.findOne({ draw: d._id });
  if (!r) return fail(res, 404, '아직 추첨 결과가 없어요');
  const prev = r.seq > 1 ? await DrawResult.findOne({ seq: r.seq - 1 }) : null;
  const checks =
    r.algo === race.ALGO
      ? await verifyRaceResult(r, prev)
      : verifyResult(r, prev);
  res.json({ ok: checks.every((c) => c.ok), checks });
};

module.exports = {
  list,
  create,
  get,
  join,
  leave,
  close,
  run,
  recording,
  verify,
};
