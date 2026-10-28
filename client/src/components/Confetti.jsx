import { useEffect, useRef } from 'react';

const COLORS = [
  '#6366f1',
  '#a855f7',
  '#f59e0b',
  '#10b981',
  '#ec4899',
  '#06b6d4',
  '#facc15',
];

// 마운트되면 색종이를 한 번 터뜨리고 약 3.5초 뒤 사라진다. (라이브러리 없이 canvas 로 구현)
export default function Confetti() {
  const ref = useRef(null);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv.getContext('2d');
    const resize = () => {
      cv.width = window.innerWidth;
      cv.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const parts = Array.from({ length: 160 }, () => ({
      x: cv.width / 2,
      y: cv.height * 0.45,
      vx: (Math.random() - 0.5) * 16,
      vy: -Math.random() * 15 - 4,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      rot: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 0.4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));

    let raf;
    const t0 = performance.now();
    const step = (now) => {
      const t = now - t0;
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const p of parts) {
        p.vy += 0.35;
        p.vx *= 0.995;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - 2500) / 1000);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (t < 3500) raf = requestAnimationFrame(step);
      else ctx.clearRect(0, 0, cv.width, cv.height);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={ref} className="confetti" />;
}
