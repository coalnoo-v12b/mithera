import { useCallback, useEffect, useState } from 'react';
import { api, fmt } from '../api.js';
import { useApp } from '../AppContext.js';
import Layout from '../components/Layout.jsx';
import ChainView from '../components/ChainView.jsx';

export default function Admin() {
  const { me, toast } = useApp();
  const [sum, setSum] = useState(null);
  const [users, setUsers] = useState(null);
  const [q, setQ] = useState('');
  const [chain, setChain] = useState('');
  const [chainData, setChainData] = useState(null);

  const loadUsers = useCallback(
    async (query) => {
      try {
        setUsers(
          (await api('/admin/users?q=' + encodeURIComponent(query.trim())))
            .users
        );
      } catch (e) {
        toast(e.message);
      }
    },
    [toast]
  );

  useEffect(() => {
    if (!me.isAdmin) return;
    api('/admin/summary')
      .then(setSum)
      .catch((e) => toast(e.message));
  }, [me.isAdmin, toast]);

  useEffect(() => {
    if (!me.isAdmin) return undefined;
    const t = setTimeout(() => loadUsers(q), 250);
    return () => clearTimeout(t);
  }, [q, me.isAdmin, loadUsers]);

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
      loadUsers(q);
      api('/admin/summary')
        .then(setSum)
        .catch(() => {});
    } catch (e) {
      toast(e.message);
    }
  };

  return (
    <Layout title="관리자" back>
      {sum && (
        <div className="stats">
          <div className="card">
            <b>{sum.users}</b>
            <span className="muted">전체 회원</span>
          </div>
          <div className="card">
            <b>{sum.admins}</b>
            <span className="muted">관리자</span>
          </div>
          <div className="card">
            <b>{sum.draws}</b>
            <span className="muted">전체 추첨</span>
          </div>
          <div className="card">
            <b>{sum.results}</b>
            <span className="muted">저장된 결과</span>
          </div>
        </div>
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

      <div className="section-title">회원 관리</div>
      <input
        type="search"
        placeholder="이메일 또는 닉네임 검색"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div style={{ marginTop: 10 }}>
        {users && !users.length && <div className="empty">회원이 없어요</div>}
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
    </Layout>
  );
}
