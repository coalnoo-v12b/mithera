const mongoose = require('mongoose');
const lockSchema = require('../utils/lockSchema');

// 추첨 결과: 한 번 저장되면 수정/삭제 불가. 각 결과는 직전 결과의 해시를 포함(해시 체인).
const snapshot = {
  id: { type: String, required: true },
  nickname: { type: String, required: true },
  _id: false,
};

const resultSchema = new mongoose.Schema({
  seq: { type: Number, required: true, unique: true, immutable: true },
  draw: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Draw',
    required: true,
    unique: true,
    immutable: true,
  },
  title: { type: String, required: true, immutable: true },
  participants: { type: [snapshot], immutable: true },
  participantsHash: { type: String, required: true, immutable: true },
  commitment: { type: String, required: true, immutable: true },
  seed: { type: String, required: true, immutable: true },
  algo: { type: String, required: true, immutable: true },
  winnerCount: { type: Number, required: true, immutable: true },
  winners: { type: [snapshot], immutable: true },
  drawnAt: { type: String, required: true, immutable: true }, // ISO 문자열 (해시 재계산 시 형식 고정)
  prevHash: { type: String, required: true, immutable: true },
  // 물리 시뮬레이션(구슬 레이스) 결과에만 있다: 엔진/트랙 버전과 녹화의 해시
  engine: { type: String, immutable: true },
  recordingHash: { type: String, immutable: true },
  hash: { type: String, required: true, immutable: true },
});
lockSchema(resultSchema);

module.exports = mongoose.model('DrawResult', resultSchema);
