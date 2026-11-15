import { describe, expect, it } from 'vitest';
import {
  MIN_PASSWORD,
  newPassword,
  newPasswordTwice,
  openedByResetLink,
  passwordRefusal,
  signInMethods,
} from './passwords';

describe('new passwords', () => {
  it('needs at least 12 characters and at most 200', () => {
    expect(MIN_PASSWORD).toBe(12);
    expect(newPassword.safeParse('a'.repeat(11)).success).toBe(false);
    expect(newPassword.safeParse('a'.repeat(12)).success).toBe(true);
    expect(newPassword.safeParse('a'.repeat(200)).success).toBe(true);
    expect(newPassword.safeParse('a'.repeat(201)).success).toBe(false);
    expect(newPassword.safeParse(undefined).error?.issues[0]?.message).toBe(
      'Use at least 12 characters.',
    );
  });

  it('must be typed twice the same, reported on the second field', () => {
    expect(
      newPasswordTwice.safeParse({ password: 'Correct horse 1', confirm: 'Correct horse 1' })
        .success,
    ).toBe(true);
    const r = newPasswordTwice.safeParse({
      password: 'Correct horse 1',
      confirm: 'Correct horse 2',
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues).toEqual([
      expect.objectContaining({
        path: ['confirm'],
        message: 'The two passwords are not the same.',
      }),
    ]);
    const short = newPasswordTwice.safeParse({ password: 'short', confirm: 'short' });
    expect(short.error?.issues[0]).toMatchObject({
      path: ['password'],
      message: 'Use at least 12 characters.',
    });
  });
});

describe('sign-in methods', () => {
  it('reads the methods from amr', () => {
    expect(signInMethods(null)).toEqual([]);
    expect(signInMethods({ amr: 'password' })).toEqual([]);
    expect(
      signInMethods({
        amr: [
          { method: 'recovery', timestamp: 1 },
          { method: 'totp', timestamp: 2 },
          null,
          { x: 1 },
        ],
      }),
    ).toEqual(['recovery', 'totp']);
  });

  it('knows a session opened by a reset link, also after the two-step code', () => {
    expect(openedByResetLink({ amr: [{ method: 'recovery', timestamp: 1 }] })).toBe(true);
    expect(
      openedByResetLink({
        amr: [
          { method: 'totp', timestamp: 2 },
          { method: 'recovery', timestamp: 1 },
        ],
      }),
    ).toBe(true);
    expect(openedByResetLink({ amr: [{ method: 'password', timestamp: 1 }] })).toBe(false);
    expect(openedByResetLink({ amr: [{ method: 'otp', timestamp: 1 }] })).toBe(false);
    expect(openedByResetLink(null)).toBe(false);
  });
});

describe('password refusals', () => {
  it('words Supabase Auth refusals', () => {
    expect(passwordRefusal({ code: 'same_password' })).toBe(
      'Choose a password you have not used for this account.',
    );
    expect(passwordRefusal({ code: 'weak_password', reasons: ['length'] })).toBe(
      'Use at least 12 characters.',
    );
    expect(passwordRefusal({ code: 'weak_password', reasons: ['pwned'] })).toBe(
      'That password appears in known data leaks. Choose another.',
    );
    expect(
      passwordRefusal({
        code: 'weak_password',
        message: 'Password is known to be weak and easy to guess, please choose a different one.',
      }),
    ).toBe('That password appears in known data leaks. Choose another.');
    expect(passwordRefusal({ code: 'over_request_rate_limit' })).toBeNull();
  });
});
