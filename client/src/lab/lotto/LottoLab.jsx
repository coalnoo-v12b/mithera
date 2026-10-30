import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import LottoStage from '../../lotto/LottoStage.jsx';
import { BALL_COLORS } from '../../lotto/ballTexture.js';
import { decodeLotto } from '../../lotto/decode.js';
import RouletteStage from '../../roulette/RouletteStage.jsx';
import { decodeRoulette } from '../../roulette/decode.js';
import SiegeStage from '../../siege/SiegeStage.jsx';
import { decodeSiege, TEAM_COLORS } from '../../siege/decode.js';
import './lotto.css';

// 개발용 실험 화면: 서버(/api/lab/:kind)가 실제 추첨과 같은 물리 엔진으로 돌린 녹화를 재생한다.
// 결과는 저장하지 않는다. 배포 환경에서는 서버 경로가 열려 있지 않다.

// max, winners 는 server/src/utils/lotto.js, roulette.js, siege.js 의 한도와 같아야 한다
const KINDS = {
  lotto: {
    num: '01',
    title: '로또 추첨기',
    max: 200,
    winners: 50,
    Stage: LottoStage,
    decode: decodeLotto,
    color: (i) => BALL_COLORS[i % BALL_COLORS.length],
  },
  roulette: {
    num: '02',
    title: '카지노 룰렛',
    max: 36,
    winners: 10,
    Stage: RouletteStage,
    decode: decodeRoulette,
    color: () => '#d4a52c',
  },
  siege: {
    num: '03',
    title: '성벽 탈환전',
    max: 500,
    winners: 200,
    fill: 300,
    Stage: SiegeStage,
    decode: decodeSiege,
    color: (i) => TEAM_COLORS[i % TEAM_COLORS.length],
  },
};
const SAMPLE = [
  '민수',
  '지연',
  '수빈',
  '준호',
  '하늘',
  '유나',
  '서연',
  '도현',
  '지우',
  '하준',
  '서준',
  '예은',
  '시우',
  '채원',
  '지호',
  '수아',
  '은우',
  '다은',
  '건우',
  '소율',
  '현우',
  '지안',
  '우진',
  '나연',
  '태윤',
  '하린',
  '시윤',
  '예준',
  '윤서',
  '주원',
].join('\n');
const SPEEDS = [0.5, 1, 1.5, 2, 3];

function parseNames(text, max) {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

export default function LottoLab({ kind = 'lotto' }) {
  const K = KINDS[kind];
  const { Stage } = K;
  const MAX_BALLS = K.max;
  const MAX_WINNERS = K.winners;
  const [text, setText] = useState(SAMPLE);
  const [target, setTarget] = useState(3);
  const [run, setRun] = useState(null); // { key, names, recording, decoded, seed }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [speed, setSpeed] = useState(1.5);
  const speedRef = useRef(speed);
  const pickSpeed = (s) => {
    speedRef.current = s;
    setSpeed(s);
  };

  const names = useMemo(() => parseNames(text, MAX_BALLS), [text, MAX_BALLS]);
  const goal = Math.min(target, names.length, MAX_WINNERS);

  const start = async () => {
    setLoading(true);
    setError('');
    try {
      const x = await api(`/lab/${kind}?n=${names.length}&w=${goal}`);
      const recording = JSON.parse(x.raw);
      setRun({
        key: x.seed,
        seed: x.seed,
        names,
        recording,
        decoded: K.decode(recording),
        arrived: [],
        done: false,
      });
    } catch (e) {
      setError(e.message || '서버에 연결하지 못했어요 (npm run dev:server)');
    } finally {
      setLoading(false);
    }
  };

  const onArrive = useCallback((k, ball) => {
    setRun((r) => r && { ...r, arrived: [...r.arrived, ball] });
  }, []);
  const onCapture = useCallback(() => {}, []);
  const onDone = useCallback(() => {
    setRun((r) => r && { ...r, done: true });
  }, []);

  const status = loading
    ? '서버에서 물리 시뮬레이션 중…'
    : run
      ? run.done
        ? '추첨 완료!'
        : `추첨 중 · ${run.arrived.length} / ${run.recording.winnerCount}`
      : `참가자 ${names.length}명 · 당첨 ${goal}명`;

  return (
    <div className="lotto-lab">
      <div className="lotto-canvas">
        {run && (
          <Stage
            key={run.key}
            recording={run.recording}
            decoded={run.decoded}
            names={run.names}
            playing
            speedRef={speedRef}
            onCapture={onCapture}
            onArrive={onArrive}
            onDone={onDone}
            me={0}
          />
        )}
      </div>

      <header className="lotto-title">
        <span className="lotto-num">{K.num}</span>
        <div>
          <h1>{K.title}</h1>
          <p>PHYSICS LAB · 서버 물리 엔진 미리보기</p>
        </div>
      </header>

      <aside className="lotto-panel">
        <label className="lotto-label" htmlFor="lotto-names">
          참가자 <small>(줄바꿈이나 쉼표로 구분, 최대 {MAX_BALLS}명)</small>
        </label>
        <textarea
          id="lotto-names"
          value={text}
          disabled={loading}
          onChange={(e) => setText(e.target.value)}
          rows={7}
        />
        <div className="lotto-row">
          <button
            type="button"
            className="lotto-ghost"
            disabled={loading}
            onClick={() =>
              setText(
                Array.from(
                  { length: K.fill || 120 },
                  (_, k) => `참가자${k + 1}`
                ).join('\n')
              )
            }
          >
            {K.fill || 120}명 채우기
          </button>
          <button
            type="button"
            className="lotto-ghost"
            disabled={loading}
            onClick={() => setText(SAMPLE)}
          >
            예시 30명
          </button>
        </div>

        <label className="lotto-label" htmlFor="lotto-target">
          당첨 인원
        </label>
        <div className="lotto-row">
          <select
            id="lotto-target"
            value={target}
            disabled={loading}
            onChange={(e) => setTarget(Number(e.target.value))}
          >
            {Array.from({ length: MAX_WINNERS }, (_, k) => (
              <option key={k} value={k + 1}>
                {k + 1}명
              </option>
            ))}
          </select>
          <button
            type="button"
            className="lotto-primary"
            disabled={loading || goal < 1}
            onClick={start}
          >
            {run ? '새로 추첨' : '추첨 시작'}
          </button>
        </div>
        <div className="lotto-row lotto-speeds">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className={'lotto-ghost' + (s === speed ? ' on' : '')}
              onClick={() => pickSpeed(s)}
            >
              {s}x
            </button>
          ))}
        </div>
        <p className="lotto-status">{status}</p>
        {error && <p className="lotto-error">{error}</p>}
        {run && <p className="lotto-hint">seed {run.seed.slice(0, 16)}…</p>}
        <p className="lotto-hint">
          끌면 회전, 휠로 확대, 오른쪽 버튼으로 끌면 이동
        </p>
        <Link className="lotto-back" to="/">
          ← 메인으로
        </Link>
      </aside>

      {run && run.arrived.length > 0 && (
        <aside className="lotto-results">
          <h2>당첨</h2>
          <ol>
            {run.arrived.map((i, k) => (
              <li key={i}>
                <span className="dot" style={{ background: K.color(i) }} />
                <span className="rank">{k + 1}</span>
                {run.names[i]}
              </li>
            ))}
          </ol>
        </aside>
      )}
    </div>
  );
}
