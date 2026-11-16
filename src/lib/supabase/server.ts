import 'server-only';
import { createHmac } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/database.types';
import { env } from '@/lib/env';
import { commandSecret, withCommandProof } from './command-proof';

const hmacHex = (key: string, message: string) =>
  createHmac('sha256', key).update(message).digest('hex');

// Writes to the database carry the server's proof (migration 0053): only commands running here can write.
const commandFetch = withCommandProof((input, init) => fetch(input, init), {
  secret: commandSecret({
    secret: process.env.SUPABASE_COMMAND_SECRET,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
  }),
  restUrl: `${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/`,
  now: () => Date.now(),
  hmacHex,
});

export type ServerClient = Awaited<ReturnType<typeof createClient>>;

// The user's client: every query runs under their session and RLS.
export async function createClient() {
  const store = await cookies();
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { fetch: commandFetch },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Components cannot set cookies; the middleware refreshes the session instead.
        }
      },
    },
  });
}

/**
 * A client with no cookies and no stored session, on the anon key: only to check a person's current password before
 * it changes (Your account › Password, docs/09 §12). The session it opens is ended by the command right after.
 */
export function createPasswordCheckClient() {
  return createSupabaseClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
