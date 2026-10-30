import { useEffect, useRef, useState } from 'react';
import { sleep } from '../api.js';
import { pop, tick } from '../sfx.js';
import { makeRungs, walk } from '../ladder.js';

const COLORS = [
  '#6366f1',
  '#f59e0b',
  '#10b981',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#8b5cf6',
  '#ef4444',
];
const COL = 56,
  PAD = 28,
  H = 440,
  TOPY = 64,
  BOTY = H - 64;
const TAU = Math.PI * 2;

// 사다리 가로줄은 무작위로 그리고, 도착 칸의 당첨/꽝은 서버가 정한 결과에 맞춰 붙인다.
// 그래서 어느 줄에서 출발해도 당첨자는 반드시 "당첨" 칸에 도착한다.
export default function Ladder({ result, runKey, onDone }) {
  const ref = useRef(null);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  const [banner, setBanner] = useState('');
  const parts = result.participants;
  const n = parts.length;
  const width = Math.max(320, PAD * 2 + (n - 1) * COL);

  useEffect(() => {
    const ctx = ref.current.getContext('2d');
    const cancel = { v: false };
    const levels = Math.min(28, Math.max(10, n * 2 + 4));
    const rungs = makeRungs(n, levels);
    const xs = Array.from({ length: n }, (_, c) =>
      n === 1 ? width / 2 : PAD + c * ((width - PAD * 2) / (n - 1))
    );
    const yOf = (l) => TOPY + ((l + 1) * (BOTY - TOPY)) / (levels + 1);
    const winIdx = result.winners.map((w) =>
      parts.findIndex((p) => p.id === w.id)
    );
    const winSet = new Set(winIdx);
    const ends = parts.map((_, s) => walk(s, rungs).end);
    const slotWin = Array(n).fill(false);
    ends.forEach((e, s) => {
      if (winSet.has(s)) slotWin[e] = true;
    });

    const pathOf = (s) => {
      const pts = [{ x: xs[s], y: TOPY }];
      let c = s;
      rungs.forEach((set, l) => {
        const y = yOf(l);
        if (set.has(c)) {
          pts.push({ x: xs[c], y }, { x: xs[c + 1], y });
          c += 1;
        } else if (set.has(c - 1)) {
          pts.push({ x: xs[c], y }, { x: xs[c - 1], y });
          c -= 1;
        }
      });
      pts.push({ x: xs[c], y: BOTY });
      return pts;
    };
    const lenOf = (pts) =>
      pts
        .slice(1)
        .reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
    const upTo = (pts, d) => {
      const out = [pts[0]];
      let left = d;
      for (let i = 1; i < pts.length; i++) {
        const seg = Math.hypot(
          pts[i].x - pts[i - 1].x,
          pts[i].y - pts[i - 1].y
        );
        if (left >= seg) {
          out.push(pts[i]);
          left -= seg;
        } else {
          const k = left / seg;
          out.push({
            x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k,
            y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k,
          });
          break;
        }
      }
      return out;
    };

    const state = {
      traces: [],
      active: null,
      revealed: new Map(),
      litTop: new Map(),
    };
    const label = (s) => {
      const k = n > 8 ? 3 : 5;
      const t = [...parts[s].nickname];
      return t.slice(0, k).join('') + (t.length > k ? '…' : '');
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, H);
      ctx.strokeStyle = 'rgba(148,163,184,.65)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let c = 0; c < n; c++) {
        ctx.beginPath();
        ctx.moveTo(xs[c], TOPY);
        ctx.lineTo(xs[c], BOTY);
        ctx.stroke();
      }
      rungs.forEach((set, l) =>
        set.forEach((c) => {
          ctx.beginPath();
          ctx.moveTo(xs[c], yOf(l));
          ctx.lineTo(xs[c + 1], yOf(l));
          ctx.stroke();
        })
      );
      const drawPath = (pts, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        pts.forEach((p, i) =>
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)
        );
        ctx.stroke();
      };
      state.traces.forEach((t) => drawPath(t.pts, t.color));
      if (state.active) {
        drawPath(state.active.pts, state.active.color);
        const tip = state.active.pts[state.active.pts.length - 1];
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 9, 0, TAU);
        ctx.fillStyle = state.active.color;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      }
      ctx.textAlign = 'center';
      for (let c = 0; c < n; c++) {
        const lit = state.litTop.get(c);
        ctx.font = '700 13px Pretendard, sans-serif';
        ctx.fillStyle = lit || '#94a3b8';
        ctx.fillText(label(c), xs[c], TOPY - 18);
        const rv = state.revealed.get(c);
        ctx.font = '700 15px Pretendard, sans-serif';
        if (rv === 'win') {
          ctx.fillStyle = '#f59e0b';
          ctx.fillText('🎉 당첨', xs[c], BOTY + 28);
        } else if (rv === 'lose') {
          ctx.fillStyle = '#94a3b8';
          ctx.fillText('꽝', xs[c], BOTY + 28);
        } else {
          ctx.fillStyle = '#64748b';
          ctx.fillText('?', xs[c], BOTY + 28);
        }
      }
    };

    (async () => {
      draw();
      await sleep(700);
      const got = [];
      for (let k = 0; k < winIdx.length; k++) {
        if (cancel.v) return;
        const s = winIdx[k];
        const color = COLORS[k % COLORS.length];
        state.litTop.set(s, color);
        const pts = pathOf(s);
        const total = lenOf(pts);
        tick();
        await new Promise((resolve) => {
          const t0 = performance.now();
          const speed = 380; // px/s
          const frame = (now) => {
            if (cancel.v) return resolve();
            const d = Math.min(total, ((now - t0) / 1000) * speed);
            state.active = { pts: upTo(pts, d), color };
            draw();
            d < total ? requestAnimationFrame(frame) : resolve();
          };
          requestAnimationFrame(frame);
        });
        if (cancel.v) return;
        state.traces.push({ pts, color });
        state.active = null;
        state.revealed.set(ends[s], 'win');
        draw();
        pop();
        got.push(parts[s].nickname);
        setBanner('🎉 ' + got.join(', '));
        await sleep(800);
      }
      for (let c = 0; c < n; c++) {
        if (cancel.v) return;
        if (!state.revealed.has(c)) {
          state.revealed.set(c, slotWin[c] ? 'win' : 'lose');
          draw();
          await sleep(60);
        }
      }
      await sleep(700);
      if (!cancel.v && doneRef.current) doneRef.current();
    })();

    return () => {
      cancel.v = true;
    };
  }, [result, runKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="stage ladder-scroll">
        <canvas ref={ref} width={width} height={H} />
      </div>
      <div className="winner-banner">{banner}</div>
    </>
  );
}
