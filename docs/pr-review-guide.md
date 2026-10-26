# PR 리뷰 가이드

## 브랜치 구조

| 브랜치 | 용도 | 누가 머지하나 |
| --- | --- | --- |
| `main` | 배포 브랜치 (Vercel이 여기를 배포) | 리더 (`cswkr8153`) |
| `develop` | 통합 브랜치 (팀 작업이 모이는 곳) | PR 리뷰 후 머지 |
| `feat-iws` | 작업자 개인 브랜치 | 본인이 `develop`으로 PR |
| `feat-guwon` | 작업자 개인 브랜치 | 본인이 `develop`으로 PR |
| `feat-csw` | 작업자 개인 브랜치 | 본인이 `develop`으로 PR |

흐름은 다음과 같습니다.

```
feat-본인 ──PR──▶ develop ──PR──▶ main (배포)
```

- `main`, `develop`에는 직접 푸시하지 않습니다.
- 작업은 항상 본인의 `feat-...` 브랜치에서 합니다.
- `develop`을 `main`으로 올리는 PR은 리더가 확인하고 머지합니다.

## 작업 시작 전 (매번)

작업을 시작하기 전에 본인 브랜치를 `develop`의 최신 내용과 맞춥니다.

```bash
git switch feat-iws          # 본인 브랜치로 이동
git fetch origin
git merge origin/develop        # develop의 최신 변경을 가져옴
```

`feat-iws` 부분은 본인 브랜치 이름으로 바꿔서 입력하세요.

## 작업 후 PR 올리기

```bash
git add <파일>
git commit -m "작업 내용 요약"
git push origin feat-iws
```

그다음 GitHub에서 PR을 엽니다.

- **base(받는 쪽):** `develop`
- **compare(보내는 쪽):** `feat-iws`
- **제목:** 동사로 시작하는 짧은 문장
- **본문:** 작업 내용과 관련 이슈. 이슈를 자동으로 닫으려면 `Closes #번호`를 적습니다.

## PR 리뷰하기

리뷰어는 작성자가 아닌 팀원입니다.

### 1. PR 번호 확인
- GitHub의 `Pull requests` 탭에서 `#12`처럼 번호를 확인합니다.
- 터미널에서는 `gh pr list`로 볼 수 있습니다.

### 2. PR 브랜치를 로컬로 가져오기
리뷰 전에 작업 중인 변경 사항이 있으면 먼저 커밋하거나 임시 저장합니다.

```bash
git status
git stash        # 필요할 때만. 나중에 git stash pop으로 복구
```

**권장: 임시 브랜치로 가져오기**
```bash
git fetch origin pull/12/head:pr-12
git checkout pr-12
```

`pr-12`는 리뷰용 임시 이름입니다. 본인 브랜치 이름과 겹치지 않으므로 안전합니다.

> **주의:** `gh pr checkout 12`는 PR의 원래 브랜치 이름(예: `feat-iws`)으로 로컬 브랜치를 만듭니다. 그 이름의 브랜치를 본인이 쓰고 있다면 충돌하니 사용하지 마세요.

### 3. `/code-review` 실행
가져온 브랜치에서 Claude Code를 열고 입력합니다.

```
/code-review
```

결과는 터미널에만 보이고 GitHub에는 올라가지 않습니다. 내용을 읽고 필요한 것만 댓글로 남기세요.

### 4. GitHub PR에 댓글 남기기

**웹에서 직접 (권장)**
- `Files changed` 탭에서 줄 번호 옆의 `+`를 눌러 줄 단위 댓글을 씁니다.
- 전체 의견은 `Conversation` 탭의 입력창에 씁니다.
- 승인이나 수정 요청은 `Files changed` 오른쪽 위의 `Review changes`에서 고릅니다.

**터미널에서 (GitHub CLI 필요)**
```bash
gh pr comment 12 --body "전체 의견 내용"
gh pr review 12 --approve
gh pr review 12 --request-changes --body "수정이 필요한 이유"
```

### 5. 원래 브랜치로 돌아가기
```bash
git switch feat-guwon        # 본인 브랜치로 복귀 (리뷰어 본인 이름으로)
```

임시 브랜치를 지우려면:
```bash
git branch -D pr-12
```

`git stash`를 했다면 복구합니다.
```bash
git stash pop
```

## 머지 규칙

| PR | 대상 | 리뷰 | 머지 |
| --- | --- | --- | --- |
| `feat-...` → `develop` | `develop` | 팀원 1명 이상 | 작성자 또는 리뷰어 |
| `develop` → `main` | `main` | 리더 확인 | 리더 |

- 머지 후 작성자는 본인 브랜치를 `develop`의 최신 내용과 다시 맞춘 뒤 작업을 이어갑니다. ([작업 시작 전](#작업-시작-전-매번) 참고)
- 리뷰에서 수정 요청을 받으면 같은 브랜치에 커밋을 추가로 푸시하면 PR에 자동 반영됩니다.

## 자주 하는 실수

- **`develop`이나 `main`에 직접 작업하기:** 항상 본인 `feat-...` 브랜치에서 작업하세요.
- **다른 사람의 `feat-...` 브랜치에 푸시하기:** 각자 본인 브랜치에만 푸시하세요.
- **작업 시작 전에 `develop` 동기화를 안 하기:** 오래된 상태에서 작업하면 나중에 충돌이 커집니다.
- **`git stash`를 두고 잊어버리기:** `git stash list`로 확인하고 필요한 것은 `git stash pop`으로 복구하세요.
