import { useEffect, useMemo, useRef, useState } from 'react';
import { sleep } from '../api.js';
import { pop, tick } from '../sfx.js';
import { decodeRecording } from '../verify.js';
import { createRenderer, VIEW_W, VIEW_H } from '../raceRender.js';

// 서버의 물리 엔진이 이미 끝까지 돌려서 저장해 둔 경기 기록(recording)을 재생한다.
// 화면은 승자를 정하지 않고, 기록에 담긴 구슬의 움직임을 그대로 보여줄 뿐이다. (그리기는 raceRender.js)
export default function Marbles({ result, runKey, onDone, recording }) {
  const ref = useRef(null);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  const [banner, setBanner] = useState('');
  const decoded = useMemo(
    () => (recording ? decodeRecording(recording) : null),
    [recording]
  );

  useEffect(() => {
    if (!recording || !decoded) return undefined;
    const ctx = ref.current.getContext('2d');
    const cancel = { v: false };
    const rec = recording;
    const names = result.participants.map((p) => p.nickname);
    const R = createRenderer(rec, decoded, names);
    const { n, F, finishFrame, orderIdx } = R;
    const wn = rec.winnerCount;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- // 재생이 다시 시작될 때 이전 연출 상태를 초기화한다 (의도된 effect 내 setState)
    setBanner('');

    (async () => {
      let st = R.draw(ctx, 0);
      for (const c of ['3', '2', '1', 'GO!']) {
        if (cancel.v) return;
        R.draw(ctx, 0, { overlay: { text: c, size: c === 'GO!' ? 90 : 130 } });
        tick();
        await sleep(c === 'GO!' ? 500 : 800);
      }
      if (cancel.v) return;
      R.draw(ctx, 0);

      let f = 0;
      let last = performance.now();
      const announced = new Set();
      await new Promise((resolve) => {
        const frame = (now) => {
          if (cancel.v) return resolve();
          const dt = Math.min(0.1, (now - last) / 1000);
          last = now;
          // 결승 직전에는 슬로모션
          const leadY = Math.max(...st.py);
          let doneCnt = 0;
          for (let i = 0; i < n; i++) if (finishFrame[i] <= f) doneCnt++;
          const slow = doneCnt < wn && leadY > rec.finishY - 380;
          f = Math.min(F - 1, f + dt * rec.fps * (slow ? 0.45 : 1));
          st = R.draw(ctx, f);
          for (let k = 0; k < wn; k++) {
            const m = rec.order[k];
            if (!announced.has(m) && finishFrame[m] <= f) {
              announced.add(m);
              pop();
              setBanner(
                '🏁 ' +
                  rec.order
                    .slice(0, wn)
                    .filter((x) => announced.has(x))
                    .map((x) => `${orderIdx[x] + 1}등 ${names[x]}`)
                    .join(' · ')
              );
            }
          }
          if (f >= F - 1) return resolve();
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      if (cancel.v) return;
      const winners = rec.order
        .slice(0, wn)
        .map((x, k) => `${k + 1}등 ${names[x]}`);
      setBanner('🏁 ' + winners.join(' · '));
      R.draw(ctx, F - 1, {
        overlay: {
          text: 'FINISH!',
          size: 64,
          sub:
            winners.slice(0, 3).join('  ') + (winners.length > 3 ? ' …' : ''),
        },
      });
      await sleep(1400);
      if (!cancel.v && doneRef.current) doneRef.current();
    })();

    return () => {
      cancel.v = true;
    };
  }, [recording, decoded, result, runKey]);

  return (
    <>
      <div className="stage">
        <canvas ref={ref} width={VIEW_W} height={VIEW_H} className="race" />
      </div>
      <div className="winner-banner">{banner}</div>
    </>
  );
}
