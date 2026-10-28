import { useEffect } from 'react';
import Confetti from './Confetti.jsx';
import { win } from '../sfx.js';

export default function WinnerModal({ winners, meId, onClose }) {
  useEffect(() => {
    win();
  }, []);
  const iWon = winners.some((w) => w.id === meId);

  return (
    <div className="modal-bg" onClick={onClose}>
      <Confetti />
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-emoji">{iWon ? '🎉' : '🏆'}</div>
        <div className="muted">{iWon ? '축하해요! 당첨됐어요' : '당첨자'}</div>
        <div className="modal-names">
          {winners.map((w, i) => (
            <div
              key={w.id}
              className={'modal-name' + (w.id === meId ? ' me' : '')}
              style={{ animationDelay: `${i * 0.12}s` }}
            >
              {w.nickname}
            </div>
          ))}
        </div>
        <button className="btn primary" onClick={onClose}>
          확인
        </button>
      </div>
    </div>
  );
}
