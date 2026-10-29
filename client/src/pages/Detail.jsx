import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, STATUS, STYLE_LABEL, badgeClass, fmt } from '../api.js';
import { useApp } from '../AppContext.js';
import {
  canVerify,
  verifyInBrowser,
  isPhysicsAlgo,
  LOTTO_ALGO,
  ROULETTE_ALGO,
  RACE_ALGO,
  SIEGE_ALGO,
} from '../verify.js';
import Layout from '../components/Layout.jsx';
import Wheel from '../components/Wheel.jsx';
import Cards from '../components/Cards.jsx';
import Marbles from '../components/Marbles.jsx';
import Ladder from '../components/Ladder.jsx';
import Lotto from '../components/Lotto.jsx';
import Roulette from '../components/Roulette.jsx';
import Siege from '../components/Siege.jsx';
import Countdown from '../components/Countdown.jsx';
import ChainView from '../components/ChainView.jsx';
import WinnerModal from '../components/WinnerModal.jsx';

export default function Detail() {
  const { id } = useParams();
  const { me, toast } = useApp();
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [runKey, setRunKey] = useState(0); // 0: 연출 없이 결과만, 1 이상: 연출 재생
  const [modal, setModal] = useState(false);
  const boxRef = useRef(null); // 연출 영역 (전체화면으로 키울 대상)
  const [full, setFull] = useState(false);
  const [server, setServer] = useState(null); // 서버 검증 결과
  const [local, setLocal] = useState(null); // 브라우저 검증 결과
  const [chain, setChain] = useState(null);
  const [rec, setRec] = useState(null); // 물리 방식(구슬 레이스, 로또 추첨기)의 경기 기록 { raw, data }
  const [pw, setPw] = useState(''); // 비밀번호가 걸린 추첨에 참여할 때 입력하는 값

  const load = useCallback(async () => {
    try {
      setD((await api('/draws/' + id)).draw);
    } catch (e) {
      toast(e.message);
      nav('/');
    }
  }, [id, nav, toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 추첨 화면이 바뀔 때 이전 상태를 초기화한다 (의도된 effect 내 setState)
    setD(null);
    setRunKey(0);
    setModal(false);
    setServer(null);
    setLocal(null);
    setRec(null);
    load();
  }, [id, load]);

  // 실시간(폴링): 추첨이 끝나기 전까지 2.5초마다 상태를 확인한다. 다른 사람의 참여/마감이 반영되고,
  // 상태가 "추첨 완료"로 바뀌는 순간 열려 있는 모든 화면이 연출을 시작한다. (서버리스에서는 SSE 를 쓸 수 없어서 폴링)
  const dRef = useRef(null);
  useEffect(() => {
    dRef.current = d;
  });
  useEffect(() => {
    let busy = false;
    const poll = async () => {
      const cur = dRef.current;
      if (busy || document.hidden || !cur || cur.status === 'drawn') return;
      busy = true;
      try {
        const nd = (await api('/draws/' + id)).draw;
        if (JSON.stringify(nd) !== JSON.stringify(dRef.current)) {
          const justDrawn =
            dRef.current &&
            dRef.current.status !== 'drawn' &&
            nd.status === 'drawn';
          setD(nd);
          if (justDrawn) setRunKey((k) => (k === 0 ? 1 : k));
        }
      } catch {
        /* 일시적인 오류는 다음 주기에 다시 시도 */
      }
      busy = false;
    };
    const t = setInterval(poll, 2500);
    const onVisible = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [id]);

  // 결과가 있으면 서버를 거치지 않고 브라우저에서 직접 다시 계산해 본다.
  const hasResult = !!(d && d.result);
  const isPhysics = !!(d && d.result && isPhysicsAlgo(d.result.algo));
  const isLotto = !!(d && d.result && d.result.algo === LOTTO_ALGO);

  // 물리 방식은 경기 기록(모든 공의 움직임)을 따로 받아 온다
  useEffect(() => {
    if (!isPhysics) return undefined;
    let alive = true;
    api(`/draws/${id}/recording`)
      .then((x) => {
        if (alive) setRec({ raw: x.raw, data: JSON.parse(x.raw) });
      })
      .catch(() => {
        if (alive) setRec({ raw: null, data: null });
      });
    return () => {
      alive = false;
    };
  }, [isPhysics, id, d && d.result && d.result.hash]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hasResult) return undefined;
    if (isPhysics && !rec) return undefined; // 기록을 받은 뒤에 검증
    let alive = true;
    (async () => {
      let c = null;
      try {
        c = await api('/results');
      } catch {
        /* 체인 정보 없이 검증 */
      }
      if (alive) setChain(c);
      if (!canVerify()) {
        if (alive) setLocal({ unsupported: true });
        return;
      }
      const checks = await verifyInBrowser(
        d.result,
        d.id,
        c ? c.results : null,
        rec ? rec.raw : null
      );
      if (alive) setLocal({ checks, ok: checks.every((x) => x.ok) });
    })().catch(() => alive && setLocal({ unsupported: true }));
    return () => {
      alive = false;
    };
  }, [hasResult, isPhysics, rec, d && d.result && d.result.hash]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (path, msg, confirmMsg, body) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    try {
      await api(`/draws/${id}/${path}`, { method: 'POST', body });
      if (msg) toast(msg);
      await load();
      if (path === 'run') setRunKey((k) => (k === 0 ? 1 : k));
    } catch (e) {
      toast(e.message);
    }
  };

  const doVerify = async () => {
    try {
      setServer(await api(`/draws/${id}/verify`));
    } catch (e) {
      toast(e.message);
    }
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast('링크를 복사했어요');
    } catch {
      toast('링크 복사에 실패했어요');
    }
  };
  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === boxRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const toggleFull = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await boxRef.current.requestFullscreen();
    } catch {
      toast('이 브라우저에서는 전체화면을 쓸 수 없어요');
    }
  };
  const replay = () => {
    setModal(false);
    setRunKey((k) => k + 1);
  };

  if (!d)
    return (
      <Layout title="추첨" back>
        <div className="empty">불러오는 중…</div>
      </Layout>
    );
  const r = d.result;
  // 물리 방식 도입 전에 추첨된 구슬 레이스 결과에는 경기 기록이 없어서 룰렛으로 재생한다
  const legacyMarbles = d.style === 'marbles' && !!r && r.algo !== RACE_ALGO;
  // 룰렛은 물리 방식으로 바뀐 뒤의 결과만 3D 로 재생하고, 그 전 결과는 예전 2D 룰렛으로 재생한다
  const physicsWheel = d.style === 'wheel' && !!r && r.algo === ROULETTE_ALGO;
  const Stage = legacyMarbles
    ? Wheel
    : physicsWheel
      ? Roulette
      : {
          wheel: Wheel,
          cards: Cards,
          marbles: Marbles,
          ladder: Ladder,
          lotto: Lotto,
          siege: Siege,
        }[d.style] || Wheel;
  const live = d.status === 'drawing';

  return (
    <Layout title={d.title} back>
      <div className="card">
        <div className="row between">
          <h3>
            {d.no != null && <span className="no">No.{d.no}</span>}
            {d.title}
          </h3>
          <span className={'badge ' + badgeClass(d.status)}>
            {STATUS[d.status]}
          </span>
        </div>
        {d.description && <p>{d.description}</p>}
        <div className="muted">
          {STYLE_LABEL[d.style]} · 당첨 {d.winnerCount}명 · 참여{' '}
          {d.participantCount}명 · ✍️ {d.creator} 개설
        </div>
        <div className="row between" style={{ marginTop: 6 }}>
          <span className="muted">🗓️ 추첨 예정 {fmt(d.drawAt)}</span>
          <Countdown at={d.drawAt} status={d.status} />
        </div>
        {live && <div className="live">🔴 지금 추첨 중이에요…</div>}

        {d.status === 'open' &&
          (d.joined ? (
            <button
              className="btn block"
              onClick={() => act('leave', '참여를 취소했어요')}
            >
              참여 취소
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                act(
                  'join',
                  '참여했어요',
                  null,
                  d.hasPassword ? { password: pw } : undefined
                );
              }}
            >
              {d.hasPassword && (
                <input
                  className="join-pw"
                  type="password"
                  required
                  autoComplete="off"
                  placeholder="🔒 참여 비밀번호"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                />
              )}
              <button className="btn primary block" type="submit">
                참여하기
              </button>
            </form>
          ))}
        {d.status === 'open' && d.canManage && (
          <button
            className="btn block"
            onClick={() =>
              act(
                'close',
                '마감했어요',
                '참여를 마감할까요? 마감하면 참가자가 확정되고 되돌릴 수 없어요.'
              )
            }
          >
            참여 마감하기 (현재 {d.participantCount}명)
          </button>
        )}
        {d.status === 'closed' && d.canManage && (
          <button
            className="btn primary block"
            onClick={() =>
              act(
                'run',
                null,
                '추첨을 실행할까요? 화면을 열어둔 참여자 모두에게 실시간으로 공개되고, 결과는 바꿀 수 없어요.'
              )
            }
          >
            🎲 추첨 실행
          </button>
        )}
        {d.status === 'closed' && !d.canManage && (
          <div className="muted" style={{ marginTop: 8 }}>
            마감됐어요. 이 화면을 열어두면 추첨을 만든 사람이 실행하는 순간 함께
            볼 수 있어요.
          </div>
        )}
      </div>

      {r && (
        <>
          <div className="section-title">
            추첨 결과 #{r.seq}{' '}
            {local && local.ok && (
              <span className="verified">🔒 브라우저 검증 완료</span>
            )}
          </div>
          <div className="card">
            <div ref={boxRef} className={'stage-box' + (full ? ' full' : '')}>
              {runKey > 0 ? (
                isPhysics && !(rec && rec.data) ? (
                  <div className="empty">경기 기록을 불러오는 중…</div>
                ) : (
                  <Stage
                    result={r}
                    runKey={runKey}
                    recording={rec && rec.data}
                    meId={me.id}
                    onDone={() => setModal(true)}
                  />
                )
              ) : (
                <div className="winner-banner">
                  🎉 {r.winners.map((w) => w.nickname).join(', ')}
                </div>
              )}
              {runKey > 0 && document.fullscreenEnabled && (
                <button
                  type="button"
                  className="btn small full-btn"
                  onClick={toggleFull}
                >
                  {full ? '✕ 전체화면 닫기' : '⛶ 전체화면'}
                </button>
              )}
              {/* 전체화면에서는 이 영역 안의 것만 보이므로 당첨 팝업도 여기에 둔다 */}
              {modal && (
                <WinnerModal
                  winners={r.winners}
                  meId={me.id}
                  onClose={() => setModal(false)}
                />
              )}
            </div>
            <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
              <button className="btn" onClick={replay}>
                ▶ 연출 다시 보기
              </button>
              <button className="btn" onClick={copyLink}>
                🔗 링크 복사
              </button>
            </div>
          </div>
          <div className="card">
            <h3>🏆 당첨자 ({r.winners.length}명)</h3>
            <div className="chips">
              {r.winners.map((w) => (
                <span
                  key={w.id}
                  className={'chip win' + (w.id === me.id ? ' me' : '')}
                >
                  {w.nickname}
                </span>
              ))}
            </div>
            <div className="muted" style={{ marginTop: 8 }}>
              {fmt(r.drawnAt)} 추첨 · 저장된 결과는 바꿀 수 없어요
            </div>
          </div>

          <div className="card">
            <h3>🔎 직접 검증</h3>
            <div className="muted" style={{ marginBottom: 6 }}>
              서버 말을 믿지 않아도 돼요. 이 브라우저가 공개된 값으로 직접 다시
              계산한 결과예요.
            </div>
            {!local && <div className="muted">계산 중…</div>}
            {local && local.unsupported && (
              <div className="muted">
                이 환경(http 주소 등)에서는 브라우저 검증을 쓸 수 없어요. https
                또는 localhost 에서 열어주세요.
              </div>
            )}
            {local && local.checks && (
              <>
                {local.checks.map((c) => (
                  <div
                    key={c.label}
                    className={'check ' + (c.ok ? 'ok' : 'no')}
                  >
                    {c.label}
                  </div>
                ))}
                <div className={'check ' + (local.ok ? 'ok' : 'no')}>
                  <b>
                    {local.ok
                      ? '모든 검증을 통과했어요'
                      : '검증에 실패한 항목이 있어요'}
                  </b>
                </div>
              </>
            )}
            {isPhysics && (
              <div className="muted" style={{ marginTop: 6 }}>
                물리 시뮬레이션이 정말 그 기록을 만드는지는 브라우저마다 계산이
                미세하게 달라 여기서 다시 돌리지 않아요. 대신{' '}
                <b>서버에서도 검증하기</b>가 같은 seed 로 경기를 처음부터 다시
                돌려 기록이 한 글자도 다르지 않은지 확인해요.
              </div>
            )}
            <button className="btn block" onClick={doVerify}>
              {isPhysics
                ? '서버에서 경기를 다시 돌려 검증하기'
                : '서버에서도 검증하기'}
            </button>
            {server && (
              <div style={{ marginTop: 6 }}>
                {server.checks.map((c) => (
                  <div
                    key={c.label}
                    className={'check ' + (c.ok ? 'ok' : 'no')}
                  >
                    {c.label}
                  </div>
                ))}
              </div>
            )}
            <details style={{ marginTop: 10 }}>
              <summary className="muted">공개 정보 보기</summary>
              <dl className="kv" style={{ marginTop: 8 }}>
                <dt>알고리즘</dt>
                <dd>{r.algo}</dd>
                {r.engine && (
                  <>
                    <dt>물리 엔진</dt>
                    <dd>{r.engine}</dd>
                  </>
                )}
                {r.recordingHash && (
                  <>
                    <dt>경기 기록 해시</dt>
                    <dd>{r.recordingHash}</dd>
                  </>
                )}
                <dt>seed</dt>
                <dd>{r.seed}</dd>
                <dt>commitment</dt>
                <dd>{r.commitment}</dd>
                <dt>참가자 해시</dt>
                <dd>{r.participantsHash}</dd>
                <dt>직전 해시</dt>
                <dd>{r.prevHash}</dd>
                <dt>결과 해시</dt>
                <dd>{r.hash}</dd>
              </dl>
              {r.algo === SIEGE_ALGO ? (
                <p className="muted">
                  마감 때 봉인한 seed 로 병사가 서는 자리, 달리기·오르기 속도,
                  물대포·물총·물바가지를 쓰는 타이밍과 목표를 정한 뒤, 서버가
                  병사 시뮬레이션을 끝까지 돌려요. 두 줄로 오르는 사다리 6개
                  아래에서 병사들이 줄 없이 뒤엉켜 밀치고, 줄이 비는 순간 발치에
                  손이 닿는 병사 중 아직 못 타 본 사람이, 그다음은 가장 가까운
                  사람이 올라요(사다리 위에서는 추월 없음). 공성추가 성문을
                  두드리다가 성벽 꼭대기에 오른 인원이 정원의 60%가 되는 순간
                  문이 부서지고(언제나 정원이 차기 전), 그 뒤로는 성문으로도
                  들어갈 수 있지만 안뜰 물대포가 몰려오는 병사를 뒤로 밀어내요.
                  문이 부서지는 순간 성 안에서 기마병이 쏟아져 나와 seed 로 정한
                  길로 들판을 휘젓고, 말에 닿은 병사는 크게 밀려나요. 성벽 위
                  통로에 발을 디디거나 성문 안쪽 도착선을 넘은 순서를 합쳐 먼저
                  들어온 {r.winnerCount}명이 당첨이에요. 물에 맞으면 넘어지거나
                  밀려나고 사다리에서 떨어지지만, 다시 일어나 도전해요(탈락
                  없음, 한 명당 최대 2번). 화면은 저장된 기록을 그대로 재생할
                  뿐이에요.
                </p>
              ) : r.algo === ROULETTE_ALGO ? (
                <p className="muted">
                  마감 때 봉인한 seed 로 칸 배치, 휠 회전 속도, 공을 던지는
                  위치와 세기를 정한 뒤, 서버가 3D 물리 엔진으로 룰렛을 끝까지
                  돌려요. 공이 다이아몬드에 튕기고 칸막이 사이를 오가다 멈춘
                  칸의 주인이 당첨이에요. 휠은 처음부터 끝까지 같은 속도로 돌고,
                  여러 명이면 남은 사람끼리 칸을 똑같이 다시 나눈 뒤 다시
                  굴려요. 화면은 저장된 녹화를 그대로 재생할 뿐이에요.
                </p>
              ) : isLotto ? (
                <p className="muted">
                  마감 때 봉인한 seed 로 공의 처음 위치와 바람(돌풍)의
                  세기·방향을 정한 뒤, 서버가 3D 물리 엔진으로 추첨기를 끝까지
                  돌려요. 바람에 섞이다가 꼭대기 구멍으로 먼저 빨려 올라간{' '}
                  {r.winnerCount}개의 공이 당첨이고, 특정 공을 구멍 쪽으로
                  유도하지 않아요. 화면은 저장된 녹화를 그대로 재생할 뿐이에요.
                </p>
              ) : r.algo === RACE_ALGO ? (
                <p className="muted">
                  마감 때 봉인한 seed 로 구슬의 출발 위치를 무작위로 배치한 뒤,
                  서버가 물리 엔진으로 경기를 끝까지 돌려요. 결승선에 먼저
                  들어온 {r.winnerCount}명이 당첨이고, 경기 중 누구도 유도하지
                  않아요. 화면은 저장된 경기 기록을 그대로 재생할 뿐이에요.
                </p>
              ) : (
                <p className="muted">
                  참가자 id 를 정렬한 뒤, seed 로 HMAC-SHA256 난수를 만들어
                  Fisher-Yates 로 섞고 앞에서 {r.winnerCount}명을 뽑아요. 연출은
                  이미 확정된 결과를 보여주는 애니메이션이에요.
                </p>
              )}
            </details>
          </div>

          <div className="card">
            <h3>⛓ 결과 체인</h3>
            <div className="muted" style={{ marginBottom: 8 }}>
              모든 결과는 직전 결과의 해시를 품고 있어서, 하나라도 바뀌면 이후가
              모두 끊겨요.
            </div>
            <ChainView chain={chain} highlight={r.seq} />
          </div>
        </>
      )}

      {d.commitment && (
        <>
          <div className="section-title">추첨 전 공개된 값 (마감 시 확정)</div>
          <div className="card">
            <dl className="kv">
              <dt>commitment</dt>
              <dd>{d.commitment}</dd>
              <dt>참가자 해시</dt>
              <dd>{d.participantsHash}</dd>
            </dl>
            <div className="muted" style={{ marginTop: 8 }}>
              commitment 는 추첨에 쓸 난수(seed)의 해시예요. 추첨이 끝나면 seed
              가 공개되고, 해시가 일치하는지로 마감 후 바뀌지 않았음을 확인할 수
              있어요.
            </div>
          </div>
        </>
      )}

      {d.participants ? (
        <>
          <div className="section-title">참여자 {d.participants.length}명</div>
          <div className="card chips">
            {d.participants.map((p) => (
              <span
                key={p.id}
                className={'chip' + (p.id === me.id ? ' me' : '')}
              >
                {p.nickname}
              </span>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="section-title">참여자</div>
          <div className="card muted">
            참여한 회원만 참여자와 결과를 볼 수 있어요. (참여 인원{' '}
            {d.participantCount}명)
          </div>
        </>
      )}
    </Layout>
  );
}
