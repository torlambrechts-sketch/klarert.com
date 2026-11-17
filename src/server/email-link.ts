import 'server-only';
import { openEmailLink, type EmailLinkParams } from '@/lib/email-link';
import { createClient } from '@/lib/supabase/server';
import { tokenClaims } from '@/lib/two-step';
import { markResetLinkSession } from '@/server/reset-link';

/**
 * Open an email link on the person's own session (src/lib/email-link.ts) and return where to go. `secure`: the
 * request came over HTTPS (the reset-link cookie is then Secure). Never logs the link's parameters.
 */
export async function openEmailLinkHere(params: EmailLinkParams, secure: boolean) {
  return openEmailLink(params, {
    exchangeCode: async (code) => {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      return !error;
    },
    verifyOtp: async (tokenHash, type) => {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      return { refused: Boolean(error), accessToken: data.session?.access_token ?? null };
    },
    markResetLink: (accessToken) => markResetLinkSession(tokenClaims(accessToken), secure),
  });
}
