import { describe, expect, it } from 'vitest';
import {
  aalOf,
  cleanCode,
  requiresTwoStep,
  signedInAt,
  tokenClaims,
  twoStepState,
  unfinishedApps,
  verifiedApps,
  workspaceGate,
  type FactorLike,
} from './two-step';

const b64url = (o: unknown) =>
  Buffer.from(JSON.stringify(o))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const jwt = (claims: unknown) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}.sig`;

const app = (over: Partial<FactorLike> = {}): FactorLike => ({
  id: 'f1',
  factor_type: 'totp',
  status: 'verified',
  created_at: '2026-11-10T10:00:00Z',
  ...over,
});

describe('codes', () => {
  it('accepts six digits, with the spaces people type', () => {
    expect(cleanCode('123456')).toBe('123456');
    expect(cleanCode(' 123 456 ')).toBe('123456');
    expect(cleanCode('123-456')).toBe('123456');
  });
  it('refuses anything else', () => {
    for (const v of ['12345', '1234567', 'abcdef', '', null, 123456])
      expect(cleanCode(v)).toBeNull();
  });
});

describe('token claims', () => {
  it('reads the assurance level and the sign-in time', () => {
    const claims = tokenClaims(
      jwt({
        aal: 'aal2',
        amr: [
          { method: 'totp', timestamp: 1_794_751_000 },
          { method: 'password', timestamp: 1_794_750_000 },
        ],
      }),
    );
    expect(aalOf(claims)).toBe('aal2');
    expect(signedInAt(claims)).toBe(new Date(1_794_750_000 * 1000).toISOString());
  });
  it('reads unicode in a base64url payload', () => {
    expect(tokenClaims(jwt({ name: 'Zoë ✓' }))).toEqual({ name: 'Zoë ✓' });
  });
  it('treats a missing or broken token as the first step only', () => {
    expect(aalOf(tokenClaims(undefined))).toBe('aal1');
    expect(aalOf(tokenClaims('not-a-token'))).toBe('aal1');
    expect(aalOf(tokenClaims('a.!!!.c'))).toBe('aal1');
    expect(aalOf(tokenClaims(jwt({ aal: 'aal3' })))).toBe('aal1');
    expect(signedInAt(tokenClaims(jwt({ amr: 'x' })))).toBeNull();
  });
});

describe('factors', () => {
  const factors = [
    app({ id: 'b', created_at: '2026-11-12T10:00:00Z' }),
    app({ id: 'a' }),
    app({ id: 'u', status: 'unverified' }),
    app({ id: 'p', factor_type: 'phone' }),
  ];
  it('lists finished authenticator apps oldest first, and unfinished set-ups apart', () => {
    expect(verifiedApps(factors).map((f) => f.id)).toEqual(['a', 'b']);
    expect(unfinishedApps(factors).map((f) => f.id)).toEqual(['u']);
    expect(verifiedApps(undefined)).toEqual([]);
  });
  it('owes a code only when an app is set up and the session is first-step only', () => {
    expect(twoStepState(factors, 'aal1')).toEqual({
      enrolled: true,
      level: 'aal1',
      needsCode: true,
    });
    expect(twoStepState(factors, 'aal2').needsCode).toBe(false);
    expect(twoStepState([app({ status: 'unverified' })], 'aal1')).toEqual({
      enrolled: false,
      level: 'aal1',
      needsCode: false,
    });
  });
});

describe('workspace requirement', () => {
  it('is on only when the setting is true', () => {
    expect(requiresTwoStep({ requireTwoStep: true })).toBe(true);
    for (const s of [{ requireTwoStep: 'true' }, { requireTwoStep: false }, {}, null, [], 'x'])
      expect(requiresTwoStep(s)).toBe(false);
  });
  it('opens, asks for the code, or asks to set up an app', () => {
    const none = twoStepState([], 'aal1');
    const owed = twoStepState([app()], 'aal1');
    const done = twoStepState([app()], 'aal2');
    expect(workspaceGate(none, false)).toBe('open');
    expect(workspaceGate(none, true)).toBe('set_up');
    expect(workspaceGate(owed, false)).toBe('enter_code');
    expect(workspaceGate(owed, true)).toBe('enter_code');
    expect(workspaceGate(done, true)).toBe('open');
  });
});
