import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api, setUnauthorizedHandler } from './api.js';
import { AppCtx } from './AppContext.js';
import Auth from './pages/Auth.jsx';
import AuthOld from './pages/AuthOld.jsx';
import AuthVox from './pages/AuthVox.jsx';
import Landing from './pages/Landing.jsx';
import List from './pages/List.jsx';
import New from './pages/New.jsx';
import Detail from './pages/Detail.jsx';
import Admin from './pages/Admin.jsx';

// 실험용 3D 화면. three.js가 커서 이 경로에 들어올 때만 불러옴
const LottoLab = lazy(() => import('./lab/lotto/LottoLab.jsx'));
const lab = (kind) => (
  <Suspense fallback={null}>
    <LottoLab key={kind} kind={kind} />
  </Suspense>
);

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
          {/* 실험용·보관용 로그인 화면. 로그인 상태에서도 미리 볼 수 있게 둔다 */}
          <Route path="/login-vox" element={<AuthVox />} />
          <Route path="/login-old" element={<AuthOld />} />
          <Route path="/lab/lotto" element={lab('lotto')} />
          <Route path="/lab/roulette" element={lab('roulette')} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Auth />} />
          <Route path="/login-vox" element={<AuthVox />} />
          <Route path="/login-old" element={<AuthOld />} />
          <Route path="/lab/lotto" element={lab('lotto')} />
          <Route path="/lab/roulette" element={lab('roulette')} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </AppCtx.Provider>
  );
}
