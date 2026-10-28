const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // 이메일 가입은 필수로 받지만, 소셜 로그인은 이메일을 주지 않을 수 있어서 선택 항목
  email: {
    type: String,
    unique: true,
    sparse: true,
    lowercase: true,
    trim: true,
  },
  nickname: { type: String, required: true, trim: true, maxlength: 20 },
  // 소셜 로그인만 쓰는 계정은 비밀번호가 없음
  passwordHash: { type: String },
  // 연결된 소셜 계정 (한 사람이 여러 제공자를 가질 수 있음)
  providers: [
    {
      _id: false,
      provider: {
        type: String,
        enum: ['google', 'kakao', 'naver'],
        required: true,
      },
      providerId: { type: String, required: true },
    },
  ],
  user_type: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
    required: true,
  },
  createdAt: { type: Date, default: Date.now },
});

// 같은 제공자의 같은 계정은 한 번만 연결되도록
userSchema.index(
  { 'providers.provider': 1, 'providers.providerId': 1 },
  { unique: true, sparse: true }
);

module.exports = mongoose.model('User', userSchema);
