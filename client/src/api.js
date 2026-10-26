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
