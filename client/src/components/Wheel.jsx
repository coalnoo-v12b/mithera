import { useEffect, useRef, useState } from 'react';
import { sleep } from '../api.js';
import { tick } from '../sfx.js';

// [안쪽, 바깥쪽] 그라데이션 색
const COLORS = [
  ['#818cf8', '#4f46e5'],
  ['#fbbf24', '#d97706'],
  ['#34d399', '#059669'],
  ['#f472b6', '#db2777'],
  ['#22d3ee', '#0891b2'],
  ['#a3e635', '#65a30d'],
  ['#fb923c', '#ea580c'],
  ['#c084fc', '#7c3aed'],
];
const TAU = Math.PI * 2;

// 결과는 서버가 이미 확정했고, 이 컴포넌트는 그 결과를 보여주는 애니메이션만 한다.
export default function Wheel({ result, runKey, onDone }) {
  const ref = useRef(null);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  const [banner, setBanner] = useState('');

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv.getContext('2d');
    const cancel = { v: false };
    let names = result.participants.map((p) => p.nickname);
    let ids = result.participants.map((p) => p.id);
    let rot = 0;
    let wobble = 0; // 칸 경계를 지날 때 바늘이 튕기는 정도
    let hl = -1; // 멈춘 뒤 빛나는 칸
    // eslint-disable-next-line react-hooks/set-state-in-effect -- // 재생이 다시 시작될 때 이전 연출 상태를 초기화한다 (의도된 effect 내 setState)
    setBanner('');

    const draw = () => {
      const n = names.length,
        seg = TAU / n,
        c = 160;
      ctx.clearRect(0, 0, 320, 320);
      ctx.save();
      ctx.shadowColor = 'rgba(99,102,241,.35)';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(c, c, 152, 0, TAU);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.restore();
      for (let i = 0; i < n; i++) {
        const s = rot + i * seg - Math.PI / 2;
        const [from, to] = COLORS[i % COLORS.length];
        const g = ctx.createRadialGradient(c, c, 20, c, c, 150);
        g.addColorStop(0, from);
        g.addColorStop(1, to);
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.arc(c, c, 148, s, s + seg);
        ctx.closePath();
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (i === hl) {
          ctx.beginPath();
          ctx.moveTo(c, c);
          ctx.arc(c, c, 148, s, s + seg);
          ctx.closePath();
          ctx.fillStyle = 'rgba(255,255,255,.28)';
          ctx.fill();
          ctx.lineWidth = 4;
          ctx.strokeStyle = '#facc15';
          ctx.stroke();
        }
        if (n <= 24) {
          ctx.save();
          ctx.translate(c, c);
          ctx.rotate(s + seg / 2);
          ctx.textAlign = 'right';
          ctx.fillStyle = '#fff';
          ctx.font = '700 14px Pretendard, sans-serif';
          ctx.shadowColor = 'rgba(0,0,0,.35)';
          ctx.shadowBlur = 3;
          const label =
            names[i].length > 8 ? names[i].slice(0, 8) + '…' : names[i];
          ctx.fillText(label, 136, 5);
          ctx.restore();
        }
      }
      ctx.beginPath();
      ctx.arc(c, c, 16, 0, TAU);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(c, c, 6, 0, TAU);
      ctx.fillStyle = '#6366f1';
      ctx.fill();
      // 바늘
      ctx.save();
      ctx.translate(c, 8);
      ctx.rotate(wobble);
      ctx.beginPath();
      ctx.moveTo(-12, -6);
      ctx.lineTo(12, -6);
      ctx.lineTo(0, 24);
      ctx.closePath();
      ctx.shadowColor = 'rgba(0,0,0,.3)';
      ctx.shadowBlur = 5;
      ctx.fillStyle = '#ef4444';
      ctx.fill();
      ctx.restore();
    };

    (async () => {
      draw();
      await sleep(500);
      const got = [];
      for (const w of result.winners) {
        if (cancel.v) return;
        hl = -1;
        const idx = ids.indexOf(w.id);
        const seg = TAU / names.length;
        const base = -((idx + 0.5 + (Math.random() - 0.5) * 0.7) * seg);
        const from = rot;
        const target = from + TAU * 5 + ((((base - from) % TAU) + TAU) % TAU);
        const dur = 3800,
          t0 = performance.now();
        let lastSlot = Math.floor(-from / seg);
        await new Promise((resolve) => {
          const step = (now) => {
            if (cancel.v) return resolve();
            const t = Math.min(1, (now - t0) / dur);
            rot = from + (target - from) * (1 - Math.pow(1 - t, 3));
            const slot = Math.floor(-rot / seg);
            if (slot !== lastSlot) {
              lastSlot = slot;
              wobble = 0.5;
              tick();
            }
            wobble *= 0.82;
            draw();
            t < 1 ? requestAnimationFrame(step) : resolve();
          };
          requestAnimationFrame(step);
        });
        if (cancel.v) return;
        wobble = 0;
        hl = idx;
        draw();
        got.push(w.nickname);
        setBanner('🎉 ' + got.join(', '));
        await sleep(1100);
        if (names.length > 1 && got.length < result.winners.length) {
          names = names.filter((_, i) => i !== idx);
          ids = ids.filter((_, i) => i !== idx);
          rot = 0;
          hl = -1;
          draw();
        }
      }
      if (!cancel.v && doneRef.current) doneRef.current();
    })();

    return () => {
      cancel.v = true;
    };
  }, [result, runKey]);

  return (
    <>
      <div className="stage">
        <canvas ref={ref} width={320} height={320} />
      </div>
      <div className="winner-banner">{banner}</div>
    </>
  );
}
