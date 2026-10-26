const mongoose = require('mongoose');

const drawSchema = new mongoose.Schema({
  // 추첨 번호 "yyyymmdd-N" (그날의 N번째). 이름 대신 번호로 찾을 수 있게 한다. 옛 추첨은 scripts/backfill-draw-no.js 로 채운다.
  no: { type: String, unique: true, sparse: true },
  title: { type: String, required: true, trim: true, maxlength: 60 },
  description: { type: String, trim: true, maxlength: 300, default: '' },
  style: {
    type: String,
    enum: ['wheel', 'cards', 'marbles', 'ladder'],
    default: 'wheel',
  },
  winnerCount: { type: Number, required: true, min: 1, max: 100 },
  drawAt: { type: Date, required: true }, // 추첨 예정 일시 (안내용, 실행은 관리자가 직접)
  status: {
    type: String,
    enum: ['open', 'closed', 'drawing', 'drawn'],
    default: 'open',
  },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  createdAt: { type: Date, default: Date.now },
  closedAt: Date,
  // 참여 비밀번호(선택). 해시만 저장하고 조회에서는 빠진다. 화면에는 hasPassword 만 내려준다.
  hasPassword: { type: Boolean, default: false },
  passwordHash: { type: String, select: false },
  // 마감 시 확정. seed 는 추첨 전까지 비공개, commitment(= sha256(seed)) 만 공개.
  seed: { type: String, select: false },
  commitment: String,
  participantsHash: String,
});

module.exports = mongoose.model('Draw', drawSchema);
