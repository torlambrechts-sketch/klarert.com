import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { idsOf, seedWorkspace } from './first-sheet-helpers';
import { signIn } from './helpers';

// M10 accessibility (docs/01 §6: WCAG 2.1 AA): axe on Home, the sheet (List, Grid), the item panel and the automation
// builder, against a workspace seeded with the first-sheet template so every page has real content. Zero serious or
// critical violations. The keyboard-only pass of a core flow is in keyboard.spec.ts (docs/08-accessibility.md).

test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop pages'));

let slug = '';
test.beforeAll(({}, info) => {
  if (info.project.name !== 'phone') slug = seedWorkspace('fs-ax');
});

async function axe(page: Page, what: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = bad.map(
    (v) =>
      `${v.impact} ${v.id}: ${v.help}\n${v.nodes
        .slice(0, 5)
        .map(
          (n) => `    ${n.html.slice(0, 200)} — ${n.failureSummary?.split('\n')[1]?.trim() ?? ''}`,
        )
        .join('\n')}`,
  );
  expect(report, `${what}: serious or critical axe violations`).toEqual([]);
}

test('Home, the sheet in List and Grid, the item panel and the automation builder', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, 'maria@example.com', `/${slug}/home`);
  await expect(page).toHaveURL(new RegExp(`/${slug}/home$`));
  await expect(page.getByTestId('home-summary')).toBeVisible();
  await axe(page, 'Home');

  const ids = await idsOf(page, slug);
  const ca = ids.sheets['Corrective actions']!;
  await page.goto(`/${slug}/s/${ca}`);
  await expect(page.getByText('Guard bypassed on press 3').first()).toBeVisible();
  await axe(page, 'Sheet · List');

  await page.goto(`/${slug}/s/${ca}?view=grid`);
  await expect(page.getByRole('grid').getByText('Guard bypassed on press 3')).toBeVisible();
  await axe(page, 'Sheet · Grid');

  await page.goto(`/${slug}/s/${ca}?view=grid&item=CA-001`);
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('heading', { name: 'Burrs on bracket 44-210' })).toBeVisible();
  await expect(panel.getByRole('list', { name: 'Automations on this item' })).toBeVisible();
  await axe(page, 'Item panel · Details');
  await panel.getByRole('tab', { name: /^Activity log/ }).click();
  await expect(panel.getByRole('list', { name: 'Activity log' })).toBeVisible();
  await axe(page, 'Item panel · Activity log');

  await page.goto(`/${slug}/automations?new=1&sheet=${ca}`);
  await expect(page.getByRole('heading', { name: 'New automation' })).toBeVisible();
  await axe(page, 'Automation builder');

  await page.goto(`/${slug}/automations`);
  await expect(page.getByText('Critical severity → alert the HSE manager').first()).toBeVisible();
  await axe(page, 'Automations list');
});
