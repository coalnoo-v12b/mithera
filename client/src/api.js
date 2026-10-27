let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/me' && path !== '/login')
      onUnauthorized();
    throw new Error(data.error || '오류가 발생했어요');
  }
  return data;
}

export const STATUS = {
  open: '참여 받는 중',
  closed: '마감됨 · 추첨 대기',
  drawing: '추첨 중',
  drawn: '추첨 완료',
};
export const STYLE_LABEL = {
  wheel: '🎡 룰렛',
  cards: '🃏 카드',
  marbles: '🏁 구슬 레이스',
  ladder: '🪜 사다리타기',
  lotto: '🎱 로또 추첨기',
};

// 방식마다 화면이 자연스럽게 보이는 인원.
// limit: true 면 서버가 막는 최대치 (server/src/utils/lotto.js, roulette.js 의 MAX_* 값과 같아야 한다).
// 구슬 레이스는 권장 인원이라 넘어도 추첨은 되지만 구슬이 작아 이름이 안 보여요. 표가 없는 방식은 안내를 띄우지 않는다.
export const STYLE_CAPACITY = {
  lotto: {
    people: 200,
    winners: 50,
    limit: true,
    why: '인원이 많을수록 공이 작아지고, 당첨자 한 명에 1~2초씩 걸려요',
  },
  wheel: {
    people: 36,
    winners: 10,
    limit: true,
    why: '칸에 이름이 들어가야 해서 36명까지예요. 한 명 뽑을 때마다 공을 새로 굴려요',
  },
  marbles: {
    people: 100,
    winners: 20,
    why: '60명이 넘으면 구슬이 작아져서 이름을 알아보기 어려워요',
  },
};
export const capacityText = (style) => {
  const c = STYLE_CAPACITY[style];
  if (!c) return '';
  return `${c.limit ? '최대' : '권장'} 참여 ${c.people}명 · 당첨 ${c.winners}명`;
};
export const badgeClass = (s) => (s === 'drawing' ? 'closed' : s);
export const fmt = (iso) =>
  new Date(iso).toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
