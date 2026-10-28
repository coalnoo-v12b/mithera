// 추첨 번호: "yyyymmdd-N" (그날 만들어진 N번째 추첨, N 은 1부터).
// 날짜는 한국 시간(KST) 기준이다. 서버는 UTC 로 돌아가서, 그대로 쓰면 오전 9시 전에 만든 추첨이 전날로 찍힌다.
const KST_OFFSET = 9 * 60 * 60 * 1000;

const kstYmd = (date = new Date()) =>
  new Date(new Date(date).getTime() + KST_OFFSET)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');

const formatNo = (ymd, n) => `${ymd}-${n}`;

// 검색어: "20261026-3", "#20261026-3", "No.20261026-03" 은 그 번호 하나,
// "20261026" 은 그날의 모든 추첨. 번호처럼 안 생겼으면 null.
// (client/src/pages/List.jsx 에도 같은 규칙이 있다)
const NO_QUERY = /^(?:#|no\.?)?\s*(\d{8})(?:\s*-\s*(\d{1,4}))?$/i;
const parseNoQuery = (q) => {
  const m = NO_QUERY.exec(String(q).trim());
  if (!m) return null;
  return m[2] ? { exact: formatNo(m[1], Number(m[2])) } : { day: m[1] };
};

module.exports = { kstYmd, formatNo, parseNoQuery };
