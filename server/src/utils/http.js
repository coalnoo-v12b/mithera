const mongoose = require('mongoose');

const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);

const fail = (res, code, error) => res.status(code).json({ error });

// 500 응답에는 원인 종류만 괄호로 알려준다 (비밀번호나 주소 같은 세부 내용은 노출하지 않는다)
const dbErrorCode = (err) => {
  const msg = String((err && err.message) || '');
  if (/bad auth|authentication failed/i.test(msg)) return 'DB_AUTH';
  if (
    /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|Server selection timed out|Could not connect to any servers|whitelist|buffering timed out/i.test(
      msg
    )
  ) {
    return 'DB_NETWORK';
  }
  return '';
};

module.exports = { isId, fail, dbErrorCode };
