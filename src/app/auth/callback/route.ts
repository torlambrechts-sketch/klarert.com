import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { afterEmailLink, emailLinkNext, linkOutcome, type LinkOutcome } from '@/lib/auth-links';
import { createClient } from '@/lib/supabase/server';
import { tokenClaims } from '@/lib/two-step';
import { markResetLinkSession } from '@/server/reset-link';

// Supabase Auth's email links land here (sign-in, confirm sign-up, reset password, change email): `token_hash` and
// `type` from our templates (any device), a PKCE `code` from Supabase's default templates (only the browser that
// asked), or an error. The first of the two links of an email change opens no session: Supabase Auth answers with only
// a message (default templates) or with no session (`verifyOtp`). Where to go next is `emailLinkNext` and
// `afterEmailLink` (src/lib/auth-links.ts).
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = emailLinkNext(url.searchParams.get('next'), url.searchParams.get('redirect_to'));
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  let outcome: LinkOutcome | 'exchange' = linkOutcome({
    code,
    tokenHash,
    error: url.searchParams.get('error'),
    message: url.searchParams.get('message'),
  });

  if (outcome === 'exchange') {
    const supabase = await createClient();
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      outcome = error ? 'failed' : 'ok';
    } else if (tokenHash && type) {
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) outcome = 'expired';
      else if (!data.session) outcome = type === 'email_change' ? 'confirm_other' : 'failed';
      else {
        outcome = 'ok';
        // only a session a reset link opened may set a password without the current one (docs/09 §12)
        if (type === 'recovery')
          await markResetLinkSession(
            tokenClaims(data.session.access_token),
            url.protocol === 'https:',
          );
      }
    } else outcome = 'failed';
  }

  return NextResponse.redirect(new URL(afterEmailLink(next, outcome), url.origin));
}
