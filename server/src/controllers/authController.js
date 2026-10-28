const bcrypt = require('bcryptjs');
const { User } = require('../models');
const {
  isAdminEmail,
  publicUser,
  syncUserType,
  setAuthCookie,
} = require('../utils/auth');
const { fail } = require('../utils/http');

const signup = async (req, res) => {
  const body = req.body || {};
  const email = String(body.email || '')
    .trim()
    .toLowerCase();
  const password = String(body.password || '');
  const nickname = String(body.nickname || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return fail(res, 400, '이메일 형식이 올바르지 않아요');
  if (password.length < 8)
    return fail(res, 400, '비밀번호는 8자 이상이어야 해요');
  if (!nickname || nickname.length > 20)
    return fail(res, 400, '닉네임은 1~20자로 입력해줘');
  if (await User.exists({ email }))
    return fail(res, 409, '이미 가입된 이메일이에요');
  const user = await User.create({
    email,
    nickname,
    passwordHash: await bcrypt.hash(password, 10),
    user_type: isAdminEmail(email) ? 'admin' : 'user',
  });
  setAuthCookie(res, user);
  res.json({ user: publicUser(user) });
};

const login = async (req, res) => {
  const body = req.body || {};
  const email = String(body.email || '')
    .trim()
    .toLowerCase();
  const password = String(body.password || '');
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.passwordHash)))
    return fail(res, 401, '이메일 또는 비밀번호가 맞지 않아요');
  await syncUserType(user);
  setAuthCookie(res, user);
  res.json({ user: publicUser(user) });
};

const logout = (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
};

const me = (req, res) => {
  res.json({ user: publicUser(req.user) });
};

module.exports = { signup, login, logout, me };
