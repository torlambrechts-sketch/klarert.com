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

/** Signs in through the real magic-link flow (local Supabase + Mailpit). */
export async function signIn(page: Page, email: string, next?: string) {
  const started = Date.now();
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Send sign-in link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.goto(await latestLink(email, started));
}

export async function completeProfile(page: Page, name: string) {
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
}
