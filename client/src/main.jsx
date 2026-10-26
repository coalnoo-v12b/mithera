import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import './style.css';
import { applyTheme, getTheme } from './theme.js';

applyTheme(getTheme());

createRoot(document.getElementById('root')).render(
  <HashRouter>
    <App />
  </HashRouter>
);
