import { useEffect, useState } from 'react';
import './KnightSkit.css';

// 로그인 화면용 15초 Vox 스타일 콩트 "미더라 기사와 현실 종자"
// 각 요소가 나타나는(in)·사라지는(out) 시각을 초 단위 CSS 변수로 넘긴다
const at = (inSec, outSec) => ({
  '--in': `${inSec}s`,
  ...(outSec != null && { '--out': `${outSec}s` }),
});

const KNIGHT = '/characters/knight.webp';
const SQUIRE = '/characters/squire.webp';

// 형광펜 강조. t초에 칠해진다
function Hl({ t, children }) {
  return (
    <mark className="sk-hl" style={{ '--hl': `${t}s` }}>
      {children}
    </mark>
  );
}

export default function KnightSkit() {
  // 움직임 줄이기 설정이면 자동 재생하지 않고, 사용자가 버튼을 누를 때만 재생한다
  const [calm] = useState(
    () =>
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );
  const [forced, setForced] = useState(false);
  const [ready, setReady] = useState(false);
  const [run, setRun] = useState(0);
  const [ended, setEnded] = useState(false);

  // 이미지를 먼저 받아 두고 재생한다 (느린 망에서 빈 화면으로 시작하지 않게)
  useEffect(() => {
    let alive = true;
    const load = (src) =>
      new Promise((done) => {
        const img = new Image();
        img.onload = img.onerror = done;
        img.src = src;
      });
    Promise.all([load(KNIGHT), load(SQUIRE)]).then(
      () => alive && setReady(true)
    );
    return () => {
      alive = false;
    };
  }, []);

  const replay = () => {
    setForced(true);
    setEnded(false);
    setRun((r) => r + 1);
  };
  const playing = ready && (!calm || forced);

  return (
    <figure className={`skit${forced ? ' sk-forced' : ''}`}>
      <div
        key={run}
        className={`sk-stage${playing ? ' is-playing' : ''}`}
        aria-hidden="true"
        onAnimationEnd={(e) =>
          e.animationName === 'sk-blackout' && setEnded(true)
        }
      >
        {/* 캐릭터가 있는 층. 카메라 이동(확대·축소)은 이 층에만 건다 */}
        <div className="sk-world">
          <div className="sk-burst sk-show" style={at(6.3, 9.9)} />

          <div className="sk-squire">
            <div className="sk-nod">
              <img src={SQUIRE} alt="" draggable="false" />
            </div>
          </div>
          <div className="sk-sweat sk-show" style={at(10.5)}>
            <i />
            <i />
            <i />
            <i />
          </div>

          <div className="sk-knight">
            <div className="sk-breathe">
              <svg
                className="sk-cape"
                viewBox="0 0 393 560"
                preserveAspectRatio="none"
              >
                <g className="sk-cape-flap">
                  <path
                    className="sk-cape-back"
                    d="M128 250 C170 232 262 232 302 250 L352 478 C305 500 255 478 216 500 C178 478 128 500 84 478 Z"
                  />
                  <path
                    className="sk-cape-fold"
                    d="M150 262 L118 470 M196 260 L180 488 M262 262 L292 484"
                  />
                </g>
              </svg>
              <img src={KNIGHT} alt="" draggable="false" />
            </div>
          </div>

          <div className="sk-wind sk-show" style={at(3.2, 5.9)}>
            <svg viewBox="0 0 60 60">
              <path pathLength="1" d="M58 12 C40 8 26 18 6 14" />
              <path pathLength="1" d="M58 30 C42 26 30 36 12 32" />
              <path pathLength="1" d="M58 48 C44 44 34 52 18 50" />
            </svg>
          </div>
          <svg
            className="sk-arrow sk-show"
            style={at(3.3, 5.9)}
            viewBox="0 0 40 80"
          >
            <path pathLength="1" d="M22 76 C16 56 26 34 20 8" />
            <path pathLength="1" d="M8 22 L20 6 L32 20" />
          </svg>
          <div className="sk-sparks sk-show" style={at(3.4, 5.9)}>
            <i>✦</i>
            <i>✦</i>
            <i>✦</i>
          </div>

          <div className="sk-fist sk-show" style={at(13.0, 14.3)}>
            <span>👊</span>
            <svg viewBox="0 0 40 40">
              <path pathLength="1" d="M14 6 L30 22 M6 14 L30 38 M22 4 L38 20" />
            </svg>
          </div>
        </div>

        {/* 화면 위에 고정되는 글자·라벨 층 */}
        <div className="sk-chapter">
          <b>EP.01</b> 미더라 기사와 현실 종자
        </div>

        <div className="sk-caption sk-show" style={at(0.3, 2.9)}>
          <p>
            알면서도 모른 척하는 <Hl t={1.0}>낭만</Hl>,
          </p>
          <p className="sk-show" style={at(1.4)}>
            그 <Hl t={1.9}>믿음</Hl> 하나 지키는 거.
          </p>
        </div>

        <div className="sk-caption sk-show" style={at(3.1, 5.9)}>
          <p>
            아껴주는 만큼 <Hl t={3.6}>여물고</Hl>,
          </p>
          <p className="sk-show" style={at(4.1)}>
            인정받는 만큼 <Hl t={4.6}>성장</Hl>하니까.
          </p>
          <svg
            className="sk-spark-line sk-show"
            style={at(4.6)}
            viewBox="0 0 120 40"
          >
            <path className="sk-grid" d="M0 39.5 H120 M0 20 H120" />
            <path pathLength="1" d="M2 36 L30 30 L54 32 L80 18 L116 4" />
            <circle cx="116" cy="4" r="3.5" />
          </svg>
        </div>

        <div className="sk-caption sk-show" style={at(6.1, 9.9)}>
          <p>그래서 오늘도…</p>
          <p className="sk-big sk-pop" style={at(7.3)}>
            <span className="sk-circled">
              개멋
              <svg viewBox="0 0 100 50" preserveAspectRatio="none">
                <path
                  pathLength="1"
                  d="M8 30 C4 10 40 2 70 6 C96 10 98 34 72 44 C46 52 10 46 6 30 C4 20 20 12 34 10"
                />
              </svg>
            </span>{' '}
            한번 부려보는 거다.
          </p>
        </div>

        <div className="sk-tag sk-tag-knight sk-show sk-poster" style={at(0.8)}>
          <b>01</b> 미더라 기사
        </div>

        <div className="sk-card sk-show sk-poster" style={at(10.7)}>
          <div className="sk-tag">
            <b>02</b> 현실 종자
          </div>
          <div className="sk-gauge">
            <span>영혼</span>
            <i>
              <i />
            </i>
            <b>0%</b>
          </div>
        </div>

        <div className="sk-bubble sk-show" style={at(11.0, 12.4)}>
          누ㅔ누ㅔ~
        </div>
        <div className="sk-thought sk-show" style={at(12.4)}>
          <span className="sk-who">속마음</span>
          <p>팎씨~ 언제 기사 되냐... 탈출 마렵다</p>
        </div>
        <div className="sk-note sk-show" style={at(13.3)}>
          꿀밤
          <br />
          (시늉만)
          <span>↓</span>
        </div>

        <div className="sk-black" />
      </div>

      {calm && !forced && (
        <button type="button" className="sk-play" onClick={replay}>
          ▶ 쇼츠 보기
        </button>
      )}

      {ended && (
        <div className="sk-end">
          <p>
            <mark>미더라 기사</mark>와 현실 종자
          </p>
          <button type="button" onClick={replay}>
            ↻ 다시 보기
          </button>
        </div>
      )}

      <figcaption className="sk-sr">
        미더라 기사와 현실 종자. 기사: 알면서도 모른 척하는 낭만, 그 믿음 하나
        지키는 거. 아껴주는 만큼 여물고, 인정받는 만큼 성장하니까. 그래서
        오늘도… 개멋 한번 부려보는 거다. 종자: 누ㅔ누ㅔ~ (속마음: 팎씨~ 언제
        기사 되냐... 탈출 마렵다)
      </figcaption>
    </figure>
  );
}
