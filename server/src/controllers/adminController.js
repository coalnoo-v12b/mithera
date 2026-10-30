const { User, Draw, DrawResult } = require('../models');
const { isAdminEmail } = require('../utils/auth');
const { isId, fail } = require('../utils/http');

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

const listUsers = async (req, res) => {
  const q = String(req.query.q || '')
    .trim()
    .slice(0, 50);
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter = q
    ? {
        $or: [
          { email: new RegExp(esc, 'i') },
          { nickname: new RegExp(esc, 'i') },
        ],
      }
    : {};
  const users = await User.find(filter).sort({ createdAt: -1 }).limit(200);
  res.json({
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

module.exports = { summary, listUsers, updateUser };
