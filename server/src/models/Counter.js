const mongoose = require('mongoose');
const { kstYmd, formatNo } = require('../utils/drawNo');

// 이름별 일련번호. $inc 한 번으로 올라가서 동시에 여러 명이 만들어도 번호가 겹치지 않는다.
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
});

const Counter = mongoose.model('Counter', counterSchema);

// 다음 추첨 번호 "yyyymmdd-N". 날짜마다 카운터가 따로라서 그날 첫 추첨이 1번이다.
Counter.nextDrawNo = async (at = new Date()) => {
  const ymd = kstYmd(at);
  const c = await Counter.findOneAndUpdate(
    { _id: `draw:${ymd}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return formatNo(ymd, c.seq);
};

module.exports = Counter;
