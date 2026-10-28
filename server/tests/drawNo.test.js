const { kstYmd, formatNo, parseNoQuery } = require('../src/utils/drawNo');

describe('kstYmd (한국 시간 기준 날짜)', () => {
  it('UTC 로는 전날이어도 한국 시간으로 넘어간 날짜를 쓴다', () => {
    // UTC 10/25 15:00 = KST 10/26 00:00
    expect(kstYmd(new Date('2026-10-25T15:00:00Z'))).toBe('20261026');
    expect(kstYmd(new Date('2026-10-25T14:59:59Z'))).toBe('20261025');
  });

  it('연말/연초도 한국 시간으로 넘어간다', () => {
    expect(kstYmd(new Date('2026-12-31T15:00:00Z'))).toBe('20270101');
  });
});

describe('formatNo / parseNoQuery', () => {
  it('번호는 yyyymmdd-N 이다', () => {
    expect(formatNo('20261026', 1)).toBe('20261026-1');
  });

  it('번호처럼 안 생긴 검색어는 null', () => {
    expect(parseNoQuery('점심')).toBeNull();
    expect(parseNoQuery('12')).toBeNull();
    expect(parseNoQuery('2026102')).toBeNull();
    expect(parseNoQuery('20261026-')).toBeNull();
  });

  it('앞의 0 은 없애서 저장 형식과 맞춘다', () => {
    expect(parseNoQuery('20261026-007')).toEqual({ exact: '20261026-7' });
  });
});
