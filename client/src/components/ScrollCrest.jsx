import { useEffect, useRef } from 'react';

// 흩어져 있던 엠블럼 조각이 스크롤을 내릴수록 하나로 합쳐진다.
// 조각 이미지는 scripts/cut-crest.py 로 midura-logo.png 에서 잘라 낸 것이다.
// to: 다 흩어졌을 때의 위치 (z 는 너비 220px 기준)
const PIECES = [
  { key: 'tl', to: { x: -27, y: -12, z: 30, rx: 6, ry: 16, rz: -7 } },
  { key: 'tr', to: { x: 27, y: -12, z: 30, rx: 6, ry: -16, rz: 7 } },
  { key: 'bl', to: { x: -25, y: 17, z: 10, rx: -6, ry: 14, rz: 6 } },
  { key: 'br', to: { x: 25, y: 17, z: 10, rx: -6, ry: -14, rz: -6 } },
  { key: 'head', to: { x: 0, y: -24, z: 60, rx: -14, ry: 0, rz: 0 } },
  { key: 'shield', to: { x: 0, y: -3, z: 170, rx: 0, ry: -10, rz: 0 } },
];

// 로고 윗변이 화면 위에서 이만큼 내려온 곳에 닿을 때 다 합쳐진다 (상단 바 높이 + 여유)
const DONE_AT = 80;
const MIN_RANGE = 160;

const clamp = (v) => Math.min(1, Math.max(0, v));
const ease = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

export default function ScrollCrest({ size = 116 }) {
  const ref = useRef(null);
  // 너비 220px 일 때 맞춰 둔 깊이감을 지금 크기에 맞게 줄인다
  const k = (size * 199) / 256 / 220;

  useEffect(() => {
    // 스크롤로 직접 움직이는 연출이라 '움직임 줄이기' 설정과 상관없이 동작한다
    const el = ref.current;
    let raf = 0;
    let range = MIN_RANGE;
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      range = Math.max(MIN_RANGE, top - DONE_AT);
    };
    const update = () => {
      raf = 0;
      const p = clamp(window.scrollY / range);
      // --e 는 흩어진 정도
      el.style.setProperty('--e', (1 - ease(p)).toFixed(4));
      el.style.setProperty('--p', p.toFixed(4));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const onResize = () => {
      measure();
      onScroll();
    };
    measure();
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div
      className="crest-stage"
      ref={ref}
      style={{ height: size, perspective: 1000 * k + 'px' }}
      aria-hidden="true"
    >
      <div className="crest">
        {PIECES.map(({ key, to }) => (
          <div
            key={key}
            className="crest-piece"
            style={{
              '--img': `url(/crest/${key}.webp)`,
              '--x': to.x + '%',
              '--y': to.y + '%',
              '--z': to.z * k + 'px',
              '--rx': to.rx + 'deg',
              '--ry': to.ry + 'deg',
              '--rz': to.rz + 'deg',
            }}
          />
        ))}
        {/* 다 합쳐지면 이음매 없는 한 장으로 바꿔 끼운다 */}
        <div className="crest-whole" />
      </div>
    </div>
  );
}
