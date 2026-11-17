import { NextResponse, type NextRequest } from 'next/server';
import { sameOriginPost } from '@/lib/email-link';
import { openEmailLinkHere } from '@/server/email-link';

// Supabase Auth's email links (sign-in, confirm sign-up, reset password, change email) are opened here; the logic is
// `openEmailLink` (src/lib/email-link.ts), where to go next `emailLinkNext` and `afterEmailLink`
// (src/lib/auth-links.ts). Docs/09 §12.
//
// POST: the Continue button of `/auth/confirm`, where our templates' token-hash links land. A link scanner (Microsoft
// Defender Safe Links and the like) opens every link in an email with a GET; only the person's click posts here, so
// only the click uses up the one-time token. Only a POST from a page of this site is taken (`sameOriginPost`).
//
// GET: a PKCE `code` from Supabase's default templates (only the browser that asked holds the verifier), an error, or
// only a message (the first of the two links of an email change). It also still takes a `token_hash` link straight
// from emails sent before `/auth/confirm` (17 Nov 2026); that path can go after 2 weeks (docs/09 §12).

function one(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const q = url.searchParams;
  const to = await openEmailLinkHere(
    {
      code: q.get('code'),
      tokenHash: q.get('token_hash'),
      type: q.get('type'),
      error: q.get('error'),
      message: q.get('message'),
      next: q.get('next'),
      redirectTo: q.get('redirect_to'),
    },
    url.protocol === 'https:',
  );
  return NextResponse.redirect(new URL(to, url.origin));
}

export async function POST(request: NextRequest) {
  const url = request.nextUrl;
  const sameOrigin = sameOriginPost({
    secFetchSite: request.headers.get('sec-fetch-site'),
    origin: request.headers.get('origin'),
    host: request.headers.get('x-forwarded-host') ?? request.headers.get('host'),
  });
  // another site's form: leave the token unused
  if (!sameOrigin) return NextResponse.redirect(new URL('/login?error=link', url.origin), 303);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.redirect(new URL('/login?error=link', url.origin), 303);
  }
  const to = await openEmailLinkHere(
    {
      // the Continue form carries a token hash only; a code still comes by GET
      code: null,
      tokenHash: one(form.get('token_hash')),
      type: one(form.get('type')),
      error: null,
      message: null,
      next: one(form.get('next')),
      redirectTo: one(form.get('redirect_to')),
    },
    url.protocol === 'https:',
  );
  // 303: the browser follows with a GET, so going back or reloading never posts the used token again
  return NextResponse.redirect(new URL(to, url.origin), 303);
}
