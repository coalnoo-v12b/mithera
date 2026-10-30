import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, STYLE_LABEL, capacityText } from '../api.js';
import { useApp } from '../AppContext.js';
import Logo from '../components/Logo.jsx';
import ScrollCrest from '../components/ScrollCrest.jsx';
import { isDark, setTheme } from '../theme.js';

const STEPS = [
  {
    icon: '🔒',
    title: '봉인',
    text: '마감하는 순간 난수(seed)를 만들고, 그 해시만 먼저 공개해요. 이후에는 아무도 결과를 유도할 수 없어요.',
  },
  {
    icon: '🎲',
    title: '추첨',
    text: '봉인된 seed와 확정된 참가자 목록으로 당첨자를 정해요. 같은 입력이면 언제나 같은 결과가 나와요.',
  },
  {
    icon: '🔎',
    title: '검증',
    text: '누구나 같은 계산을 다시 해서 확인할 수 있어요. 결과는 해시로 이어져 한 글자도 바꿀 수 없어요.',
  },
];

const STYLE_TEXT = {
  wheel: '돌아가는 휠 위에서 공이 멈춘 칸의 주인이 당첨돼요',
  cards: '뒤집힌 카드가 한 장씩 열려요',
  marbles: '물리 엔진 위에서 구슬이 결승선으로 달려요',
  ladder: '사다리를 타고 내려가 결과에 도착해요',
  lotto: '바람에 섞인 공 중 구멍으로 먼저 올라온 공이 당첨돼요',
  siege:
    '병사 수백 명이 사다리와 부서진 성문으로 몰려가고, 먼저 성에 들어온 순서대로 당첨돼요',
};

const CHECKS = [
  'seed가 마감 때 공개한 commitment와 일치',
  '참가자 목록이 마감 때 확정한 해시와 일치',
  '공개된 알고리즘으로 다시 계산한 당첨자가 저장된 결과와 일치',
  '결과 해시가 내용과 일치 (변조 없음)',
  '직전 결과와 해시 체인이 이어짐',
];

const MARBLES = [
  { c: '#f472b6', s: 26, x: '8%', y: '14%', d: '0s' },
  { c: '#60a5fa', s: 18, x: '84%', y: '10%', d: '0.6s' },
  { c: '#fbbf24', s: 22, x: '92%', y: '52%', d: '1.1s' },
  { c: '#34d399', s: 16, x: '4%', y: '58%', d: '0.3s' },
  { c: '#a78bfa', s: 20, x: '74%', y: '80%', d: '0.9s' },
  { c: '#fb7185', s: 14, x: '22%', y: '84%', d: '1.4s' },
];

// 0 에서 target 까지 숫자가 올라간다. 움직임을 줄이는 설정이면 바로 최종값을 보여준다.
function useCountUp(target, ms = 1100) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    const t0 = performance.now();
    let raf;
    const tick = (now) => {
      const p = reduce ? 1 : Math.min(1, (now - t0) / ms);
      setValue(Math.round(target * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

function CountUp({ to }) {
  return <>{useCountUp(to).toLocaleString('ko-KR')}</>;
}

function Stats({ stats }) {
  return (
    <section className="lp-wrap">
      <div className="lp-stats">
        {stats.users != null && (
          <div className="card">
            <b>
              <CountUp to={stats.users} />
            </b>
            <span>총 회원수</span>
          </div>
        )}
        <div className="card">
          <b>
            <CountUp to={stats.drawn} />
          </b>
          <span>완료된 추첨</span>
        </div>
        <div className="card">
          <b>
            <CountUp to={stats.results} />
          </b>
          <span>해시 체인 블록</span>
        </div>
        <div className="card">
          <b>{stats.chainOk ? <CountUp to={0} /> : '⚠️'}</b>
          <span>{stats.chainOk ? '감지된 변조 ✅' : '변조가 감지됐어요'}</span>
        </div>
      </div>
    </section>
  );
}

function HeroVisual() {
  return (
    <div className="lp-visual" aria-hidden="true">
      {MARBLES.map((m) => (
        <span
          key={m.c}
          className="lp-marble"
          style={{
            '--c': m.c,
            width: m.s,
            height: m.s,
            left: m.x,
            top: m.y,
            animationDelay: m.d,
          }}
        />
      ))}
      <div className="lp-logo">
        <ScrollCrest size={116} />
      </div>
      <div className="lp-mini-chain">
        <div className="block">
          <b>#1</b>
          <code>a3f9…c21</code>
        </div>
        <span className="chain-link">→</span>
        <div className="block hl">
          <b>#2</b>
          <code>prev a3f9…</code>
        </div>
        <span className="chain-link">→</span>
        <div className="block">
          <b>#3</b>
          <code>prev 7be0…</code>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const nav = useNavigate();
  const { me } = useApp();
  const [dark, setDark] = useState(isDark());
  const [stats, setStats] = useState(null);

  useEffect(() => {
    // 통계는 덤이다. 실패하면 통계 띠만 보이지 않는다.
    api('/public-stats')
      .then(setStats)
      .catch(() => {});
  }, []);

  const toggleTheme = () => {
    setTheme(dark ? 'light' : 'dark');
    setDark(!dark);
  };
  const toHow = () =>
    document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' });
  // 로그인한 사람은 가입 대신 추첨 목록으로 보낸다
  const start = () => nav(me ? '/' : '/login?mode=signup');
  const startLabel = me ? '추첨 보러 가기' : '무료로 시작하기';

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap">
          <span className="lp-brand">
            <Logo size={28} />
            미더라
          </span>
          <button
            className="icon-btn sm"
            aria-label="테마"
            title="다크/라이트"
            onClick={toggleTheme}
          >
            {dark ? '☀️' : '🌙'}
          </button>
          <button
            className="btn small"
            onClick={() => nav(me ? '/' : '/login')}
          >
            {me ? '추첨 목록' : '로그인'}
          </button>
        </div>
      </header>

      <section className="lp-wrap lp-hero">
        <div className="lp-hero-text">
          <span className="lp-badge">🛡️ 검증 가능한 추첨</span>
          <h1 className="lp-title">
            결과를 바꿀 수 없는
            <br />
            <em>공정한 추첨</em>
          </h1>
          <p className="lp-sub">
            미더라는 추첨 결과를 저장하는 순간 잠가요. 누구나 자기 브라우저에서
            직접 다시 계산해 볼 수 있어요.
          </p>
          <div className="lp-cta">
            <button className="btn primary lg" onClick={start}>
              {startLabel}
            </button>
            <button className="btn lg" onClick={toHow}>
              어떻게 동작하나요
            </button>
          </div>
        </div>
        <HeroVisual />
      </section>

      {stats && <Stats stats={stats} />}

      <section className="lp-wrap lp-sec" id="how">
        <h2>봉인, 추첨, 검증</h2>
        <p className="lead">세 단계로 누구도 결과를 조작할 수 없게 만들어요.</p>
        <div className="lp-steps">
          {STEPS.map((s, i) => (
            <div className="card lp-step" key={s.title}>
              <span className="lp-num">{i + 1}</span>
              <div className="lp-icon">{s.icon}</div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-wrap lp-sec">
        <h2>보는 재미까지 챙긴 추첨</h2>
        <p className="lead">
          추첨 방식은 여섯 가지예요. 인원에 맞는 방식을 고르면 연출이 더
          자연스러워요.
        </p>
        <div className="lp-styles">
          {Object.entries(STYLE_LABEL).map(([key, label]) => {
            const [icon, ...name] = label.split(' ');
            return (
              <div className="card lp-style" key={key}>
                <span className={'lp-style-icon st-' + key}>{icon}</span>
                <h3>{name.join(' ')}</h3>
                <p>{STYLE_TEXT[key]}</p>
                {capacityText(key) && (
                  <p className="lp-style-cap">{capacityText(key)}</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="lp-wrap lp-sec">
        <h2>결과는 직접 확인하세요</h2>
        <p className="lead">
          추첨이 끝나면 아래 검사를 누구나 다시 돌려볼 수 있어요.
        </p>
        <div className="card lp-verify">
          <div className="lp-verify-head">
            <b>검증 결과</b>
            <span className="verified">모두 통과 ✔</span>
          </div>
          {CHECKS.map((c) => (
            <div className="check ok" key={c}>
              {c}
            </div>
          ))}
        </div>
      </section>

      <section className="lp-wrap">
        <div className="lp-final">
          <h2>믿을 수 있는 추첨, 지금 시작해요</h2>
          <p>
            {me
              ? '지금 열려 있는 추첨을 확인해 보세요.'
              : '가입은 이메일과 닉네임만 있으면 돼요.'}
          </p>
          <button className="btn light lg" onClick={start}>
            {startLabel}
          </button>
        </div>
      </section>

      <footer className="lp-footer">
        © 미더라 · Midura
        <p className="legal-links">
          <Link to="/terms">이용약관</Link> ·{' '}
          <Link to="/privacy">개인정보처리방침</Link>
        </p>
      </footer>
    </div>
  );
}
