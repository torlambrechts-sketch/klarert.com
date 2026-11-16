import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { afterEmailLink, linkOutcome } from '@/lib/auth-links';
import { createClient } from '@/lib/supabase/server';

// Supabase Auth's email links land here (sign-in, confirm sign-up, reset password, change email): a PKCE `code`, or
// `token_hash` when an email template links directly. The first of the two links of an email change brings only a
// `message` (the other address must confirm too). Where to go next is `afterEmailLink` (src/lib/auth-links.ts).
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = url.searchParams.get('next');
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  let outcome = linkOutcome({
    code,
    tokenHash,
    error: url.searchParams.get('error'),
    message: url.searchParams.get('message'),
  });

  if (outcome === 'exchange') {
    const supabase = await createClient();
    const { error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : tokenHash && type
        ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
        : { error: new Error('missing type') };
    outcome = error ? 'failed' : 'ok';
  }

  return NextResponse.redirect(new URL(afterEmailLink(next, outcome), url.origin));
}
