import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, STATUS, STYLE_LABEL, badgeClass, fmt } from '../api.js';
import { useApp } from '../AppContext.js';
import Layout from '../components/Layout.jsx';
import Countdown from '../components/Countdown.jsx';

export default function List() {
  const { me } = useApp();
  const nav = useNavigate();
  const [draws, setDraws] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/draws')
      .then((r) => setDraws(r.draws))
      .catch((e) => setError(e.message));
    api('/stats')
      .then(setStats)
      .catch(() => {});
  }, []);

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

      {error && <div className="empty">{error}</div>}
      {!error && !draws && <div className="empty">불러오는 중…</div>}
      {draws && !draws.length && (
        <div className="empty">아직 추첨이 없어요</div>
      )}
      {draws &&
        draws.map((d) => (
          <div
            key={d.id}
            className="card tap"
            onClick={() => nav('/draw/' + d.id)}
          >
            <div className="row between">
              <h3>{d.title}</h3>
              <span className={'badge ' + badgeClass(d.status)}>
                {STATUS[d.status]}
              </span>
            </div>
            <div className="muted">
              {STYLE_LABEL[d.style]} · 당첨 {d.winnerCount}명 · 참여{' '}
              {d.participantCount}명{d.joined ? ' · ✅ 참여함' : ''}
            </div>
            <div className="row between" style={{ marginTop: 6 }}>
              <span className="muted">🗓️ {fmt(d.drawAt)}</span>
              <Countdown at={d.drawAt} status={d.status} />
            </div>
          </div>
        ))}
      {me.isAdmin && (
        <button
          className="fab"
          aria-label="추첨 만들기"
          onClick={() => nav('/new')}
        >
          +
        </button>
      )}
    </Layout>
  );
}
