import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { seedWorkspace } from './first-sheet-helpers';
import { signIn } from './helpers';

// M10 performance (docs/01 §6): a 10 000-item × 30-field sheet made by scripts/perf/generate-sheet.ts scrolls
// smoothly. What is measured, in the page: the time between animation frames (requestAnimationFrame) while the grid
// scrolls 120 px per frame through the rows and then across the columns, and every long task (> 50 ms main-thread
// work, PerformanceObserver) in that time. Budgets: p95 frame time under 50 ms and no long task over 200 ms. This is
// headless Chromium on the test machine, so it is a regression guard, not a 60 fps proof on a customer's laptop.

test.beforeEach(({}, info) => test.skip(info.project.name === 'phone', 'desktop grid'));

/** The signed-in session from the auth cookie (possibly chunked, base64). */
async function session(page: Page) {
  const cookies = (await page.context().cookies())
    .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  let raw = decodeURIComponent(cookies.map((c) => c.value).join(''));
  if (raw.startsWith('base64-')) raw = Buffer.from(raw.slice(7), 'base64').toString('utf8');
  return JSON.parse(raw) as { access_token: string; refresh_token: string };
}

type Sample = { frames: number[]; longTasks: number[] };

/** Scroll the grid by `step` px per animation frame along one axis; collect frame times and long tasks. */
function scrollAndSample(page: Page, axis: 'top' | 'left', frames: number, step: number) {
  return page.getByRole('grid').evaluate(
    (el, { axis, frames, step }) =>
      new Promise<Sample>((resolve) => {
        const longTasks: number[] = [];
        const observer = new PerformanceObserver((list) =>
          list.getEntries().forEach((e) => longTasks.push(e.duration)),
        );
        observer.observe({ type: 'longtask' });
        const times: number[] = [];
        let last = 0;
        let n = 0;
        const tick = (now: number) => {
          if (last) times.push(now - last);
          last = now;
          if (axis === 'top') el.scrollTop += step;
          else el.scrollLeft += step;
          n += 1;
          if (n < frames) requestAnimationFrame(tick);
          else {
            observer.disconnect();
            resolve({ frames: times, longTasks });
          }
        };
        requestAnimationFrame(tick);
      }),
    { axis, frames, step },
  );
}

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1]!;

test('a 10 000-item × 30-field sheet scrolls within the frame budget', async ({ page }) => {
  test.setTimeout(300_000);
  const slug = seedWorkspace('fs-perf', { empty: true });
  await signIn(page, 'maria@example.com', `/${slug}/home`);
  await expect(page).toHaveURL(new RegExp(`/${slug}/home$`));
  const s = await session(page);
  const out = execFileSync(
    'pnpm',
    ['exec', 'tsx', '--env-file-if-exists=.env.local', 'scripts/perf/generate-sheet.ts'],
    {
      env: {
        ...process.env,
        PERF_WORKSPACE: slug,
        PERF_ITEMS: '10000',
        PERF_ACCESS_TOKEN: s.access_token,
        PERF_REFRESH_TOKEN: s.refresh_token,
      },
      encoding: 'utf8',
      timeout: 180_000,
    },
  );
  const sheet = JSON.parse(out.trim().split('\n').at(-1)!) as { sheetId: string; items: number };
  expect(sheet.items).toBe(10_000);

  await page.goto(`/${slug}/s/${sheet.sheetId}?view=grid`);
  await expect(page.getByRole('heading', { name: /^All rows\s*10,000 items/ })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole('grid').getByText('Row 00001', { exact: true })).toBeVisible();
  // warm up (first renders of each cell type, JIT), back to the top, let the page settle
  await scrollAndSample(page, 'top', 120, 120);
  await page.getByRole('grid').evaluate((el) => (el.scrollTop = 0));
  await page.waitForTimeout(1500);

  const down = await scrollAndSample(page, 'top', 600, 120);
  const across = await scrollAndSample(page, 'left', 120, 60);
  const frames = [...down.frames, ...across.frames];
  const longTasks = [...down.longTasks, ...across.longTasks];
  const result = {
    frames: frames.length,
    p95FrameMs: Math.round(p95(frames) * 10) / 10,
    maxFrameMs: Math.round(Math.max(...frames)),
    longTasks: longTasks.length,
    longestTaskMs: Math.round(Math.max(0, ...longTasks)),
  };
  test.info().annotations.push({ type: 'scroll', description: JSON.stringify(result) });
  console.log(`scroll 10 000 × 30: ${JSON.stringify(result)}`);
  // the window of rows moved: a row far down is rendered
  expect(await page.getByRole('grid').evaluate((el) => el.scrollTop)).toBeGreaterThan(60_000);
  expect(result.p95FrameMs).toBeLessThan(50);
  expect(result.longestTaskMs).toBeLessThan(200);
});
