// Signing in for the performance scripts (M10). They act as a real person, under RLS, never with the service role.
// Three ways, in this order:
//   PERF_ACCESS_TOKEN (+ PERF_REFRESH_TOKEN)  a session copied from a signed-in browser
//   PERF_EMAIL + PERF_PASSWORD                a test user with a password (hosted projects)
//   PERF_EMAIL and a local Mailpit            the magic link, read from Mailpit (local stack only)
import { createServerClient } from '@supabase/ssr';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '../../src/lib/database.types';

export const perfEnv = z
  .object({
    SUPABASE_URL: z.url(),
    ANON_KEY: z.string().min(20),
    APP_URL: z.url(),
    EMAIL: z.email().optional(),
    PASSWORD: z.string().optional(),
    ACCESS_TOKEN: z.string().optional(),
    REFRESH_TOKEN: z.string().optional(),
    MAILPIT_URL: z.url(),
    WORKSPACE: z.string().min(1).default('meridian'),
  })
  .parse({
    SUPABASE_URL: process.env.PERF_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    ANON_KEY: process.env.PERF_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    APP_URL: process.env.PERF_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    EMAIL: process.env.PERF_EMAIL ?? 'maria@example.com',
    PASSWORD: process.env.PERF_PASSWORD || undefined,
    ACCESS_TOKEN: process.env.PERF_ACCESS_TOKEN || undefined,
    REFRESH_TOKEN: process.env.PERF_REFRESH_TOKEN || undefined,
    MAILPIT_URL: process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324',
    WORKSPACE: process.env.PERF_WORKSPACE || undefined,
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The magic link from a local Mailpit, verified for a session (local stack only). */
async function viaMailpit(email: string): Promise<Session> {
  const anon = createClient(perfEnv.SUPABASE_URL, perfEnv.ANON_KEY, {
    auth: { persistSession: false },
  });
  const started = Date.now();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { error } = await anon.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (!error) break;
    await sleep(1500);
  }
  for (let i = 0; i < 30; i += 1) {
    const res = await fetch(
      `${perfEnv.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=3`,
    );
    const { messages } = (await res.json()) as { messages: { ID: string; Created: string }[] };
    const msg = messages.find((m) => new Date(m.Created).getTime() >= started - 2000);
    if (msg) {
      const body = (await (
        await fetch(`${perfEnv.MAILPIT_URL}/api/v1/message/${msg.ID}`)
      ).json()) as {
        Text: string;
        HTML: string;
      };
      const link = (body.HTML || body.Text).match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
      // our template links to /auth/callback with `token_hash`; Supabase's default one to its verify step with `token`
      const params = link ? new URL(link).searchParams : null;
      const token = params?.get('token_hash') ?? params?.get('token');
      if (token) {
        const { data, error } = await anon.auth.verifyOtp({ token_hash: token, type: 'email' });
        if (error || !data.session)
          throw new Error(`magic link: ${error?.message ?? 'no session'}`);
        return data.session;
      }
    }
    await sleep(500);
  }
  throw new Error(`No magic link for ${email} in ${perfEnv.MAILPIT_URL}.`);
}

export async function signInForPerf(): Promise<{ db: SupabaseClient<Database>; session: Session }> {
  const db = createClient<Database>(perfEnv.SUPABASE_URL, perfEnv.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let session: Session;
  if (perfEnv.ACCESS_TOKEN) {
    const { data, error } = await db.auth.setSession({
      access_token: perfEnv.ACCESS_TOKEN,
      refresh_token: perfEnv.REFRESH_TOKEN ?? '',
    });
    if (error || !data.session)
      throw new Error(`PERF_ACCESS_TOKEN: ${error?.message ?? 'no session'}`);
    session = data.session;
  } else if (perfEnv.EMAIL && perfEnv.PASSWORD) {
    const { data, error } = await db.auth.signInWithPassword({
      email: perfEnv.EMAIL,
      password: perfEnv.PASSWORD,
    });
    if (error || !data.session) throw new Error(`PERF_EMAIL/PERF_PASSWORD: ${error?.message}`);
    session = data.session;
  } else if (perfEnv.EMAIL) {
    session = await viaMailpit(perfEnv.EMAIL);
    await db.auth.setSession(session);
  } else throw new Error('Set PERF_ACCESS_TOKEN, or PERF_EMAIL with PERF_PASSWORD.');
  db.realtime.setAuth(session.access_token);
  return { db, session };
}

/** The app's auth cookies for a session, exactly as @supabase/ssr writes them (for a browser context). */
export async function sessionCookies(session: Session): Promise<{ name: string; value: string }[]> {
  const jar = new Map<string, string>();
  const ssr = createServerClient(perfEnv.SUPABASE_URL, perfEnv.ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) =>
        list.forEach((c) => (c.value ? jar.set(c.name, c.value) : jar.delete(c.name))),
    },
  });
  await ssr.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  return [...jar].map(([name, value]) => ({ name, value }));
}

/** p50 / p95 / max of a list of milliseconds. */
export function stats(ms: number[]) {
  const s = [...ms].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] ?? NaN;
  return { n: s.length, p50: at(0.5), p95: at(0.95), max: s.at(-1) ?? NaN };
}
