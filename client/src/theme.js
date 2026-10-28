// 'light' | 'dark' | null(시스템 설정 따름). 이 브라우저에만 저장.
export function getTheme() {
  try {
    return localStorage.getItem('midura-theme');
  } catch {
    return null;
  }
}
export function applyTheme(t) {
  if (t) document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
}
export function setTheme(t) {
  try {
    localStorage.setItem('midura-theme', t);
  } catch {
    /* 무시 */
  }
  applyTheme(t);
}
export const isDark = () =>
  getTheme()
    ? getTheme() === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
