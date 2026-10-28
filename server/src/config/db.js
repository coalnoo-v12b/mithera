const mongoose = require('mongoose');
const models = require('../models');

let connecting = null;

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set');
  }

  if (!connecting) {
    connecting = mongoose
      .connect(uri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 })
      // unique 인덱스(결과 seq 등)가 만들어진 뒤에 요청을 받도록 기다린다
      .then(() => Promise.all(Object.values(models).map((m) => m.init())))
      .then(() => {
        console.log(
          `MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`
        );
      });
    connecting.catch(() => {
      connecting = null;
    });
  }

  await connecting;
};

module.exports = connectDB;
