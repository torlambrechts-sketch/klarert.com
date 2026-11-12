import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

// docs/05 §7: the offline banner on every page. Uses the seed (pnpm seed): vic@example.com is a viewer of /meridian.

test('going offline shows the banner on any page; back online hides it', async ({
  page,
  context,
}) => {
  await signIn(page, 'vic@example.com', '/meridian/home');
  await expect(page).toHaveURL(/\/meridian\/home$/);
  const banner = page.getByTestId('offline-banner');
  await expect(banner).toHaveCount(0);

  await context.setOffline(true);
  await expect(banner).toHaveText('You are offline. Changes will fail until you reconnect.');
  await expect(banner).toHaveRole('status');
  await context.setOffline(false);
  await expect(banner).toHaveCount(0);

  // on another page too, and it does not push the page down
  await page.goto('/meridian/my-work');
  const heading = page.getByRole('heading', { level: 1, name: 'My work' });
  await expect(heading).toBeVisible();
  const before = (await heading.boundingBox())!.y;
  await context.setOffline(true);
  await expect(banner).toBeVisible();
  expect((await heading.boundingBox())!.y).toBe(before);
  await context.setOffline(false);
  await expect(banner).toHaveCount(0);
});
