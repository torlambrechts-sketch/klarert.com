import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  COMMAND_HEADER,
  commandProof,
  commandSecret,
  jwtSubject,
  LOCAL_COMMAND_SECRET,
  withCommandProof,
} from './command-proof';

const hmacHex = (key: string, message: string) =>
  createHmac('sha256', key).update(message).digest('hex');
const jwt = (sub: string) =>
  `x.${Buffer.from(JSON.stringify({ sub, role: 'authenticated' })).toString('base64url')}.sig`;

describe('command proof (0053)', () => {
  it('signs "<t>.<user id>" with the secret, t in seconds', () => {
    const p = commandProof('s3cret', 'u-1', 1_700_000_000_999, hmacHex);
    expect(p).toBe(`t=1700000000,v1=${hmacHex('s3cret', '1700000000.u-1')}`);
    expect(p).toMatch(/^t=[0-9]{1,12},v1=[0-9a-f]{64}$/);
  });

  it('uses the configured secret, the local value only for a local Supabase, and nothing otherwise', () => {
    expect(commandSecret({ secret: ' abc ', supabaseUrl: 'https://x.supabase.co' })).toBe('abc');
    expect(commandSecret({ supabaseUrl: 'http://127.0.0.1:54321' })).toBe(LOCAL_COMMAND_SECRET);
    expect(commandSecret({ supabaseUrl: 'http://localhost:54321' })).toBe(LOCAL_COMMAND_SECRET);
    expect(commandSecret({ supabaseUrl: 'https://abc.supabase.co' })).toBeNull();
    expect(commandSecret({ secret: '', supabaseUrl: 'https://abc.supabase.co' })).toBeNull();
  });

  it('reads the user id from the bearer token', () => {
    expect(jwtSubject(`Bearer ${jwt('user-9')}`)).toBe('user-9');
    expect(jwtSubject('Bearer not-a-jwt')).toBe('');
    expect(jwtSubject(null)).toBe('');
  });

  it('adds the header to PostgREST requests only', async () => {
    const base = vi.fn(async () => new Response('[]'));
    const f = withCommandProof(base as unknown as typeof fetch, {
      secret: 's3cret',
      restUrl: 'http://127.0.0.1:54321/rest/v1/',
      now: () => 1_700_000_000_000,
      hmacHex,
    });
    await f('http://127.0.0.1:54321/rest/v1/rpc/set_item_values', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt('u-2')}` },
    });
    await f('http://127.0.0.1:54321/auth/v1/user', { headers: { Authorization: 'Bearer x' } });
    const [, first] = base.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(first.headers).get(COMMAND_HEADER)).toBe(
      `t=1700000000,v1=${hmacHex('s3cret', '1700000000.u-2')}`,
    );
    const [, second] = base.mock.calls[1] as unknown as [string, RequestInit];
    expect(new Headers(second.headers).get(COMMAND_HEADER)).toBeNull();
  });

  it('sends no header without a secret (the database then refuses the write)', async () => {
    const base = vi.fn(async () => new Response('[]'));
    const f = withCommandProof(base as unknown as typeof fetch, {
      secret: null,
      restUrl: 'https://abc.supabase.co/rest/v1/',
      now: () => 0,
      hmacHex,
    });
    await f('https://abc.supabase.co/rest/v1/items', { method: 'POST' });
    const [, init] = base.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(new Headers(init?.headers).get(COMMAND_HEADER)).toBeNull();
  });
});
