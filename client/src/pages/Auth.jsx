import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../AppContext.js';
import Logo from '../components/Logo.jsx';

export default function Auth() {
  const { setMe, toast } = useApp();
  const [signup, setSignup] = useState(false);
  const [f, setF] = useState({ nickname: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

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
    <section className="auth">
      <div className="logo">
        <Logo size={72} />
      </div>
      <h1>미더라</h1>
      <p className="sub">
        Midura · 결과를 바꿀 수 없고,
        <br />
        누구나 직접 검증할 수 있는 추첨
      </p>
      <ul className="auth-points">
        <li>🔒 마감할 때 난수를 먼저 봉인</li>
        <li>⛓ 결과는 해시로 이어져 수정 불가</li>
        <li>🔎 내 브라우저에서 직접 검증</li>
      </ul>
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
      <button className="link" type="button" onClick={() => setSignup(!signup)}>
        {signup ? '이미 계정이 있어요 → 로그인' : '계정이 없어요 → 회원가입'}
      </button>
    </section>
  );
}
