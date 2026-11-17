import { expect, type Page } from '@playwright/test';

// Supabase Auth's emails in Mailpit (the local stack's mail catcher), for the reset password and change of email
// specs. Every spec uses fresh addresses, so the newest message to an address is the one the test asked for.

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

type Msg = { ID: string; Created: string; Subject: string; To: { Address: string }[] };
export type Mail = { subject: string; html: string; text: string; link: string };

/**
 * The newest email to `email` sent at or after `after` (ms), waiting for it to arrive; with `subject`, the newest with
 * that subject (a security alert and a confirmation link can arrive close together).
 */
export async function mailTo(email: string, after: number, subject?: string): Promise<Mail> {
  let mail: Mail | null = null;
  await expect
    .poll(
      async () => {
        const res = await fetch(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=5`,
        );
        const { messages } = (await res.json()) as { messages: Msg[] };
        const msg = messages.find(
          (m) =>
            new Date(m.Created).getTime() >= after - 2000 &&
            (subject === undefined || m.Subject === subject),
        );
        if (!msg) return null;
        const body = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as {
          HTML: string;
          Text: string;
        };
        const link = body.HTML.match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
        mail = link ? { subject: msg.Subject, html: body.HTML, text: body.Text, link } : null;
        return mail;
      },
      { timeout: 15_000, message: `email to ${email}` },
    )
    .not.toBeNull();
  return mail!;
}

/**
 * Open an email's link in this browser. Our templates link to `{{ .SiteURL }}/auth/callback` with the token hash, and
 * the local site URL (localhost:3000) may be another checkout's server on a shared machine: open the same path and
 * query on this test's own server. A link to Supabase Auth's verify step (Supabase's default templates, see
 * `defaultTemplateLink`) is followed here and its callback opened on this server.
 */
export async function openLink(page: Page, link: string) {
  let url = new URL(link);
  if (url.pathname !== '/auth/callback') {
    const res = await fetch(link, { redirect: 'manual' });
    const to = res.headers.get('location');
    url = new URL(to ?? link);
    if (url.pathname !== '/auth/callback') throw new Error(`unexpected redirect: ${to}`);
  }
  await page.goto(`${url.pathname}${url.search}`);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';

/**
 * The link Supabase's default template would have sent for the same email (`{{ .ConfirmationURL }}`: its verify
 * step, then back to the app with a PKCE code), as the hosted project sends until our templates are applied there.
 */
export function defaultTemplateLink(link: string): string {
  const ours = new URL(link);
  const verify = new URL('/auth/v1/verify', SUPABASE_URL);
  verify.searchParams.set('token', ours.searchParams.get('token_hash')!);
  verify.searchParams.set('type', ours.searchParams.get('type')!);
  verify.searchParams.set('redirect_to', ours.searchParams.get('redirect_to')!);
  return verify.toString();
}
