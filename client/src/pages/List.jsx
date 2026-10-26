import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, STATUS, STYLE_LABEL, badgeClass, fmt } from '../api.js';
import Layout from '../components/Layout.jsx';
import Countdown from '../components/Countdown.jsx';

// 추첨 번호는 "yyyymmdd-N". "20261026-3"(또는 #, No. 가 앞에 붙은 것)은 그 번호 하나를,
// "20261026" 은 그날의 모든 추첨을 뜻한다. (server/src/utils/drawNo.js 와 같은 규칙)
const NO_QUERY = /^(?:#|no\.?)?\s*(\d{8})(?:\s*-\s*(\d{1,4}))?$/i;
const asNo = (q) => {
  const m = NO_QUERY.exec(q.trim());
  if (!m) return null;
  return m[2] ? `${m[1]}-${Number(m[2])}` : null;
};

// 목록 범위 탭: 값은 서버 GET /api/draws 의 filter 와 같다 ('' 는 전체)
const TABS = [
  ['', '전체', '아직 추첨이 없어요'],
  ['joined', '참여한 추첨', '아직 참여한 추첨이 없어요'],
  ['mine', '내가 만든 추첨', '아직 만든 추첨이 없어요'],
];

export default function List() {
  const nav = useNavigate();
  const [draws, setDraws] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('');

  useEffect(() => {
    api('/stats')
      .then(setStats)
      .catch(() => {});
  }, []);

  // 검색어나 탭이 바뀌면 잠깐 기다렸다가(타이핑 중에는 요청하지 않음) 다시 불러온다
  useEffect(() => {
    let alive = true;
    const t = setTimeout(
      () => {
        api(`/draws?q=${encodeURIComponent(q.trim())}&filter=${scope}`)
          .then((r) => {
            if (!alive) return;
            setDraws(r.draws);
            setError('');
          })
          .catch((e) => alive && setError(e.message));
      },
      q ? 300 : 0
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, scope]);

  const wanted = asNo(q);
  // 번호가 정확히 맞는 추첨을 맨 위로
  const shown =
    draws && wanted != null
      ? [...draws].sort(
          (a, b) => (b.no === wanted ? 1 : 0) - (a.no === wanted ? 1 : 0)
        )
      : draws;

  // 번호를 치고 Enter 를 누르면 그 추첨으로 바로 이동
  const submit = (e) => {
    e.preventDefault();
    const hit = wanted != null && draws && draws.find((d) => d.no === wanted);
    if (hit) nav('/draw/' + hit.id);
  };

  return (
    <Layout title="미더라">
      <section className="hero">
        <div className="hero-title">공정하게, 그리고 증명할 수 있게</div>
        <div className="hero-sub">
          {stats ? (
            <>
              지금까지 <b>{stats.drawn}</b>번의 추첨 ·{' '}
              {stats.chainOk ? (
                <>
                  변조 <b>0</b>건 ✅
                </>
              ) : (
                <>⚠️ 변조가 감지됐어요</>
              )}
            </>
          ) : (
            '추첨 결과는 저장되는 순간 잠겨요'
          )}
        </div>
      </section>

      <form className="search" onSubmit={submit} role="search">
        <input
          type="search"
          inputMode="search"
          maxLength={50}
          placeholder="🔍 번호 또는 이름으로 찾기 (예: 20261026-1)"
          aria-label="추첨 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </form>

      <div className="tabs" role="tablist" aria-label="추첨 범위">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={scope === value}
            className={'btn small' + (scope === value ? ' on' : '')}
            onClick={() => setScope(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="empty">{error}</div>}
      {!error && !shown && <div className="empty">불러오는 중…</div>}
      {shown && !shown.length && (
        <div className="empty">
          {q.trim()
            ? `'${q.trim()}'에 해당하는 추첨이 없어요`
            : TABS.find(([value]) => value === scope)[2]}
        </div>
      )}
      {shown &&
        shown.map((d) => (
          <div
            key={d.id}
            className="card tap"
            onClick={() => nav('/draw/' + d.id)}
          >
            <div className="row between">
              <h3>
                {d.no != null && <span className="no">No.{d.no}</span>}
                {d.title}
                {d.hasPassword && (
                  <span className="lock" title="참여 비밀번호 필요">
                    🔒
                  </span>
                )}
              </h3>
              <span className={'badge ' + badgeClass(d.status)}>
                {STATUS[d.status]}
              </span>
            </div>
            <div className="muted">
              {STYLE_LABEL[d.style]} · 당첨 {d.winnerCount}명 · 참여{' '}
              {d.participantCount}명{d.joined ? ' · ✅ 참여함' : ''}
              {d.mine ? ' · ✍️ 내가 만듦' : ''}
            </div>
            <div className="row between" style={{ marginTop: 6 }}>
              <span className="muted">🗓️ {fmt(d.drawAt)}</span>
              <Countdown at={d.drawAt} status={d.status} />
            </div>
          </div>
        ))}
      <button
        className="fab"
        aria-label="추첨 만들기"
        onClick={() => nav('/new')}
      >
        +
      </button>
    </Layout>
  );
}
