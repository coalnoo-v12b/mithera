import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../AppContext.js';
import KnightSkit from '../components/KnightSkit.jsx';
import Logo from '../components/Logo.jsx';

// 실험용: 로그인 페이지(Auth.jsx) 복사본에 Vox 스타일 콩트를 붙여 본다 (/#/login-vox)
// 괜찮으면 Auth.jsx에 KnightSkit을 옮기고 이 파일은 지운다
export default function AuthVox() {
  const { setMe, toast } = useApp();

  const [params] = useSearchParams();
  const [signup, setSignup] = useState(params.get('mode') === 'signup');
  const [f, setF] = useState({ nickname: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // 소셜 로그인 실패 후 서버가 ?error=google 처럼 제공자 이름을 붙여 돌려보냄
  const socialFailed = ['google', 'naver', 'kakao'].includes(
    params.get('error')
  );

  // 서버가 마지막 로그인 방식을 last_login 쿠키에 저장해 둔다
  const lastLogin = (document.cookie.match(/(?:^|; )last_login=([^;]*)/) ||
    [])[1];
  const lastBadge = (method) =>
    lastLogin === method ? (
      <span
        className={`last-badge ${method}-badge`}
        aria-label="마지막 로그인 방식"
        title="마지막 로그인 방식"
      >
        ✓
      </span>
    ) : null;
  useEffect(() => {
    if (socialFailed) toast('소셜 로그인에 실패했어요. 다시 시도해 주세요');
  }, [socialFailed, toast]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { email: f.email, password: f.password };
      if (signup) body.nickname = f.nickname;
      const { user } = await api(signup ? '/signup' : '/login', {
        method: 'POST',
        body,
      });
      setMe(user);
    } catch (err) {
      toast(err.message);
      setBusy(false);
    }
  };

  return (
    <section className="auth auth-vox">
      <KnightSkit />
      <div className="auth-panel">
        <div className="auth-brand">
          <Link to="/" className="logo" aria-label="홈으로">
            <Logo size={40} />
          </Link>
          <h1>미더라</h1>
        </div>
        <p className="sub">
          결과를 바꿀 수 없고,
          <br />
          누구나 직접 검증할 수 있는 추첨
        </p>
        <form onSubmit={submit}>
          {signup && (
            <input
              type="text"
              placeholder="닉네임"
              maxLength={20}
              required
              value={f.nickname}
              onChange={set('nickname')}
              autoComplete="nickname"
            />
          )}
          <input
            type="email"
            placeholder="이메일"
            required
            value={f.email}
            onChange={set('email')}
            autoComplete="email"
          />
          <input
            type="password"
            placeholder="비밀번호 (8자 이상)"
            required
            minLength={8}
            value={f.password}
            onChange={set('password')}
            autoComplete={signup ? 'new-password' : 'current-password'}
          />
          <button className="btn primary" type="submit" disabled={busy}>
            {signup ? '회원가입' : '로그인'}
          </button>
        </form>
        <div className="social-row">
          <a
            className="btn block google-btn"
            href="/api/auth/google"
            aria-label={signup ? '구글로 가입하기' : '구글로 로그인하기'}
            title={signup ? '구글로 가입하기' : '구글로 로그인하기'}
          >
            <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
            {lastBadge('google')}
          </a>
          <a
            className="btn block naver-btn"
            href="/api/auth/naver"
            aria-label={signup ? '네이버로 가입하기' : '네이버로 로그인하기'}
            title={signup ? '네이버로 가입하기' : '네이버로 로그인하기'}
          >
            <span className="naver-mark" aria-hidden="true">
              N
            </span>
            {lastBadge('naver')}
          </a>
          <a
            className="btn block kakao-btn"
            href="/api/auth/kakao"
            aria-label={signup ? '카카오로 가입하기' : '카카오로 로그인하기'}
            title={signup ? '카카오로 가입하기' : '카카오로 로그인하기'}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 3C6.48 3 2 6.58 2 11c0 2.8 1.86 5.27 4.66 6.67L5.5 21.5l4.24-2.8c.73.1 1.48.15 2.26.15 5.52 0 10-3.58 10-8S17.52 3 12 3z" />
            </svg>
            {lastBadge('kakao')}
          </a>
        </div>
        <button
          className="link"
          type="button"
          onClick={() => setSignup(!signup)}
        >
          {signup ? '이미 계정이 있어요 → 로그인' : '계정이 없어요 → 회원가입'}
        </button>
      </div>
    </section>
  );
}
