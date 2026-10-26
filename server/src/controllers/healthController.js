const mongoose = require('mongoose');

const getHealth = (req, res) => {
  const dbState =
    mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.json({ status: 'ok', db: dbState });
};

module.exports = { getHealth };
