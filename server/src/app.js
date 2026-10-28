const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const drawRoutes = require('./routes/drawRoutes');
const resultRoutes = require('./routes/resultRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { dbErrorCode } = require('./utils/http');

const app = express();

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());

app.use('/api/health', healthRoutes);
app.use('/api/draws', drawRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', authRoutes);
app.use('/api', resultRoutes);
// 개발용 실험 화면. 배포(Vercel)에서는 열지 않는다.
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.use('/api/lab', require('./routes/labRoutes'));
}

app.use((req, res) => {
  res.status(404).json({ message: 'Not Found' });
});

app.use((err, req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  // 클라이언트 오류는 메시지를 그대로, 서버 오류는 세부 내용을 숨기고 DB 원인 종류만 알려준다
  const code = dbErrorCode(err);
  const message =
    status < 500
      ? err.message
      : `서버 오류가 발생했어요${code ? ` (${code})` : ''}`;
  res.status(status).json({ error: message, message });
});

module.exports = app;
