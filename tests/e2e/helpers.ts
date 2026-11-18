import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';
import { COMMAND_HEADER, commandProof, commandSecret } from '@/lib/supabase/command-proof';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

type Msg = { ID: string; Created: string; To: { Address: string }[]; Tags?: string[] };

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
        // the app's own mail (invites, src/server/email) is tagged; sign-in links from Supabase Auth are not
        const msg = messages.find(
          (m) => !m.Tags?.length && new Date(m.Created).getTime() >= after - 2000,
        );
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

export type AppMail = { subject: string; text: string; html: string; link: string };

/**
 * The newest email the app sent to `email` with `tag` (src/server/email, local Mailpit transport), after `after`
 * (ms). Waits for it; `count` waits until at least that many such messages exist (a resend is the second).
 */
export async function appMail(
  email: string,
  tag: string,
  opts: { after?: number; count?: number } = {},
): Promise<AppMail> {
  let mail: AppMail | null = null;
  await expect
    .poll(
      async () => {
        const res = await fetch(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}" tag:${tag}`)}&limit=10`,
        );
        const { messages } = (await res.json()) as { messages: Msg[] };
        const fresh = messages.filter(
          (m) => new Date(m.Created).getTime() >= (opts.after ?? 0) - 2000,
        );
        if (fresh.length < (opts.count ?? 1)) return null;
        const body = (await (await fetch(`${MAILPIT}/api/v1/message/${fresh[0]!.ID}`)).json()) as {
          Subject: string;
          HTML: string;
          Text: string;
        };
        const link = body.HTML.match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&') ?? '';
        mail = { subject: body.Subject, text: body.Text, html: body.HTML, link };
        return mail;
      },
      { timeout: 15_000, message: `${tag} email to ${email}` },
    )
    .not.toBeNull();
  return mail!;
}

/**
 * Signs in through the real magic-link flow (local Supabase + Mailpit). Parallel tests that sign in as the same
 * seeded person can invalidate each other's link (a newer link replaces the older one), so an expired link is
 * requested again. Auth refuses a second link for the same address within a second, which parallel workers signing
 * in as the same person hit: wait a jittered moment and ask again, up to five times.
 */
const ATTEMPTS = 5;

/**
 * The link names the auth site URL (localhost:3000 locally), which on a shared machine may be another checkout's
 * server: open its path and query on this server. Our templates link to `/auth/confirm`, whose Continue button opens
 * the link (docs/09 §12). A link to Supabase Auth's verify step is followed here and its code taken to this server's
 * own callback (the PKCE verifier cookie is this browser's). Anything else is opened as it is.
 */
async function linkHere(link: string): Promise<string> {
  try {
    const own = new URL(link);
    if (own.pathname === '/auth/confirm' || own.pathname === '/auth/callback')
      return `${own.pathname}${own.search}`;
    const res = await fetch(link, { redirect: 'manual' });
    const to = res.headers.get('location');
    const url = to ? new URL(to) : null;
    if (url && url.pathname === '/auth/callback') return `${url.pathname}${url.search}`;
    return to ?? link;
  } catch {
    return link;
  }
}

/** Open a sign-in link: `/auth/confirm`, then Continue. */
async function openSignInLink(page: Page, link: string) {
  await page.goto(await linkHere(link));
  if (new URL(page.url()).pathname !== '/auth/confirm') return;
  const button = page.getByTestId('email-link-continue');
  await Promise.all([page.waitForURL((u) => u.pathname !== '/auth/confirm'), button.click()]);
}

export async function signIn(page: Page, email: string, next?: string) {
  for (let attempt = 1; ; attempt += 1) {
    const started = Date.now();
    await page.goto(
      next ? `/login?mode=link&next=${encodeURIComponent(next)}` : '/login?mode=link',
    );
    await page.getByLabel('Work email').fill(email);
    await page.getByRole('button', { name: 'Send sign-in link' }).click();
    const sent = page.getByRole('heading', { name: 'Check your email' });
    // a second request for the same address within a second is refused: wait and ask again
    if (attempt < ATTEMPTS) {
      try {
        await expect(sent).toBeVisible({ timeout: 6_000 });
      } catch {
        await page.waitForTimeout(1500 * attempt + Math.random() * 1000);
        continue;
      }
    }
    await expect(sent).toBeVisible();
    await openSignInLink(page, await latestLink(email, started));
    if (!/\/login\?error=/.test(page.url()) || attempt === ATTEMPTS) return;
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

/**
 * PostgREST call as the signed-in person: `rest(page, 'rpc/create_items', { method: 'POST', body })`. Fixtures stand in
 * for the app's server, so writes carry the server's proof as the server client does (migration 0053); RLS and the
 * database's own rules apply as for the person.
 */
export async function rest<T = unknown>(
  page: Page,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = await accessToken(page);
  const secret = commandSecret({
    secret: localEnv('SUPABASE_COMMAND_SECRET'),
    supabaseUrl: localEnv('NEXT_PUBLIC_SUPABASE_URL'),
  });
  const sub = (
    JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as { sub: string }
  ).sub;
  const res = await fetch(`${localEnv('NEXT_PUBLIC_SUPABASE_URL')}/rest/v1/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: localEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(secret
        ? {
            [COMMAND_HEADER]: commandProof(secret, sub, Date.now(), (k, m) =>
              createHmac('sha256', k).update(m).digest('hex'),
            ),
          }
        : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

/**
 * A public form's settings that may be open (0022): open, public and a complete privacy notice marked reviewed (the
 * database stamps who and when). Spread into `config.form` when a test creates a form through the API.
 */
export const OPEN_PUBLIC_FORM = {
  status: 'open',
  access: 'public',
  notice: {
    purpose: 'To handle the reports people send.',
    legalBasis: 'legitimate_interests',
    recipients: 'The people in this workspace.',
    retention: 'One year.',
    rights: 'Ask the workspace owner.',
    version: 1,
    reviewedVersion: 1,
  },
} as const;

/** Public forms refuse answers sent sooner than 2 s after the page was served (minimum fill time). */
export const MIN_FILL_MS = 2100;

// the item panel tab bar: the tablist "Item sections" and More ▾ beside it
const ITEM_TABS = '[data-testid="item-tabs"]';
const MORE = '[data-testid="overflow-tabs-more"]';

const pageOf = (scope: Page | Locator): Page =>
  'page' in scope && typeof scope.page === 'function' ? scope.page() : (scope as Page);

/**
 * Opens an item panel tab (docs/18 §3: two tabs, then More ▾): clicks the tab when it shows, else opens More ▾ and
 * picks it there.
 */
export async function openTab(scope: Page | Locator, name: string | RegExp) {
  const list = scope.locator(ITEM_TABS).first();
  await list.waitFor();
  const tab = list.getByRole('tab', { name });
  if (await tab.count()) return tab.first().click();
  await list.locator(MORE).click();
  await pageOf(scope).getByRole('menuitemradio', { name }).click();
}

/** The control that shows an item panel tab: the tab itself, or the More trigger while it holds that tab. */
export function panelTab(scope: Page | Locator, name: string | RegExp) {
  return scope
    .getByRole('tab', { name })
    .or(scope.locator(`${ITEM_TABS} ${MORE}`).filter({ hasText: name }));
}

const VIEWS = 'nav[aria-label="Views"]';

/**
 * A view tab (docs/18 §3: two tabs, then More ▾ with the rest): its link, or the More trigger while it holds the
 * active tab (the trigger then shows its name and is the current page).
 */
export function viewTab(page: Page, name: string | RegExp) {
  const nav = page.locator(VIEWS);
  return nav.getByRole('link', { name }).or(nav.locator(MORE).filter({ hasText: name }));
}

/**
 * The view tabs in order: the links, then the tabs in More ▾ (its radio items; hidden tabs are plain items and are
 * left out). Opens More ▾ and closes it again.
 */
export async function viewTabNames(page: Page): Promise<string[]> {
  const nav = page.locator(VIEWS);
  await nav.getByRole('link').first().waitFor();
  // the tab bar first shows the default tabs, then the sheet's own tab set once it loads: read until two reads
  // half a second apart agree, after the page's requests have settled
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  const read = async () => (await nav.getByRole('link').allInnerTexts()).map((t) => t.trim());
  let links = await read();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500);
    const again = await read();
    if (again.join('|') === links.join('|')) break;
    links = again;
  }
  await nav.locator(MORE).click();
  const menu = page.getByRole('menu');
  await menu.waitFor();
  const more = (await menu.getByRole('menuitemradio').allInnerTexts()).map((t) => t.trim());
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  return [...links, ...more];
}

/** Opens a view by its tab: the link, or its item in More ▾. */
export async function openViewTab(page: Page, name: string | RegExp) {
  const nav = page.locator(VIEWS);
  await nav.getByRole('link').first().waitFor();
  const link = nav.getByRole('link', { name });
  if (await link.count()) return link.first().click();
  await nav.locator(MORE).click();
  await page.getByRole('menuitemradio', { name }).click();
}
