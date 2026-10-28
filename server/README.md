# Server

Express 5 + Mongoose 기반 API 서버입니다. 데이터베이스는 MongoDB Atlas를 사용합니다.

## 실행

루트(`E:\vibecoding\40_mithera`)에서 실행합니다.

```bash
npm run dev:server
```

- 코드를 저장하면 자동으로 재시작됩니다 (`node --watch`).
- 정상이면 `MongoDB connected: ...`와 `Server listening on http://localhost:5000`이 출력됩니다.

`server` 폴더에서 직접 실행할 수도 있습니다.

```bash
npm run dev      # 개발 모드 (자동 재시작)
npm start        # 일반 실행
```

## 환경변수

`server/.env`에 설정합니다. 이 파일은 Git에 올리지 않습니다.

| 이름 | 예시 | 설명 |
| --- | --- | --- |
| `PORT` | `5000` | 서버 포트. 클라이언트 프록시가 5000을 바라보므로 그대로 두세요. |
| `MONGO_URI` | `mongodb+srv://...` | Atlas 접속 주소. DB 이름(`/mithera`)을 빼먹지 마세요. |

값의 형식은 `server/.env.example`을 참고하세요.

## API

| 메서드 | 경로 | 설명 | 응답 예시 |
| --- | --- | --- | --- |
| GET | `/api/health` | 서버와 DB 연결 상태 확인 | `{"status":"ok","db":"connected"}` |

없는 경로는 `404`와 `{"message":"Not Found"}`를 반환합니다.

## 테스트와 린트

테스트와 린트는 루트에서 실행합니다.

```bash
npm test          # Jest + Supertest
npm run lint      # ESLint
```

코드 포맷은 `server` 폴더에서 실행합니다.

```bash
cd server
npm run format    # Prettier 적용
```

## 폴더 구조

```
server/
├── src/
│   ├── app.js                    # Express 앱 설정 (listen 하지 않음)
│   ├── server.js                 # 로컬 실행 진입점 (DB 연결 후 listen)
│   ├── config/db.js              # MongoDB 연결 (연결 재사용)
│   ├── routes/healthRoutes.js    # 라우트 정의
│   ├── controllers/              # 요청 처리 로직
│   └── models/                   # Mongoose 모델 (아직 없음)
├── tests/                        # 테스트 파일
├── .env.example                  # 환경변수 예시
└── package.json
```

- Vercel 배포용 진입점은 루트의 `api/index.js`이며, 이 폴더의 `src/app.js`를 불러옵니다.
- 배포와 협업 규칙은 루트 `CLAUDE.md`를 참고하세요.

## 새 API 추가 순서

1. `src/controllers/`에 처리 함수 작성
2. `src/routes/`에 경로 연결
3. `src/app.js`에 라우터 등록 (`/api/...`)
4. `tests/`에 테스트 추가 후 `npm test`
