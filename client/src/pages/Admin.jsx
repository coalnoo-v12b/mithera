import { useCallback, useEffect, useState } from 'react';
import { api, fmt, STYLE_LABEL } from '../api.js';
import { useApp } from '../AppContext.js';
import Layout from '../components/Layout.jsx';
import ChainView from '../components/ChainView.jsx';
import TrendChart from '../components/TrendChart.jsx';
import '../admin.css';

const RANGES = [7, 30, 90];
const SIZES = [10, 20, 50, 100];
const VIEW_TABS = [
  ['dashboard', '📈 대시보드'],
  ['users', '👥 회원관리'],
];
const TYPE_TABS = [
  ['', '전체'],
  ['user', 'user'],
  ['admin', 'admin'],
];
// 게임마다 색을 고정한다 (필터나 순위가 바뀌어도 같은 게임은 같은 색)
const STYLE_ORDER = ['wheel', 'cards', 'marbles', 'ladder', 'lotto', 'siege'];
const total = (a) => a.reduce((x, y) => x + y, 0);
const styleColor = (k) => `var(--series-${STYLE_ORDER.indexOf(k) + 1})`;

export default function Admin() {
  const { me, toast } = useApp();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState(null);
  const [pageInfo, setPageInfo] = useState({ page: 1, pages: 1, total: 0 });
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [days, setDays] = useState(30);
  const [trend, setTrend] = useState(null);
  const [chain, setChain] = useState('');
  const [chainData, setChainData] = useState(null);
  const [view, setView] = useState('dashboard');

  const loadUsers = useCallback(
    async (query, userType, pageNo, pageSize) => {
      try {
        const r = await api(
          `/admin/users?q=${encodeURIComponent(query.trim())}&type=${userType}&page=${pageNo}&size=${pageSize}`
        );
        setUsers(r.users);
        setPageInfo({ page: r.page, pages: r.pages, total: r.total });
        if (r.page !== pageNo) setPage(r.page);
      } catch (e) {
        toast(e.message);
      }
    },
    [toast]
  );

  useEffect(() => {
    if (!me.isAdmin) return;
    api('/admin/summary')
      .then(setStats)
      .catch((e) => toast(e.message));
  }, [me.isAdmin, toast]);

  useEffect(() => {
    if (!me.isAdmin) return;
    api('/admin/trends?days=' + days)
      .then(setTrend)
      .catch((e) => toast(e.message));
  }, [me.isAdmin, days, toast]);

  useEffect(() => {
    if (!me.isAdmin) return undefined;
    const t = setTimeout(() => loadUsers(q, type, page, size), 250);
    return () => clearTimeout(t);
  }, [q, type, page, size, me.isAdmin, loadUsers]);

  if (!me.isAdmin)
    return (
      <Layout title="관리자" back>
        <div className="empty">관리자만 볼 수 있어요</div>
      </Layout>
    );

  const checkChain = async () => {
    try {
      const [c, list] = await Promise.all([api('/chain'), api('/results')]);
      setChain(
        c.ok
          ? `✅ 정상 (결과 ${c.count}건)`
          : `❌ ${c.brokenAt}번 결과에서 변조 감지`
      );
      setChainData(list);
    } catch (e) {
      toast(e.message);
    }
  };

  const change = async (u, next) => {
    if (
      !window.confirm(
        `이 회원을 ${next === 'admin' ? 'admin으로' : 'user로'} 바꿀까요?`
      )
    )
      return;
    try {
      await api('/admin/users/' + u.id, {
        method: 'PATCH',
        body: { user_type: next },
      });
      toast('변경했어요');
      loadUsers(q, type, page, size);
      api('/admin/summary')
        .then(setStats)
        .catch(() => {});
    } catch (e) {
      toast(e.message);
    }
  };

  return (
    <Layout title="관리자" back>
      {stats && (
        <div className="stats">
          <div className="card">
            <b>{stats.users}</b>
            <span className="muted">전체 회원</span>
          </div>
          <div className="card">
            <b>{stats.admins}</b>
            <span className="muted">관리자</span>
          </div>
          <div className="card">
            <b>{stats.draws}</b>
            <span className="muted">전체 추첨</span>
          </div>
          <div className="card">
            <b>{stats.results}</b>
            <span className="muted">저장된 결과</span>
          </div>
        </div>
      )}

      <div
        className="tabs row"
        role="group"
        aria-label="관리자 메뉴"
        style={{ margin: '10px 0' }}
      >
        {VIEW_TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={'btn' + (value === view ? ' on' : '')}
            aria-pressed={value === view}
            onClick={() => setView(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'dashboard' && (
        <>
          <div className="section-title row between">
            <span>📈 대시보드</span>
            <span className="tabs row" role="group" aria-label="기간">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={'btn small' + (r === days ? ' on' : '')}
                  aria-pressed={r === days}
                  onClick={() => setDays(r)}
                >
                  {r}일
                </button>
              ))}
            </span>
          </div>
          {trend ? (
            <>
              <TrendChart
                title="회원 가입"
                headline={`신규 ${total(trend.signups)}명 · 누적 ${trend.usersBefore + total(trend.signups)}명`}
                labels={trend.labels}
                kind="line"
                series={[
                  {
                    key: 'signups',
                    label: '신규 가입',
                    color: 'var(--series-1)',
                    values: trend.signups,
                  },
                ]}
              />
              <TrendChart
                title="추첨 개설"
                headline={`${total(trend.draws)}건`}
                labels={trend.labels}
                series={[
                  {
                    key: 'draws',
                    label: '개설한 추첨',
                    color: 'var(--series-1)',
                    values: trend.draws,
                  },
                ]}
              />
              <TrendChart
                title="추첨 실행"
                headline={`${total(trend.runs)}건`}
                labels={trend.labels}
                series={[
                  {
                    key: 'runs',
                    label: '실행한 추첨',
                    color: 'var(--series-3)',
                    values: trend.runs,
                  },
                ]}
              />
              <TrendChart
                title="추첨 게임 사용"
                headline={`${total(trend.draws)}건`}
                labels={trend.labels}
                stacked
                series={STYLE_ORDER.filter((k) => trend.styles[k]).map((k) => ({
                  key: k,
                  label: STYLE_LABEL[k] || k,
                  color: styleColor(k),
                  values: trend.styles[k],
                }))}
              />
              <GameShare styles={trend.styles} />
            </>
          ) : (
            <div className="empty">불러오는 중…</div>
          )}

          <div className="row" style={{ margin: '6px 0 10px' }}>
            <button className="btn" onClick={checkChain}>
              🔗 결과 해시 체인 검증
            </button>
            <span className="muted">{chain}</span>
          </div>

          {chainData && (
            <div className="card">
              <ChainView chain={chainData} />
            </div>
          )}
        </>
      )}

      {view === 'users' && (
        <>
          <div className="section-title">회원 관리 ({pageInfo.total}명)</div>
          <div
            className="tabs row"
            role="group"
            aria-label="회원 권한"
            style={{ marginBottom: 8 }}
          >
            {TYPE_TABS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={'btn small' + (value === type ? ' on' : '')}
                aria-pressed={value === type}
                onClick={() => {
                  setType(value);
                  setPage(1);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="search"
            placeholder="이메일 또는 닉네임 검색"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <div
            className="tabs row"
            role="group"
            aria-label="한 번에 보기"
            style={{ marginTop: 8 }}
          >
            <span className="muted">한 번에</span>
            {SIZES.map((n) => (
              <button
                key={n}
                type="button"
                className={'btn small' + (n === size ? ' on' : '')}
                aria-pressed={n === size}
                onClick={() => {
                  setSize(n);
                  setPage(1);
                }}
              >
                {n}명
              </button>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            {users && !users.length && (
              <div className="empty">회원이 없어요</div>
            )}
            {users &&
              users.map((u) => {
                const self = u.id === me.id;
                const next = u.user_type === 'admin' ? 'user' : 'admin';
                const locked = next === 'user' && (self || u.locked);
                return (
                  <div key={u.id} className="card row">
                    <div className="grow">
                      <div>
                        <b>{u.nickname}</b>{' '}
                        <span
                          className={
                            'badge' + (u.user_type === 'admin' ? ' drawn' : '')
                          }
                        >
                          {u.user_type}
                        </span>
                        {self && (
                          <>
                            {' '}
                            <span className="badge">나</span>
                          </>
                        )}
                      </div>
                      <div className="muted ellipsis">
                        {u.email} · {fmt(u.createdAt)}
                      </div>
                    </div>
                    <button
                      className={
                        'btn small ' + (next === 'user' ? 'danger' : 'primary')
                      }
                      disabled={locked}
                      title={locked ? '변경할 수 없는 계정이에요' : undefined}
                      onClick={() => change(u, next)}
                    >
                      {next === 'admin' ? 'admin으로' : 'user로'}
                    </button>
                  </div>
                );
              })}
          </div>
          {pageInfo.pages > 1 && (
            <div className="pager row">
              <button
                className="btn small"
                disabled={pageInfo.page <= 1}
                onClick={() => setPage(pageInfo.page - 1)}
              >
                ◀ 이전
              </button>
              <span className="muted">
                {pageInfo.page} / {pageInfo.pages}
              </span>
              <button
                className="btn small"
                disabled={pageInfo.page >= pageInfo.pages}
                onClick={() => setPage(pageInfo.page + 1)}
              >
                다음 ▶
              </button>
            </div>
          )}
        </>
      )}
    </Layout>
  );
}

// 기간 안에서 게임별로 몇 번 쓰였는지 (가로 막대 + 비율)
function GameShare({ styles }) {
  const rows = STYLE_ORDER.filter((k) => styles[k])
    .map((k) => ({ k, n: total(styles[k]) }))
    .sort((a, b) => b.n - a.n);
  const sum = total(rows.map((r) => r.n));
  if (!sum) return null;
  return (
    <div className="viz card">
      <div className="viz-head">
        <h3>게임별 사용 비중</h3>
      </div>
      {rows.map((r) => (
        <div key={r.k} className="share-row">
          <span>{STYLE_LABEL[r.k] || r.k}</span>
          <span className="share-track">
            <span
              style={{
                width: `${(r.n / sum) * 100}%`,
                background: styleColor(r.k),
              }}
            />
          </span>
          <span className="share-val">
            {r.n}건 · {Math.round((r.n / sum) * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}
