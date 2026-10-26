// 추첨 결과가 해시로 이어진 모습. 변조가 감지된 지점부터는 빨갛게 끊겨 보인다.
export default function ChainView({ chain, highlight }) {
  if (!chain) return null;
  const { results, ok, brokenAt } = chain;
  if (!results.length)
    return <div className="muted">아직 저장된 결과가 없어요</div>;
  return (
    <div className="chain" role="list">
      {results.map((r, i) => {
        const bad = !ok && brokenAt != null && r.seq >= brokenAt;
        return (
          <div key={r.seq} className="chain-item" role="listitem">
            {i > 0 && (
              <div className={'chain-link' + (bad ? ' bad' : '')}>⛓</div>
            )}
            <div
              className={
                'block' +
                (bad ? ' bad' : '') +
                (r.seq === highlight ? ' hl' : '')
              }
              title={r.hash}
            >
              <b>#{r.seq}</b>
              <span className="ellipsis">{r.title}</span>
              <code>{r.hash.slice(0, 8)}…</code>
            </div>
          </div>
        );
      })}
    </div>
  );
}
