import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { pop, tick } from '../sfx.js';

const SPEEDS = [0.5, 1, 1.5, 2, 3];
const DEFAULT_SPEED = 1.5;

// 재생 속도는 이 브라우저에만 기억한다. (결과와는 무관한 화면 설정)
function loadSpeed(key) {
  try {
    const v = Number(localStorage.getItem(key));
    return SPEEDS.includes(v) ? v : DEFAULT_SPEED;
  } catch {
    return DEFAULT_SPEED;
  }
}

// 서버의 물리 엔진이 끝까지 돌려서 저장한 녹화를 3D 로 재생하는 공통 틀 (로또 추첨기, 룰렛).
// 카운트다운, 당첨 순간 이름 팝업, 당첨자 목록, 재생 속도를 맡고, 장면은 Stage 가 그린다.
// Stage 는 녹화를 재생하다가 k 번째 당첨이 확정되는 순간 onArrive(k, 참가자 번호)를 부른다.
//   Stage: React.lazy 로 불러온 장면 컴포넌트, decode: 녹화를 푸는 함수
//   speedKey: 재생 속도를 기억할 localStorage 키, idleText: 첫 당첨 전 안내 문구
//   chipColor(i): 당첨자 목록의 점 색
//   popup: 당첨될 때마다 이름을 크게 띄울지 (당첨자가 아주 많은 방식은 장면이 직접 알린다)
//   loadingText: 장면을 불러오는 동안의 문구, meId: 보는 사람의 회원 id (장면이 '내 것'을 표시할 때 씀)
export default function Show3D({
  Stage,
  decode,
  speedKey,
  idleText,
  chipColor,
  popup = true,
  loadingText = '추첨기를 준비하는 중…',
  meId,
  result,
  runKey,
  onDone,
  recording,
}) {
  const [speed, setSpeed] = useState(() => loadSpeed(speedKey));
  const speedRef = useRef(speed);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  const pickSpeed = (s) => {
    setSpeed(s);
    try {
      localStorage.setItem(speedKey, String(s));
    } catch {
      /* 무시 */
    }
  };
  const decoded = useMemo(
    () => (recording ? decode(recording) : null),
    [recording, decode]
  );
  const names = useMemo(
    () => result.participants.map((p) => p.nickname),
    [result]
  );
  const me = result.participants.findIndex((p) => p.id === meId);
  if (!recording || !decoded) return null;
  return (
    <>
      <Run
        key={runKey}
        Stage={Stage}
        idleText={idleText}
        chipColor={chipColor}
        popup={popup}
        loadingText={loadingText}
        me={me}
        recording={recording}
        decoded={decoded}
        names={names}
        speedRef={speedRef}
        onDone={onDone}
      />
      <div className="speed-pick" role="group" aria-label="재생 속도">
        <span className="muted">속도</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            className={'btn small' + (s === speed ? ' on' : '')}
            aria-pressed={s === speed}
            onClick={() => pickSpeed(s)}
          >
            {s}x
          </button>
        ))}
      </div>
    </>
  );
}

// 한 번의 재생. "연출 다시 보기"를 누르면 key 가 바뀌어 처음부터 다시 만든다.
function Run({
  Stage,
  idleText,
  chipColor,
  popup,
  loadingText,
  me,
  recording,
  decoded,
  names,
  speedRef,
  onDone,
}) {
  const [count, setCount] = useState('3');
  const [arrived, setArrived] = useState([]);
  const [popName, setPopName] = useState(null);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });

  useEffect(() => {
    const steps = ['3', '2', '1', 'GO!', null];
    let k = 0;
    tick();
    const t = setInterval(() => {
      k++;
      setCount(steps[k]);
      if (steps[k]) tick();
      if (k >= steps.length - 1) clearInterval(t);
    }, 750);
    return () => clearInterval(t);
  }, []);

  const popTimer = useRef();
  useEffect(() => () => clearTimeout(popTimer.current), []);
  const onArrive = useCallback(
    (k, who) => {
      setArrived((a) => [...a, who]);
      if (!popup) return;
      pop();
      setPopName({ k, name: names[who] });
      clearTimeout(popTimer.current);
      popTimer.current = setTimeout(() => setPopName(null), 1800);
    },
    [names, popup]
  );
  const onCapture = useCallback(() => {}, []);
  const finish = useCallback(() => {
    setTimeout(() => doneRef.current && doneRef.current(), 900);
  }, []);

  const playing = count === null || count === 'GO!';
  return (
    <>
      <div className="lotto-stage">
        <Suspense fallback={<div className="lotto-loading">{loadingText}</div>}>
          <Stage
            recording={recording}
            decoded={decoded}
            names={names}
            playing={playing}
            speedRef={speedRef}
            onCapture={onCapture}
            onArrive={onArrive}
            onDone={finish}
            me={me}
          />
        </Suspense>
        <div className="stage-hint">
          끌어서 회전 · 휠/두 손가락으로 확대 · 오른쪽 버튼(두 손가락)으로 끌면
          이동
        </div>
        {count && <div className="lotto-count">{count}</div>}
        {popName && (
          <div className="lotto-pop" key={popName.k}>
            <span>{popName.k + 1}번째 당첨</span>
            <strong>{popName.name}</strong>
          </div>
        )}
      </div>
      <div className="winner-banner lotto-winners">
        {arrived.length === 0
          ? idleText
          : arrived.map((who, k) => (
              <span key={who} className="lotto-chip">
                <i style={{ background: chipColor(who) }} />
                {k + 1}. {names[who]}
              </span>
            ))}
      </div>
    </>
  );
}
