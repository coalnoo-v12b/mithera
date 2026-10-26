# 프로젝트 규칙

## 구조
- `client/`: Vite + React (JavaScript)
- `server/`: Express + Mongoose (CommonJS), MongoDB Atlas 사용
- `api/index.js`, `vercel.json`: Vercel 서버리스 배포 설정
- 루트는 npm workspaces로 `client`, `server`를 묶음. Node.js 24.x

## 실행 방법
- 서버: `npm run dev:server` (포트 5000)
- 클라이언트: `npm run dev:client` (포트 5173)
- 테스트/린트: `npm test`, `npm run lint` (루트에서 실행)

## 환경변수
- `server/.env`에 `MONGO_URI`, `PORT`를 둠. **이 파일은 절대 커밋하지 않음.** 예시는 `server/.env.example`
- `PORT`는 5000 유지 (Vite 프록시가 5000을 바라봄)

## Git 규칙 (초보자 기준)
- `main`, `develop`에 직접 push 하지 않음. 모든 변경은 기능 브랜치를 만들고 PR로 병합
- 기능 브랜치는 `develop`에서 만들고, PR 대상도 `develop`
- `develop`을 `main`으로 올리는 것은 PR로 진행 (릴리스 단위)
- 브랜치 이름: `feat/기능명`, `fix/버그명`
- 커밋 전에 `git status`로 올라가는 파일 확인
- Claude에게 커밋·푸시는 사용자가 요청할 때만 수행

## 배포
- Vercel은 `main` 브랜치를 배포. `main`에 머지되면 자동 재배포
- 환경변수(`MONGO_URI` 등)는 Vercel 대시보드에서 직접 관리

## 코드 규칙
- ESLint + Prettier 사용 (작은따옴표, 세미콜론)
- 서버는 `routes → controllers → models` 구조를 따름
