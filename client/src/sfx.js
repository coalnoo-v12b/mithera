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
// 출격 나팔: 낮은 음에서 높은 음으로 두 번 (성벽 탈환전 기마병)
export const horn = () =>
  [392, 523, 392, 659].forEach((f, i) =>
    setTimeout(() => tone(f, i === 3 ? 0.5 : 0.18, 'sawtooth', 0.05), i * 170)
  );
export const win = () =>
  [523, 659, 784, 1047].forEach((f, i) =>
    setTimeout(() => tone(f, 0.28, 'triangle', 0.08), i * 120)
  );

/* ---------- 3D 추첨기 효과음 (바람, 굴러가는 소리, 부딪히는 소리) ---------- */

function audio() {
  if (!on) return null;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

let noiseBuf = null;
function noise(c) {
  if (!noiseBuf) {
    const len = c.sampleRate * 2;
    noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

const SILENT = { set() {}, stop() {} };

// 계속 나는 소리. kind: 'wind'(바람) | 'roll'(공이 굴러가는 소리)
// set(level 0~1, pitch 0~1) 로 크기와 높낮이를 바꾸고, stop() 으로 끈다.
export function loop(kind) {
  const c = audio();
  if (!c) return SILENT;
  try {
    const src = c.createBufferSource();
    src.buffer = noise(c);
    src.loop = true;
    const filter = c.createBiquadFilter();
    const trem = c.createGain(); // 굴러가는 소리의 덜컹거림
    const out = c.createGain();
    out.gain.value = 0;
    let lfo = null;
    if (kind === 'wind') {
      filter.type = 'bandpass';
      filter.frequency.value = 650;
      filter.Q.value = 0.7;
    } else {
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      filter.Q.value = 1.4;
      lfo = c.createOscillator();
      lfo.frequency.value = 16;
      const depth = c.createGain();
      depth.gain.value = 0.45;
      lfo.connect(depth);
      depth.connect(trem.gain);
      lfo.start();
    }
    src.connect(filter);
    filter.connect(trem);
    trem.connect(out);
    out.connect(c.destination);
    src.start();
    const max = kind === 'wind' ? 0.14 : 0.3;
    return {
      set(level, pitch = 0.5) {
        const t = c.currentTime;
        const v = Math.max(0, Math.min(1, level)) * max;
        out.gain.setTargetAtTime(v, t, 0.08);
        if (kind === 'wind') {
          filter.frequency.setTargetAtTime(450 + pitch * 600, t, 0.25);
        } else {
          filter.frequency.setTargetAtTime(220 + pitch * 700, t, 0.05);
          lfo.frequency.setTargetAtTime(6 + pitch * 34, t, 0.05);
        }
      },
      stop() {
        try {
          const t = c.currentTime;
          out.gain.setTargetAtTime(0, t, 0.05);
          src.stop(t + 0.4);
          if (lfo) lfo.stop(t + 0.4);
        } catch {
          /* 무시 */
        }
      },
    };
  } catch {
    return SILENT;
  }
}

// 공이 칸막이나 받침대에 부딪히는 짧은 "딱" 소리. vol 0~1
let lastClack = 0;
export function clack(vol = 1, pitch = 0.5) {
  const c = audio();
  if (!c) return;
  const now = c.currentTime;
  if (now - lastClack < 0.035) return;
  lastClack = now;
  try {
    const src = c.createBufferSource();
    src.buffer = noise(c);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1400 + pitch * 2200;
    f.Q.value = 3;
    const g = c.createGain();
    const v = 0.22 * Math.max(0.05, Math.min(1, vol));
    g.gain.setValueAtTime(v, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    src.connect(f);
    f.connect(g);
    g.connect(c.destination);
    src.start(now, Math.random());
    src.stop(now + 0.07);
  } catch {
    /* 무시 */
  }
}
