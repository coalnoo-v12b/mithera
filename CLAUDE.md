# 프로젝트 규칙

## 팀
- 리더: `cswkr8153`
- 스크럼마스터: `iwsong7tech`
- 팀원: `guwon0624-rgb`

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
- `main`, `develop`에 직접 push 하지 않음. 모든 변경은 본인 작업 브랜치에서 PR로 병합
- 작업 브랜치: `feat-iws`, `feat-guwon`, `feat-csw` (본인 것만 사용)
- 작업 브랜치의 PR 대상은 `develop`, `develop`을 `main`으로 올리는 것은 PR로 진행 (릴리스 단위)
- PR 리뷰 방법과 브랜치 흐름은 `docs/pr-review-guide.md` 참고
- 커밋 전에 `git status`로 올라가는 파일 확인
- Claude에게 커밋·푸시는 사용자가 요청할 때만 수행

## 이슈 규칙
- 할 일은 GitHub Issues로 관리. 계획 문서에 할 일 목록을 적지 않음
- 이슈 제목: 동사로 시작하는 짧은 문장 (예: "회원가입 API 추가")
- 이슈 본문에 세 가지를 적음: 목표(무엇을), 완료 기준(어떻게 되면 끝인지), 담당자
- 작업을 시작하면 본인을 담당자로 지정
- 작업 브랜치는 개인 브랜치를 사용하므로 이슈 번호는 브랜치 이름이 아니라 PR 본문에 적음
- PR 본문에 `Closes #번호`를 적어서 머지되면 이슈가 자동으로 닫히게 함
- 한 이슈는 한 PR로 끝나도록 작게 나눔

## 배포
- Vercel은 `main` 브랜치를 배포. `main`에 머지되면 자동 재배포
- 환경변수(`MONGO_URI` 등)는 Vercel 대시보드에서 직접 관리

## 코드 규칙
- ESLint + Prettier 사용 (작은따옴표, 세미콜론)
- 서버는 `routes → controllers → models` 구조를 따름
