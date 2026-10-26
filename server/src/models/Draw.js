const mongoose = require('mongoose');

const drawSchema = new mongoose.Schema({
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
  // 마감 시 확정. seed 는 추첨 전까지 비공개, commitment(= sha256(seed)) 만 공개.
  seed: { type: String, select: false },
  commitment: String,
  participantsHash: String,
});

module.exports = mongoose.model('Draw', drawSchema);
