import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, STYLE_CAPACITY, capacityText } from '../api.js';
import { useApp } from '../AppContext.js';
import Layout from '../components/Layout.jsx';

// datetime-local 입력용 기본값: 지금부터 한 시간 뒤, 정각 (로컬 시간)
function defaultDrawAt() {
  const d = new Date(Date.now() + 3600 * 1000);
  d.setMinutes(0, 0, 0);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`;
}

export default function New() {
  const { toast } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({
    title: '',
    description: '',
    winnerCount: 1,
    style: 'marbles',
    drawAt: defaultDrawAt(),
    password: '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    try {
      const when = new Date(f.drawAt);
      if (isNaN(when.getTime())) {
        toast('추첨 날짜와 시간을 확인해줘');
        return;
      }
      const { draw } = await api('/draws', {
        method: 'POST',
        body: {
          ...f,
          winnerCount: Number(f.winnerCount),
          drawAt: when.toISOString(),
        },
      });
      toast(`추첨을 만들었어요 (No.${draw.no})`);
      nav('/draw/' + draw.id);
    } catch (err) {
      toast(err.message);
    }
  };

  return (
    <Layout title="새 추첨" back>
      <form className="card" onSubmit={submit}>
        <div className="field">
          <label>추첨 이름</label>
          <input
            maxLength={60}
            required
            placeholder="예: 간식 쏘기 추첨"
            value={f.title}
            onChange={set('title')}
          />
        </div>
        <div className="field">
          <label>설명 (선택)</label>
          <textarea
            maxLength={300}
            value={f.description}
            onChange={set('description')}
          />
        </div>
        <div className="field">
          <label>추첨 날짜 · 시간</label>
          <input
            type="datetime-local"
            required
            value={f.drawAt}
            onChange={set('drawAt')}
          />
        </div>
        <div className="field">
          <label>당첨 인원</label>
          <input
            type="number"
            min={1}
            max={
              STYLE_CAPACITY[f.style]?.limit
                ? STYLE_CAPACITY[f.style].winners
                : 100
            }
            required
            value={f.winnerCount}
            onChange={set('winnerCount')}
          />
        </div>
        <div className="field">
          <label>참여 비밀번호 (선택)</label>
          <input
            type="text"
            minLength={4}
            maxLength={30}
            autoComplete="off"
            placeholder="비워 두면 누구나 참여할 수 있어요"
            value={f.password}
            onChange={set('password')}
          />
          <div className="muted" style={{ marginTop: 6 }}>
            참여자에게 따로 알려주세요. 만든 뒤에는 다시 볼 수 없어요.
          </div>
        </div>
        <div className="field">
          <label>연출 방식</label>
          <div className="style-pick">
            {[
              ['lotto', '🎱 로또 추첨기'],
              ['marbles', '🏁 구슬 레이스'],
              ['ladder', '🪜 사다리타기'],
              ['wheel', '🎡 룰렛'],
              ['cards', '🃏 카드 뒤집기'],
            ].map(([v, text]) => (
              <label key={v}>
                <input
                  type="radio"
                  name="style"
                  checked={f.style === v}
                  onChange={() => setF({ ...f, style: v })}
                />
                {text}
              </label>
            ))}
          </div>
          {STYLE_CAPACITY[f.style] && (
            <div className="style-cap">
              <b>{capacityText(f.style)}</b>
              <span>{STYLE_CAPACITY[f.style].why}</span>
              {Number(f.winnerCount) > STYLE_CAPACITY[f.style].winners && (
                <span className="warn">
                  {STYLE_CAPACITY[f.style].limit
                    ? `이 방식은 당첨 인원을 ${STYLE_CAPACITY[f.style].winners}명까지 정할 수 있어요`
                    : '권장보다 당첨 인원이 많아서 연출이 길어질 수 있어요'}
                </span>
              )}
            </div>
          )}
        </div>
        <button className="btn primary block" type="submit">
          추첨 만들기
        </button>
      </form>
    </Layout>
  );
}
