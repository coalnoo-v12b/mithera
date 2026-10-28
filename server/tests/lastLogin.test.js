const { markLastLogin } = require('../src/utils/auth');

describe('markLastLogin', () => {
  it('마지막 로그인 방식을 JavaScript에서 읽을 수 있는 쿠키로 남긴다', () => {
    const res = { cookie: jest.fn() };

    markLastLogin(res, 'naver');

    expect(res.cookie).toHaveBeenCalledTimes(1);
    const [name, value, options] = res.cookie.mock.calls[0];
    expect(name).toBe('last_login');
    expect(value).toBe('naver');
    expect(options.httpOnly).toBeUndefined();
    expect(options.sameSite).toBe('lax');
    expect(options.maxAge).toBeGreaterThan(0);
  });
});
