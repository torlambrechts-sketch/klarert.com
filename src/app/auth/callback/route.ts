import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { safeNext } from '@/lib/safe-next';
import { createClient } from '@/lib/supabase/server';

// Magic links land here: PKCE `code`, or `token_hash` when the email template links directly.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const target = safeNext(url.searchParams.get('next')) ?? '/';
  const supabase = await createClient();

  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error('missing code') };

  const dest = new URL(error ? '/login?error=link' : target, url.origin);
  return NextResponse.redirect(dest);
}
