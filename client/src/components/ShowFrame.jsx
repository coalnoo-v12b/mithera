import { useEffect, useRef, useState } from 'react';

// 추첨 연출을 감싸서 전체화면으로 볼 수 있게 하는 틀. (모든 연출 방식에 공통)
// 브라우저가 전체화면을 지원하지 않으면(아이폰 Safari 등) 화면을 가득 채우는 방식으로 대신한다.
// controls 는 아래쪽 버튼 줄(다시 보기 등)이고, 전체화면 버튼은 그 줄 끝에 붙는다.
export default function ShowFrame({ children, controls }) {
  const boxRef = useRef(null);
  // native: 브라우저 전체화면, fill: 화면 채우기(대체), null: 꺼짐
  const [mode, setMode] = useState(null);

  useEffect(() => {
    const sync = () => {
      const on = document.fullscreenElement === boxRef.current;
      setMode((m) => (on ? 'native' : m === 'native' ? null : m));
    };
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  // 화면 채우기 방식은 Esc 로 나갈 수 있게 하고, 뒤 페이지가 스크롤되지 않게 막는다
  useEffect(() => {
    if (mode !== 'fill') return undefined;
    const onKey = (e) => e.key === 'Escape' && setMode(null);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [mode]);

  const toggle = async () => {
    if (mode === 'native') {
      document.exitFullscreen().catch(() => {});
      return;
    }
    if (mode === 'fill') {
      setMode(null);
      return;
    }
    const el = boxRef.current;
    if (el && el.requestFullscreen && document.fullscreenEnabled) {
      try {
        await el.requestFullscreen();
        return;
      } catch {
        /* 막혀 있으면 화면 채우기로 */
      }
    }
    setMode('fill');
  };

  return (
    <div
      ref={boxRef}
      className={
        'show-frame' + (mode ? ' full' : '') + (mode === 'fill' ? ' fill' : '')
      }
    >
      <div className="show-body">{children}</div>
      <div className="row show-controls">
        {controls}
        <button type="button" className="btn" onClick={toggle}>
          {mode ? '✕ 전체화면 끄기' : '⛶ 전체화면'}
        </button>
      </div>
    </div>
  );
}
