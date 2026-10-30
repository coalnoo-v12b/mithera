# 인증 결정 기록 및 배포 체크리스트

이 문서는 로그인·계정 관련해서 정한 내용과, 배포 전에 확인할 항목을 모아 둔 것입니다. 결정이 바뀌면 이 문서도 함께 고쳐 주세요.

## 1. 계정 정책 결정

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| 같은 이메일의 계정 합치기 | 하지 않음 | 이메일 가입은 이메일 인증을 하지 않아서, 자동 합치기는 계정 탈취 위험이 있음 |
| 구글 이메일이 기존 계정과 같을 때 | 이메일을 비우고 새 계정 생성 | 합치지 않는 정책에 따름. 구글 이메일은 `email_verified`가 true일 때만 저장 |
| 네이버 이메일 | 저장하지 않음 | 네이버는 이메일 인증 여부를 알려주지 않음 |
| 이메일 가입 시 이메일 인증 | 현재 없음 | 자동 합치기를 하려면 먼저 필요. 도입 시 이 항목을 갱신 |
| 카카오 로그인 | 보류 (버튼만 비활성) | 콘솔에서 localhost 주소가 거부됨. 배포 주소(https)가 생겼으니 재시도 가능. 서버 코드도 아직 없음 |
| 마지막 로그인 방식 | DB가 아니라 `last_login` 쿠키에 저장 | 로그인 전에는 사용자를 알 수 없고, 브라우저별 표시로 충분함 |

### 계정 연결(로그인한 상태에서 연결) 관련

- 방식은 "내 계정" 페이지에서 로그인한 사용자가 직접 구글·네이버를 연결하는 방향(B안)으로 정했습니다.
- 통합 작업은 보류 상태입니다. 연결 기능을 시작하기 전에 팀과 함께 확인하세요.

## 2. 배포 체크리스트

배포 주소는 `https://mithera.vercel.app`입니다 (2026-10-30 첫 배포). 체크한 항목은 그날 확인한 것입니다.

### Vercel 환경변수 (Production)

- [x] `MONGO_URI`: Atlas 접속 주소 (DB 이름 `/mithera` 포함). `/api/health`에서 `db: connected` 확인
- [x] `JWT_SECRET`: 배포용으로 새로 생성 (로컬 값과 다름. 공개되면 안 됨)
- [x] `ADMIN_EMAIL`: 리더 이메일
- [x] `CLIENT_URL`: `https://mithera.vercel.app` (끝에 `/` 없이)
- [x] `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`: `https://mithera.vercel.app/api/auth/google/callback`
- [x] `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `NAVER_REDIRECT_URI`: `https://mithera.vercel.app/api/auth/naver/callback`

환경변수를 바꾸면 Vercel에서 **Redeploy**를 해야 반영됩니다.

### 외부 서비스 설정

- [x] MongoDB Atlas → Network Access: Vercel에서 접속되는 것 확인 (Vercel IP는 고정이 아님)
- [x] 구글 콘솔 → 승인된 리디렉션 URI에 배포 콜백 주소 추가 (로컬 `http://localhost:5000/...` 주소도 유지)
- [x] 구글 OAuth 동의 화면: 프로덕션으로 게시 (자세한 내용은 아래 "로그인 제공자별 상태")
- [x] 네이버 개발자센터 → Callback URL에 배포 콜백 주소 추가, 서비스 URL을 배포 주소로 변경
- [ ] 카카오 콘솔 → 리다이렉트 URI와 Web 도메인을 https 배포 주소로 등록 (보류 해제 시)

### 배포 후 확인

- [x] `https://mithera.vercel.app/api/health` → `{"status":"ok","db":"connected"}`
- [x] 네이버 로그인 성공 (테스터 계정)
- [x] 구글 로그인 성공 (테스트 사용자가 아닌 계정으로)
- [x] DB에 `providers` 저장 확인 (구글 2개, 네이버 1개 계정)
- [x] 로그인 화면 뱃지와 `last_login` 쿠키 동작 확인

> 배포 사이트와 로컬 개발 서버는 **같은 DB**(`mithera`)를 씁니다 (2026-10-30 `/api/public-stats` 값이 같은 것으로 확인). 로컬에서 만든 추첨·계정이 배포 사이트에도 그대로 보입니다.

### 로그인 제공자별 상태

| 제공자 | 상태 | 누가 로그인할 수 있나 | 메모 |
| --- | --- | --- | --- |
| 이메일 | 사용 중 | 누구나 | |
| 구글 | 프로덕션 | 누구나 | 앱 로고 없이 게시. 로고를 올리면 구글 브랜드 인증 심사가 필요해짐 |
| 네이버 | 개발 중 (검수 전) | 멤버관리에 등록한 네이버 아이디만 | 팀원은 멤버관리 → 테스터 ID 등록. 일반 공개는 검수 요청 필요 |
| 카카오 | 보류 | 없음 (버튼 비활성) | 서버 코드 없음. 콘솔 등록부터 다시 시작 |

- **구글 동의 화면:** 브랜딩에 홈페이지(`https://mithera.vercel.app`), 개인정보처리방침, 서비스 약관 링크, 승인된 도메인(`mithera.vercel.app`)을 넣어야 "앱 게시" 버튼이 활성화됐습니다.
- **네이버 제공 정보:** 이름 또는 별명만 받습니다. 이메일은 저장하지 않으므로 요청하지 않습니다.
- **네이버 서비스 URL:** 배포 주소로 바꿨습니다. 로컬에서 네이버 로그인이 안 되면 로컬 개발용 앱을 따로 만드는 것을 검토하세요.
- **개인정보처리방침·이용약관:** `https://mithera.vercel.app/#/privacy`, `https://mithera.vercel.app/#/terms` (`client/src/pages/Legal.jsx`). 수집 항목이나 쿠키를 바꾸면 이 페이지와 시행일도 함께 고쳐 주세요.

## 3. 관리자 권한 메모

- `ADMIN_EMAIL`은 **자동 승격**에만 쓰입니다. 회원가입·로그인할 때 이 이메일이면 `admin`이 됩니다.
- 관리자 화면에서 일반 사용자를 `admin`으로 바꿀 수도 있습니다. 이 경우 `ADMIN_EMAIL`과 무관합니다.
- `ADMIN_EMAIL` 계정은 관리자 화면에서 강등할 수 없습니다 (`locked`).
- 현재 DB의 관리자는 4명인데, `ADMIN_EMAIL` 기준은 1명이므로 나머지 3명은 관리자 화면에서 지정된 것으로 보입니다. 확인이 필요합니다.
- 배포 DB에도 같은 확인을 해 주세요.

## 4. 로그인 화면 페이지

로그인 화면은 세 가지 주소로 볼 수 있습니다. 앱이 HashRouter를 쓰므로 주소 중간에 `#`이 들어갑니다 (예: `http://localhost:5173/#/login-old`). 세 페이지 모두 실제 로그인이 동작합니다.

| 주소 | 파일 | 용도 |
| --- | --- | --- |
| `/#/login` | `client/src/pages/Auth.jsx` | 현재 로그인 화면. 왼쪽(모바일은 위)에 15초 쇼츠 "미더라 기사와 현실 종자", 오른쪽에 로그인 폼 |
| `/#/login-vox` | `client/src/pages/AuthVox.jsx` | 쇼츠를 붙여 실험하던 복사본. 지금은 `/login`과 같은 화면 |
| `/#/login-old` | `client/src/pages/AuthOld.jsx` | 쇼츠를 넣기 전의 기존 로그인 화면 보관본 |

- `/login-vox`, `/login-old`는 화면 어디에도 링크가 없어서 주소를 직접 입력해야 들어갈 수 있습니다. 로그인한 상태에서도 열립니다.
- 세 파일은 로그인 로직을 각자 복사해 갖고 있습니다. 로그인 동작을 고칠 때는 세 파일을 함께 고치거나, 실험이 끝난 페이지를 지워 주세요.
- 쇼츠는 `client/src/components/KnightSkit.jsx`, `KnightSkit.css`에 있고, 캐릭터 이미지는 `client/public/characters/`에 있습니다. 동영상이 아니라 CSS 애니메이션입니다.
- 운영체제에서 "애니메이션 효과 끄기(움직임 줄이기)"가 켜져 있으면 쇼츠가 자동 재생되지 않고 "▶ 쇼츠 보기" 버튼이 나옵니다. 원격 데스크톱 환경에서 자주 켜져 있습니다.

## 5. 관련 문서

- `docs/pr-review-guide.md`: PR 리뷰 방법
- `docs/sns-login-guide.pdf`: 구글·네이버 설정 가이드, 카카오 보류 기록
- `docs/db-schema-changes.pdf`: users 컬렉션 스키마 변경 정리
