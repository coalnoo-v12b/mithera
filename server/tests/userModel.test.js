const User = require('../src/models/User');

describe('User 모델 (소셜 로그인 대응)', () => {
  it('이메일과 비밀번호 없이 소셜 계정을 만들 수 있다', () => {
    const user = new User({
      nickname: '카카오유저',
      providers: [{ provider: 'kakao', providerId: '12345' }],
    });

    expect(user.validateSync()).toBeUndefined();
  });

  it('닉네임은 여전히 필수다', () => {
    const user = new User({
      providers: [{ provider: 'google', providerId: 'abc' }],
    });

    expect(user.validateSync().errors.nickname).toBeDefined();
  });

  it('지원하지 않는 제공자는 거부한다', () => {
    const user = new User({
      nickname: 'x',
      providers: [{ provider: 'github', providerId: 'abc' }],
    });

    expect(user.validateSync().errors['providers.0.provider']).toBeDefined();
  });

  it('이메일은 소문자와 공백 제거로 저장된다', () => {
    const user = new User({ nickname: 'x', email: '  Test@Example.COM ' });

    expect(user.email).toBe('test@example.com');
  });
});
