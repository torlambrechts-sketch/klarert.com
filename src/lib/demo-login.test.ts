import { describe, expect, it } from 'vitest';
import { demoLogin } from './demo-login';

describe('demoLogin', () => {
  it('is off by default', () => {
    expect(demoLogin({})).toBeNull();
    expect(demoLogin({ NEXT_PUBLIC_DEMO_EMAIL: '' })).toBeNull();
    expect(demoLogin({ NEXT_PUBLIC_DEMO_EMAIL: '   ' })).toBeNull();
  });

  it('stays off for something that is not an email address', () => {
    expect(demoLogin({ NEXT_PUBLIC_DEMO_EMAIL: 'demo' })).toBeNull();
  });

  it('shows the email, and the password only when it is set', () => {
    expect(demoLogin({ NEXT_PUBLIC_DEMO_EMAIL: ' demo@meridian.example ' })).toEqual({
      email: 'demo@meridian.example',
      password: null,
    });
    expect(
      demoLogin({
        NEXT_PUBLIC_DEMO_EMAIL: 'demo@meridian.example',
        NEXT_PUBLIC_DEMO_PASSWORD: 'a long demo password',
      }),
    ).toEqual({ email: 'demo@meridian.example', password: 'a long demo password' });
  });

  it('never shows a password without an email', () => {
    expect(demoLogin({ NEXT_PUBLIC_DEMO_PASSWORD: 'a long demo password' })).toBeNull();
  });
});
