import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api, setUnauthorizedHandler } from './api.js';
import { AppCtx } from './AppContext.js';
import Auth from './pages/Auth.jsx';
import Landing from './pages/Landing.jsx';
import List from './pages/List.jsx';
import New from './pages/New.jsx';
import Detail from './pages/Detail.jsx';
import Admin from './pages/Admin.jsx';

export default function App() {
  const [me, setMe] = useState(undefined); // undefined: 확인 중, null: 로그아웃
  const [msg, setMsg] = useState('');
  const timer = useRef();

  const toast = useCallback((m) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(''), 2400);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setMe(null));
    api('/me')
      .then((r) => setMe(r.user))
      .catch(() => setMe(null));
  }, []);

  if (me === undefined) return null;

  return (
    <AppCtx.Provider value={{ me, setMe, toast }}>
      <div id="toast" role="status" className={msg ? 'show' : ''}>
        {msg}
      </div>
      {me ? (
        <Routes>
          <Route path="/" element={<List />} />
          <Route path="/home" element={<Landing />} />
          <Route path="/new" element={<New />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/draw/:id" element={<Detail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Auth />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </AppCtx.Provider>
  );
}
