import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

type Msg = { ID: string; Created: string; To: { Address: string }[] };

/** Unique address per test run so magic links never collide. */
export const freshEmail = (who: string) =>
  `${who}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.test`;

async function latestLink(email: string, after: number): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await fetch(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=5`,
        );
        const { messages } = (await res.json()) as { messages: Msg[] };
        const msg = messages.find((m) => new Date(m.Created).getTime() >= after - 2000);
        if (!msg) return null;
        const body = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as {
          HTML: string;
          Text: string;
        };
        const m =
          (body.HTML || body.Text).match(/href="([^"]+)"/) ?? body.Text.match(/(https?:\/\/\S+)/);
        link = m?.[1]?.replaceAll('&amp;', '&');
        return link ?? null;
      },
      { timeout: 15_000, message: `magic link email to ${email}` },
    )
    .not.toBeNull();
  return link!;
}

/**
 * Signs in through the real magic-link flow (local Supabase + Mailpit). Parallel tests that sign in as the same
 * seeded person can invalidate each other's link (a newer link replaces the older one), so an expired link is
 * requested again, up to three times.
 */
export async function signIn(page: Page, email: string, next?: string) {
  for (let attempt = 1; ; attempt += 1) {
    const started = Date.now();
    await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
    await page.getByLabel('Work email').fill(email);
    await page.getByRole('button', { name: 'Send sign-in link' }).click();
    const sent = page.getByRole('heading', { name: 'Check your email' });
    // a second request for the same address within a second is refused: wait and ask again
    if (attempt < 3) {
      try {
        await expect(sent).toBeVisible({ timeout: 6_000 });
      } catch {
        await page.waitForTimeout(1500 * attempt);
        continue;
      }
    }
    await expect(sent).toBeVisible();
    await page.goto(await latestLink(email, started));
    if (!/\/login\?error=/.test(page.url()) || attempt === 3) return;
    await page.waitForTimeout(500 * attempt + Math.random() * 1000);
  }
}

export async function completeProfile(page: Page, name: string) {
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
}

// ───────────── REST as the signed-in person (RLS applies) ─────────────

function localEnv(name: string): string {
  if (process.env[name]) return process.env[name]!;
  let text = '';
  try {
    text = readFileSync('.env.local', 'utf8');
  } catch {
    return '';
  }
  const line = text.split('\n').find((l) => l.startsWith(`${name}=`));
  return line
    ? line
        .slice(name.length + 1)
        .trim()
        .replace(/^"|"$/g, '')
    : '';
}

/** The signed-in person's access token, from the Supabase auth cookie (possibly chunked, base64). */
export async function accessToken(page: Page): Promise<string> {
  const cookies = (await page.context().cookies())
    .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  let raw = decodeURIComponent(cookies.map((c) => c.value).join(''));
  if (raw.startsWith('base64-')) raw = Buffer.from(raw.slice(7), 'base64').toString('utf8');
  return (JSON.parse(raw) as { access_token: string }).access_token;
}

/** PostgREST call as the signed-in person: `rest(page, 'rpc/create_items', { method: 'POST', body })`. */
export async function rest<T = unknown>(
  page: Page,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${localEnv('NEXT_PUBLIC_SUPABASE_URL')}/rest/v1/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: localEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      Authorization: `Bearer ${await accessToken(page)}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}
