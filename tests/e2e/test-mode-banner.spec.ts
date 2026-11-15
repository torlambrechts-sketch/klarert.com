import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { localSql, seedWorkspace } from './first-sheet-helpers';
import { signIn } from './helpers';

// One test mode banner (docs/04 §14, owner decisions Nov 2026 and 15 Nov 2026): with the shared registers and every
// standard installed, Home shows one short banner ("N automations are in test mode." and one link) and Workspace
// admin › Packs one full banner, not one per pack. The full banner says how many automations from how many packs
// wait in test mode and names the packs; "Turn on by pack" opens each pack's own Turn on, by keyboard too. Turning
// one pack on leaves the banner naming the others. At 390 px nothing scrolls sideways.

const SHOTS = process.env.CORE12_SHOTS;

/** The newest catalogue version of each pack, installed with the service role as the app would. */
const PACKS = [
  'core',
  'gdpr',
  'iso-9001',
  'iso-14001',
  'iso-27001',
  'iso-45001',
  'nis2',
  'supplier-management',
];

function install(slug: string, key: string, version: string, level?: string) {
  execFileSync(
    'pnpm',
    [
      'exec',
      'tsx',
      '--env-file-if-exists=.env.local',
      'tests/e2e/install-pack-version.ts',
      slug,
      key,
      version,
      ...(level ? [level] : []),
    ],
    { encoding: 'utf8', stdio: 'pipe', timeout: 120_000 },
  );
}

const newest = (key: string) =>
  localSql(
    `select version || '|' || title from packs where key = '${key}'
      order by string_to_array(version, '.')::int[] desc limit 1`,
  )
    .trim()
    .split('|') as [string, string];

test('one banner names every pack whose automations wait in test mode', async ({ page }, info) => {
  test.setTimeout(420_000);
  const phone = info.project.name === 'phone';
  const slug = seedWorkspace(phone ? 'tmbp' : 'tmb', { empty: true });
  const titles: string[] = [];
  for (const key of PACKS) {
    const [version, title] = newest(key);
    install(slug, key, version, key === 'core' ? 'full' : undefined);
    // the words people see (engine/packs/words.ts): no "(add-on)", Shared registers for Core
    titles.push(
      title === 'Core registers' ? 'Shared registers' : title.replace(/ \(add-on\)$/, ''),
    );
  }

  // ── Home: one short banner, the total and one link (owner decision 15 Nov 2026, UX-3)
  await signIn(page, 'maria@example.com', `/${slug}/home`);
  await page.goto(`/${slug}/home`);
  const home = page.getByTestId('test-mode-banner');
  await expect(home).toHaveCount(1);
  await expect(home.getByRole('heading')).toHaveText(/^\d+ automations are in test mode\.$/);
  await expect(home.getByRole('link')).toHaveCount(1);
  await expect(home.getByRole('button')).toHaveCount(0);
  for (const t of titles) await expect(home).not.toContainText(t);
  if (phone)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  if (SHOTS)
    await home.screenshot({ path: `${SHOTS}/banner-home-${phone ? '390' : 'desktop'}.png` });

  // ── its one link opens Workspace admin › Packs at the full banner, which names every pack
  await home.getByRole('link', { name: 'Review and turn on' }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/settings\\?tab=packs#test-mode$`));
  const banner = page.getByTestId('test-mode-banner');
  await expect(banner).toHaveCount(1);
  await expect(banner.getByRole('heading')).toHaveText(
    /^\d+ automations from 8 packs are in test mode\. Review and turn them on\.$/,
  );
  for (const t of titles) await expect(banner).toContainText(t);
  await expect(banner.getByRole('link', { name: 'Review the run log' })).toBeVisible();
  const list = banner.getByRole('list', { name: 'Packs with automations in test mode' });
  await expect(list).toBeHidden();

  // ── by keyboard: the disclosure opens the per-pack actions
  const byPack = banner.getByRole('button', { name: 'Turn on by pack' });
  await expect(byPack).toHaveAttribute('aria-expanded', 'false');
  await byPack.focus();
  await page.keyboard.press('Enter');
  await expect(byPack).toHaveAttribute('aria-expanded', 'true');
  await expect(list.getByRole('listitem')).toHaveCount(8);
  if (phone)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  if (SHOTS)
    await banner.screenshot({
      path: `${SHOTS}/banner-packs-${phone ? '390' : 'desktop'}-open.png`,
    });

  // ── one pack goes live; the banner names the seven left
  const supplier = titles[PACKS.indexOf('supplier-management')]!;
  const turnOn = list.getByRole('button', { name: `Turn on all automations from ${supplier}` });
  await turnOn.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText(new RegExp(`^Turned on \\d+ automations from `)).first(),
  ).toBeVisible();
  await expect(banner.getByRole('heading')).toHaveText(/from 7 packs are in test mode\./);
  await expect(banner).not.toContainText(supplier);
  const org = localSql(`select id from orgs where slug = '${slug}'`).trim();
  expect(
    localSql(
      `select count(*) from automations a join pack_installs i on i.id = a.pack_install_id
        where a.org_id = '${org}' and i.pack_key = 'supplier-management' and a.mode = 'test'`,
    ).trim(),
  ).toBe('0');

  // ── Home: still one banner, with the smaller total
  await page.goto(`/${slug}/home`);
  await expect(page.getByTestId('test-mode-banner')).toHaveCount(1);
  await expect(page.getByTestId('test-mode-banner').getByRole('heading')).toHaveText(
    /^\d+ automations are in test mode\.$/,
  );
});
