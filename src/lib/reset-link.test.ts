import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RESET_LINK_MAX_AGE_S, hasResetLinkProof, resetLinkProof } from './reset-link';

const hmac = (key: string, message: string) =>
  createHmac('sha256', key).update(message).digest('hex');
const claims = { sub: 'user-1', session_id: 'session-1', amr: [{ method: 'otp', timestamp: 1 }] };

describe('the reset-link cookie', () => {
  it('is bound to the person and the session', () => {
    const proof = resetLinkProof('secret', claims, hmac)!;
    expect(proof).toMatch(/^v1\.[0-9a-f]{64}$/);
    expect(hasResetLinkProof(proof, 'secret', claims, hmac)).toBe(true);
    // a refreshed token of the same session keeps it
    expect(hasResetLinkProof(proof, 'secret', { ...claims, exp: 99 }, hmac)).toBe(true);
    // another session (a later sign-in) or another person does not
    expect(hasResetLinkProof(proof, 'secret', { ...claims, session_id: 'session-2' }, hmac)).toBe(
      false,
    );
    expect(hasResetLinkProof(proof, 'secret', { ...claims, sub: 'user-2' }, hmac)).toBe(false);
  });
  it('cannot be made without the secret', () => {
    const proof = resetLinkProof('secret', claims, hmac)!;
    const forged = `${proof.slice(0, -1)}${proof.endsWith('0') ? '1' : '0'}`;
    expect(hasResetLinkProof(proof, 'other secret', claims, hmac)).toBe(false);
    expect(hasResetLinkProof(proof, null, claims, hmac)).toBe(false);
    expect(hasResetLinkProof(forged, 'secret', claims, hmac)).toBe(false);
    expect(hasResetLinkProof('', 'secret', claims, hmac)).toBe(false);
    expect(hasResetLinkProof(undefined, 'secret', claims, hmac)).toBe(false);
  });
  it('needs a person and a session id', () => {
    expect(resetLinkProof('secret', null, hmac)).toBeNull();
    expect(resetLinkProof('secret', { sub: 'user-1' }, hmac)).toBeNull();
    expect(resetLinkProof('secret', { session_id: 'session-1' }, hmac)).toBeNull();
    expect(resetLinkProof('secret', { sub: '', session_id: 'session-1' }, hmac)).toBeNull();
    expect(hasResetLinkProof('v1.x', 'secret', null, hmac)).toBe(false);
  });
  it('never equals a command proof made with the same secret', () => {
    // a command proof signs "<unix seconds>.<user id>" (src/lib/supabase/command-proof.ts)
    const proof = resetLinkProof('secret', claims, hmac)!;
    expect(proof.slice(3)).not.toBe(hmac('secret', `1.${claims.sub}`));
  });
  it('lasts as long as a session can', () => {
    expect(RESET_LINK_MAX_AGE_S).toBe(12 * 60 * 60);
  });
});
