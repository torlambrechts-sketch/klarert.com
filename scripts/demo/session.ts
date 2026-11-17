// Acting as a person of the demo workspace (scripts/demo/runtime.cjs explains the cookie jar). A session is opened
// with a one-time sign-in link made by the auth admin API (the seed's service role, scripts/seed.ts): nothing is
// emailed, and the link is used at once. The session is written to the jar exactly as @supabase/ssr writes the app's
// auth cookies, so the commands read it as they read a browser's.
import { createServerClient } from '@supabase/ssr';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';

type Jar = Map<string, string>;

function jar(): Jar {
  const j = (globalThis as { __demoCookieJar?: Jar }).__demoCookieJar;
  if (!j)
    throw new Error(
      'Run the demo seed with `pnpm seed:demo` (it preloads scripts/demo/runtime.cjs).',
    );
  return j;
}

export interface Sessions {
  /** Open (once) and remember a session for this email. */
  open(email: string): Promise<Session>;
  /** Make the commands run as this person until the next call. */
  actAs(email: string): Promise<void>;
  /** The person's own client (reads, RLS), for the seed's look-ups. */
  client(email: string): Promise<SupabaseClient<Database>>;
}

export function sessions(
  admin: SupabaseClient<Database>,
  env: { url: string; anonKey: string; passwords?: Record<string, string> },
): Sessions {
  const open = new Map<string, Session>();
  const clients = new Map<string, SupabaseClient<Database>>();

  async function start(email: string): Promise<Session> {
    const anon = createClient<Database>(env.url, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const password = env.passwords?.[email];
    if (password) {
      const { data, error } = await anon.auth.signInWithPassword({ email, password });
      if (error || !data.session) throw new Error(`sign in ${email}: ${error?.message}`);
      return data.session;
    }
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error) throw new Error(`sign-in link ${email}: ${link.error.message}`);
    const { data, error } = await anon.auth.verifyOtp({
      token_hash: link.data.properties.hashed_token,
      type: 'magiclink',
    });
    if (error || !data.session) throw new Error(`sign in ${email}: ${error?.message}`);
    return data.session;
  }

  async function session(email: string) {
    let s = open.get(email);
    // sessions last an hour; the seed takes minutes, but a slow machine gets a fresh one
    if (!s || (s.expires_at ?? 0) * 1000 < Date.now() + 5 * 60_000) {
      s = await start(email);
      open.set(email, s);
      clients.delete(email);
    }
    return s;
  }

  return {
    open: session,
    async actAs(email) {
      const s = await session(email);
      const j = jar();
      j.clear();
      const ssr = createServerClient(env.url, env.anonKey, {
        cookies: {
          getAll: () => [...j].map(([name, value]) => ({ name, value })),
          setAll: (list) =>
            list.forEach((c) => (c.value ? j.set(c.name, c.value) : j.delete(c.name))),
        },
      });
      const { error } = await ssr.auth.setSession({
        access_token: s.access_token,
        refresh_token: s.refresh_token,
      });
      if (error) throw new Error(`session ${email}: ${error.message}`);
    },
    async client(email) {
      const s = await session(email);
      let c = clients.get(email);
      if (!c) {
        c = createClient<Database>(env.url, env.anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${s.access_token}` } },
        });
        clients.set(email, c);
      }
      return c;
    },
  };
}
