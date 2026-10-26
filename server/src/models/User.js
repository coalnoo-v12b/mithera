const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  nickname: { type: String, required: true, trim: true, maxlength: 20 },
  passwordHash: { type: String, required: true },
  user_type: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
    required: true,
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', userSchema);
