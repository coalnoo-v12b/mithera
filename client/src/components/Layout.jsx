import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../AppContext.js';
import { isDark, setTheme } from '../theme.js';
import { isSoundOn, setSoundOn } from '../sfx.js';
import Logo from './Logo.jsx';

export default function Layout({ title, back = false, children }) {
  const { me, setMe, toast } = useApp();
  const nav = useNavigate();
  const [dark, setDark] = useState(isDark());
  const [sound, setSound] = useState(isSoundOn());

  const logout = async () => {
    try {
      await api('/logout', { method: 'POST' });
      setMe(null);
    } catch (e) {
      toast(e.message);
    }
  };
  const toggleTheme = () => {
    const next = !dark;
    setTheme(next ? 'dark' : 'light');
    setDark(next);
  };
  const toggleSound = () => {
    const next = !sound;
    setSoundOn(next);
    setSound(next);
  };

  return (
    <div id="app">
      <header id="topbar">
        {back ? (
          <button
            className="icon-btn"
            aria-label="뒤로"
            onClick={() => nav('/')}
          >
            ‹
          </button>
        ) : (
          <button className="brand" aria-label="홈" onClick={() => nav('/')}>
            <Logo size={28} />
          </button>
        )}
        <h2 id="title">{title || '미더라'}</h2>
        <button
          className="icon-btn sm"
          aria-label="효과음"
          title="효과음"
          onClick={toggleSound}
        >
          {sound ? '🔊' : '🔇'}
        </button>
        <button
          className="icon-btn sm"
          aria-label="테마"
          title="다크/라이트"
          onClick={toggleTheme}
        >
          {dark ? '☀️' : '🌙'}
        </button>
        {me.isAdmin && (
          <button className="link small" onClick={() => nav('/admin')}>
            관리자
          </button>
        )}
        <span id="who">{me.nickname}</span>
        <button className="link small" onClick={logout}>
          로그아웃
        </button>
      </header>
      <main id="main">{children}</main>
    </div>
  );
}
