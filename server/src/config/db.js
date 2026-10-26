const mongoose = require('mongoose');

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
    connecting = mongoose.connect(uri).then(() => {
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
