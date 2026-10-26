import { useEffect, useState } from 'react';

const pad = (n) => String(n).padStart(2, '0');

export default function Countdown({ at, status }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status === 'drawn') return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);

  if (status === 'drawn') return <span className="cd done">추첨 완료</span>;
  const diff = new Date(at).getTime() - now;
  if (diff <= 0) return <span className="cd now">추첨 시간이에요</span>;
  const s = Math.floor(diff / 1000);
  const d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  return (
    <span className="cd">
      {d > 0 ? `D-${d} ` : ''}
      {pad(h)}:{pad(m)}:{pad(sec)}
    </span>
  );
}
