const express = require('express');
const cors = require('cors');
const healthRoutes = require('./routes/healthRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/health', healthRoutes);

app.use((req, res) => {
  res.status(404).json({ message: 'Not Found' });
});

app.use((err, req, res, _next) => {
  console.error(err);
  res
    .status(err.status || 500)
    .json({ message: err.message || 'Internal Server Error' });
});

module.exports = app;
