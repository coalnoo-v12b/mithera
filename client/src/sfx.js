// 효과음 (WebAudio, 파일 없이 생성). 설정은 이 브라우저에만 저장된다.
let ctx = null;
let on = true;
try {
  on = localStorage.getItem('midura-sound') !== 'off';
} catch {
  /* 무시 */
}

export const isSoundOn = () => on;
export function setSoundOn(v) {
  on = v;
  try {
    localStorage.setItem('midura-sound', v ? 'on' : 'off');
  } catch {
    /* 무시 */
  }
}

function tone(freq, dur, type = 'square', vol = 0.04) {
  if (!on) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + dur);
  } catch {
    /* 무시 */
  }
}

export const tick = () => tone(900, 0.04);
export const pop = () => tone(660, 0.12, 'triangle', 0.07);
export const win = () =>
  [523, 659, 784, 1047].forEach((f, i) =>
    setTimeout(() => tone(f, 0.28, 'triangle', 0.08), i * 120)
  );
