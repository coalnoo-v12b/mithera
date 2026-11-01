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
//   | 'rain'(빗소리) | 'steps'(여럿이 달리는 발소리) | 'horde'(좀비 떼 신음)
// set(level 0~1, pitch 0~1) 로 크기와 높낮이를 바꾸고, stop() 으로 끈다.
export function loop(kind) {
  const c = audio();
  if (!c) return SILENT;
  if (kind === 'horde') return hordeLoop(c);
  if (kind === 'rain' || kind === 'steps') return noiseLoop(c, kind);
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

/* ---------- 좀비 탈출 효과음 (파일 없이 만든 소리) ---------- */

// 소리를 끄고 켤 때 부드럽게 (딸깍거리지 않게)
function fadeOut(c, out, nodes) {
  try {
    const t = c.currentTime;
    out.gain.setTargetAtTime(0, t, 0.05);
    nodes.forEach((n) => n.stop(t + 0.4));
  } catch {
    /* 무시 */
  }
}

// 빗소리(높은 쏴아 소리)와 여럿이 달리는 발소리(낮은 소리가 박자 없이 타닥타닥)
function noiseLoop(c, kind) {
  try {
    const src = c.createBufferSource();
    src.buffer = noise(c);
    src.loop = true;
    const out = c.createGain();
    out.gain.value = 0;
    const stops = [src];
    let lfos = [];
    if (kind === 'rain') {
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1100;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 7000;
      src.connect(hp);
      hp.connect(lp);
      lp.connect(out);
    } else {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 240;
      bp.Q.value = 0.9;
      const trem = c.createGain();
      trem.gain.value = 0.4;
      // 박자가 다른 두 발걸음이 섞여 여럿이 달리는 소리처럼 들린다
      lfos = [7.1, 4.3].map((f, k) => {
        const lfo = c.createOscillator();
        lfo.type = 'square';
        lfo.frequency.value = f;
        const depth = c.createGain();
        depth.gain.value = k ? 0.25 : 0.35;
        lfo.connect(depth);
        depth.connect(trem.gain);
        lfo.start();
        stops.push(lfo);
        return lfo;
      });
      src.connect(bp);
      bp.connect(trem);
      trem.connect(out);
    }
    out.connect(c.destination);
    src.start();
    const max = kind === 'rain' ? 0.16 : 0.55;
    return {
      set(level, pitch = 0.5) {
        const t = c.currentTime;
        out.gain.setTargetAtTime(
          Math.max(0, Math.min(1, level)) * max,
          t,
          0.12
        );
        lfos.forEach((l, k) =>
          l.frequency.setTargetAtTime(
            (k ? 3.6 : 6) + pitch * (k ? 3 : 5),
            t,
            0.2
          )
        );
      },
      stop: () => fadeOut(c, out, stops),
    };
  } catch {
    return SILENT;
  }
}

// 좀비 떼의 웅얼거리는 신음: 낮은 목소리 여럿이 천천히 흔들리며 "으어어" 소리를 낸다
function hordeLoop(c) {
  try {
    const out = c.createGain();
    out.gain.value = 0;
    const formant = c.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.value = 520;
    formant.Q.value = 2;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1300;
    const swell = c.createGain(); // 숨 쉬듯 커졌다 작아졌다
    swell.gain.value = 0.65;
    const amp = c.createOscillator();
    amp.frequency.value = 0.35;
    const ampDepth = c.createGain();
    ampDepth.gain.value = 0.35;
    amp.connect(ampDepth);
    ampDepth.connect(swell.gain);
    const stops = [amp];
    [82, 97, 109, 131].forEach((f, k) => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const vib = c.createOscillator();
      vib.frequency.value = 0.23 + k * 0.13;
      const vibDepth = c.createGain();
      vibDepth.gain.value = 4 + k * 1.2;
      vib.connect(vibDepth);
      vibDepth.connect(o.frequency);
      o.connect(formant);
      o.start();
      vib.start();
      stops.push(o, vib);
    });
    formant.connect(lp);
    lp.connect(swell);
    swell.connect(out);
    out.connect(c.destination);
    amp.start();
    return {
      set(level, pitch = 0.5) {
        const t = c.currentTime;
        out.gain.setTargetAtTime(
          Math.max(0, Math.min(1, level)) * 0.09,
          t,
          0.3
        );
        formant.frequency.setTargetAtTime(420 + pitch * 300, t, 0.3);
      },
      stop: () => fadeOut(c, out, stops),
    };
  } catch {
    return SILENT;
  }
}

// 짧은 소리 하나: 너무 잦으면 건너뛰고(gap 초), build(c, t, out) 가 소리를 만든다
const lastShort = {};
function short(key, gap, vol, build) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  if (lastShort[key] !== undefined && t - lastShort[key] < gap) return;
  lastShort[key] = t;
  try {
    const out = c.createGain();
    out.gain.value = vol;
    out.connect(c.destination);
    build(c, t, out);
  } catch {
    /* 무시 */
  }
}
// 소리 조각: type 파형이 f0 에서 f1 로 dur 동안 미끄러지고, 크기는 vol 에서 사라진다
function sweep(
  c,
  t,
  out,
  { type = 'sine', f0, f1, dur, vol, attack = 0.005, filter }
) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  if (filter) {
    g.connect(filter);
    filter.connect(out);
  } else g.connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
  return o;
}
function burst(c, t, out, { type = 'bandpass', freq, q = 1, dur, vol }) {
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(out);
  src.start(t, Math.random());
  src.stop(t + dur + 0.02);
}
function formant(c, freq, q) {
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

// 물감탄 발사 "퓽"
export const pew = () =>
  short('pew', 0.07, 1, (c, t, out) => {
    sweep(c, t, out, {
      type: 'triangle',
      f0: 1500,
      f1: 380,
      dur: 0.09,
      vol: 0.05,
    });
    burst(c, t, out, { type: 'highpass', freq: 3000, dur: 0.05, vol: 0.05 });
  });
// 물감이 터지는 "철퍽" (맞으면 크게, 빗나가 길바닥에 떨어지면 작게)
export const splat = (vol = 1) =>
  short('splat', 0.08, vol, (c, t, out) => {
    burst(c, t, out, { freq: 520, q: 0.8, dur: 0.16, vol: 0.32 });
    sweep(c, t, out, { f0: 180, f1: 80, dur: 0.09, vol: 0.06 });
  });
// 좀비가 덮칠 때 "으어!"
export const lunge = () =>
  short('lunge', 0.2, 1, (c, t, out) => {
    const o = sweep(c, t, out, {
      type: 'sawtooth',
      f0: 170,
      f1: 118,
      dur: 0.42,
      vol: 0.085,
      attack: 0.03,
      filter: formant(c, 620, 3),
    });
    const vib = c.createOscillator();
    vib.frequency.value = 11;
    const depth = c.createGain();
    depth.gain.value = 7;
    vib.connect(depth);
    depth.connect(o.frequency);
    vib.start(t);
    vib.stop(t + 0.45);
  });
// 물리는 소리 "콱" (만화처럼 짧게: 퍽 하는 울림과 아삭 소리)
export const chomp = () =>
  short('chomp', 0.22, 1, (c, t, out) => {
    burst(c, t, out, { type: 'lowpass', freq: 1600, dur: 0.06, vol: 0.32 });
    sweep(c, t, out, { f0: 150, f1: 55, dur: 0.14, vol: 0.2 });
    burst(c, t + 0.06, out, { freq: 2600, q: 2, dur: 0.05, vol: 0.14 });
  });
// 물려서 좀비가 되어 가는 신음 "으어어어"
export const groan = () =>
  short('groan', 0.35, 1, (c, t, out) => {
    const o = sweep(c, t, out, {
      type: 'sawtooth',
      f0: 140,
      f1: 85,
      dur: 0.9,
      vol: 0.07,
      attack: 0.1,
      filter: formant(c, 450, 3),
    });
    const vib = c.createOscillator();
    vib.frequency.value = 5;
    const depth = c.createGain();
    depth.gain.value = 5;
    vib.connect(depth);
    depth.connect(o.frequency);
    vib.start(t);
    vib.stop(t + 0.95);
  });
// 경찰이 구했을 때 "띠링"
export const chime = () =>
  short('chime', 0.12, 1, (c, t, out) => {
    sweep(c, t, out, { f0: 1319, f1: 1318, dur: 0.16, vol: 0.06 });
    sweep(c, t + 0.08, out, { f0: 1760, f1: 1759, dur: 0.22, vol: 0.06 });
  });
// 생존선을 넘었을 때 환호 "와아!"
export const yay = () =>
  short('yay', 0.14, 1, (c, t, out) => {
    const src = c.createBufferSource();
    src.buffer = noise(c);
    const f = formant(c, 900, 1.2);
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(1600, t + 0.35);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t, Math.random());
    src.stop(t + 0.6);
    sweep(c, t, out, {
      type: 'triangle',
      f0: 660,
      f1: 990,
      dur: 0.18,
      vol: 0.04,
    });
  });
// 셔터가 올라갈 때 경보 사이렌 (높낮이가 오르내리는 소리 두 번)
export const siren = () =>
  short('siren', 2, 1, (c, t, out) => {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(650, t);
    for (let k = 0; k < 2; k++) {
      o.frequency.linearRampToValueAtTime(1000, t + k * 1.2 + 0.6);
      o.frequency.linearRampToValueAtTime(650, t + k * 1.2 + 1.2);
    }
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.08);
    g.gain.setValueAtTime(0.05, t + 2.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.45);
    o.connect(lp);
    lp.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 2.5);
  });
