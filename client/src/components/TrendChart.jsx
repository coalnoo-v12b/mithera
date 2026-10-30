import { useId, useState } from 'react';

const W = 640;
const H = 220;
const M = { top: 12, right: 12, bottom: 24, left: 34 };
const IW = W - M.left - M.right;
const IH = H - M.top - M.bottom;

// yyyymmdd -> M/D
const md = (ymd) => `${Number(ymd.slice(4, 6))}/${Number(ymd.slice(6, 8))}`;

// 눈금이 깔끔하게 떨어지는 y 최대값
function niceMax(v) {
  if (v <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

// 하루 단위 추이 차트 (인라인 SVG). 꺾은선 또는 막대(누적 가능).
//   labels: yyyymmdd 배열, series: [{ key, label, color, values }]
//   kind: 'line' | 'bar', stacked: 막대를 쌓을지
export default function TrendChart({
  title,
  headline,
  labels,
  series,
  kind = 'bar',
  stacked = false,
}) {
  const [hover, setHover] = useState(null);
  const uid = useId();
  const n = labels.length;
  const totals = labels.map((_, i) =>
    stacked
      ? series.reduce((a, s) => a + s.values[i], 0)
      : Math.max(0, ...series.map((s) => s.values[i]))
  );
  const max = niceMax(Math.max(0, ...totals));
  const band = IW / n;
  const x = (i) => M.left + band * (i + 0.5);
  const y = (v) => M.top + IH - (v / max) * IH;
  const ticks = [0, 1, 2, 3, 4].map((k) => (max / 4) * k);
  const xTicks = Array.from(
    new Set([0, 1, 2, 3, 4].map((k) => Math.round(((n - 1) * k) / 4)))
  );

  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.min(n - 1, Math.max(0, Math.floor((px - M.left) / band))));
  };

  return (
    <div className="viz card">
      <div className="viz-head">
        <h3>{title}</h3>
        {headline && <span className="viz-headline">{headline}</span>}
      </div>
      {series.length > 1 && (
        <div className="viz-legend">
          {series.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="viz-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={title}
          onPointerMove={move}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={M.left}
                x2={W - M.right}
                y1={y(t)}
                y2={y(t)}
                className="viz-grid"
              />
              <text
                x={M.left - 6}
                y={y(t) + 4}
                className="viz-tick"
                textAnchor="end"
              >
                {Math.round(t)}
              </text>
            </g>
          ))}
          {xTicks.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={H - 6}
              className="viz-tick"
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
            >
              {md(labels[i])}
            </text>
          ))}

          {kind === 'bar' &&
            labels.map((_, i) => {
              let acc = 0;
              const w = Math.max(2, Math.min(band * 0.7, 28));
              return series.map((s) => {
                const v = s.values[i];
                if (!v) return null;
                const base = stacked ? acc : 0;
                if (stacked) acc += v;
                const top = y(base + v);
                const h = y(base) - top;
                return (
                  <rect
                    key={s.key + i}
                    x={x(i) - w / 2}
                    y={top}
                    width={w}
                    height={Math.max(h, 1)}
                    rx={2}
                    fill={s.color}
                    stroke="var(--card)"
                    strokeWidth={stacked ? 2 : 0}
                    opacity={hover === null || hover === i ? 1 : 0.45}
                  />
                );
              });
            })}

          {kind === 'line' &&
            series.map((s) => (
              <g key={s.key}>
                <polygon
                  points={[
                    `${x(0)},${y(0)}`,
                    ...s.values.map((v, i) => `${x(i)},${y(v)}`),
                    `${x(n - 1)},${y(0)}`,
                  ].join(' ')}
                  fill={s.color}
                  opacity={0.12}
                />
                <polyline
                  points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </g>
            ))}

          {hover !== null && (
            <g pointerEvents="none">
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={M.top}
                y2={M.top + IH}
                className="viz-cross"
              />
              {kind === 'line' &&
                series.map((s) => (
                  <circle
                    key={s.key}
                    cx={x(hover)}
                    cy={y(s.values[hover])}
                    r={4.5}
                    fill={s.color}
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                ))}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div
            className="viz-tip"
            style={{
              left: `${(x(hover) / W) * 100}%`,
              transform: `translateX(${hover > n / 2 ? '-105%' : '5%'})`,
            }}
          >
            <b>{md(labels[hover])}</b>
            {series.map((s) => (
              <div key={s.key}>
                <i style={{ background: s.color }} />
                {s.label} <b>{s.values[hover]}</b>
              </div>
            ))}
          </div>
        )}
      </div>
      <details className="viz-table">
        <summary>표로 보기</summary>
        <div className="viz-table-scroll">
          <table id={uid}>
            <thead>
              <tr>
                <th>날짜</th>
                {series.map((s) => (
                  <th key={s.key}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels
                .map((l, i) => (
                  <tr key={l}>
                    <td>{md(l)}</td>
                    {series.map((s) => (
                      <td key={s.key}>{s.values[i]}</td>
                    ))}
                  </tr>
                ))
                .reverse()}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
