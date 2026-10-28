const mongoose = require('mongoose');
const lockSchema = require('../utils/lockSchema');

// 구슬 레이스 녹화(모든 구슬의 움직임). 결과와 마찬가지로 저장 후 수정/삭제할 수 없다.
const recordingSchema = new mongoose.Schema({
  draw: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Draw',
    required: true,
    unique: true,
    immutable: true,
  },
  raw: { type: String, required: true, immutable: true },
  hash: { type: String, required: true, immutable: true },
});
lockSchema(recordingSchema);

module.exports = mongoose.model('RaceRecording', recordingSchema);
