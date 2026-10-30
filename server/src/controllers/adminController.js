const { User, Draw, DrawResult } = require('../models');
const { isAdminEmail } = require('../utils/auth');
const { isId, fail } = require('../utils/http');
const { kstYmd } = require('../utils/drawNo');

const summary = async (req, res) => {
  const [users, admins, draws, drawn, results] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ user_type: 'admin' }),
    Draw.countDocuments(),
    Draw.countDocuments({ status: 'drawn' }),
    DrawResult.countDocuments(),
  ]);
  res.json({ users, admins, draws, drawn, results });
};

const PAGE_SIZE = 10;
const PAGE_SIZES = [10, 20, 50, 100];
const TYPES = ['user', 'admin'];

// 회원 목록: 검색어, 권한(user/admin) 필터, 페이지(기본 10명씩, 10/20/50/100 선택)
const listUsers = async (req, res) => {
  const q = String(req.query.q || '')
    .trim()
    .slice(0, 50);
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = [];
  if (q)
    parts.push({
      $or: [
        { email: new RegExp(esc, 'i') },
        { nickname: new RegExp(esc, 'i') },
      ],
    });
  if (TYPES.includes(req.query.type)) parts.push({ user_type: req.query.type });
  const filter = parts.length > 1 ? { $and: parts } : parts[0] || {};

  const asked = parseInt(req.query.size, 10);
  const size = PAGE_SIZES.includes(asked) ? asked : PAGE_SIZE;
  const total = await User.countDocuments(filter);
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), pages);
  const users = await User.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * size)
    .limit(size);
  res.json({
    page,
    pages,
    total,
    pageSize: size,
    users: users.map((u) => ({
      id: String(u._id),
      email: u.email,
      nickname: u.nickname,
      user_type: u.user_type,
      createdAt: u.createdAt,
      locked: isAdminEmail(u.email), // ADMIN_EMAIL 계정은 강등 불가
    })),
  });
};

// 하루 단위(KST) 트렌드. 기간 안의 날짜를 0 으로 채워서 돌려준다.
const RANGES = [7, 30, 90];
const DAY = 24 * 60 * 60 * 1000;
const byDay = (field) => ({
  $dateToString: { format: '%Y%m%d', date: field, timezone: 'Asia/Seoul' },
});

const trends = async (req, res) => {
  const requested = Number(req.query.days);
  const days = RANGES.includes(requested) ? requested : 30;
  const now = Date.now();
  const labels = Array.from({ length: days }, (_, i) =>
    kstYmd(new Date(now - (days - 1 - i) * DAY))
  );
  const since = new Date(now - days * DAY);
  const empty = () => new Array(days).fill(0);
  const idx = new Map(labels.map((l, i) => [l, i]));

  const [signups, created, styleRows, runs, before] = await Promise.all([
    User.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: byDay('$createdAt'), n: { $sum: 1 } } },
    ]),
    Draw.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: byDay('$createdAt'), n: { $sum: 1 } } },
    ]),
    Draw.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { day: byDay('$createdAt'), style: '$style' },
          n: { $sum: 1 },
        },
      },
    ]),
    // 추첨 결과의 drawnAt 은 ISO 문자열이라 날짜로 바꿔서 센다
    DrawResult.aggregate([
      { $addFields: { at: { $toDate: '$drawnAt' } } },
      { $match: { at: { $gte: since } } },
      { $group: { _id: byDay('$at'), n: { $sum: 1 } } },
    ]),
    User.countDocuments({ createdAt: { $lt: since } }),
  ]);

  const fill = (rows) => {
    const out = empty();
    rows.forEach((r) => {
      if (idx.has(r._id)) out[idx.get(r._id)] = r.n;
    });
    return out;
  };
  const styles = {};
  styleRows.forEach((r) => {
    if (!idx.has(r._id.day)) return;
    if (!styles[r._id.style]) styles[r._id.style] = empty();
    styles[r._id.style][idx.get(r._id.day)] = r.n;
  });

  res.json({
    days,
    labels,
    signups: fill(signups),
    usersBefore: before, // 기간 시작 전까지의 누적 회원 수 (누적 추이 계산용)
    draws: fill(created),
    runs: fill(runs),
    styles,
  });
};

const updateUser = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 400, '잘못된 요청이에요');
  const type = req.body && req.body.user_type;
  if (type !== 'user' && type !== 'admin')
    return fail(res, 400, 'user_type은 user 또는 admin이어야 해요');
  const target = await User.findById(req.params.id);
  if (!target) return fail(res, 404, '회원을 찾을 수 없어요');
  if (type === 'user') {
    if (String(target._id) === String(req.user._id))
      return fail(res, 400, '자기 자신은 일반 회원으로 바꿀 수 없어요');
    if (isAdminEmail(target.email))
      return fail(res, 400, '기본 관리자 계정은 바꿀 수 없어요');
  }
  target.user_type = type;
  await target.save();
  res.json({ ok: true, user_type: type });
};

module.exports = { summary, listUsers, trends, updateUser };
