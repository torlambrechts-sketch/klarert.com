// Cell edit round trip (M10, docs/01 §6: "Cell edit → saved and visible to other users < 500 ms p95 in EU").
// Drives the real app in headless Chromium as a signed-in editor, with a second browser watching the same sheet:
//   command  Enter in the cell editor → the Server Action (command + automations) answered
//   visible  Enter in the cell editor → the new value shown in the other browser (realtime)
// and, for comparison, the database path the command uses, without the app:
//   db write set_item_values over PostgREST → answered
//   db echo  set_item_values over PostgREST → the realtime UPDATE received by a second client
//
// Local:  pnpm perf:roundtrip                     (app on :3000, local Supabase, maria@example.com via Mailpit)
// EU:     PERF_APP_URL=https://<app> PERF_SUPABASE_URL=https://<ref>.supabase.co PERF_ANON_KEY=<anon key>
//         PERF_EMAIL=<editor> PERF_PASSWORD=<password> PERF_WORKSPACE=<slug> [PERF_EDITS=50] [PERF_SHEET_ID=<uuid>]
//         pnpm perf:roundtrip
//         (or PERF_ACCESS_TOKEN + PERF_REFRESH_TOKEN from a signed-in browser instead of the password)
// Without PERF_SHEET_ID a small sheet (30 rows × 30 fields) is generated in the workspace first. Prints p50 / p95 / max.
import { chromium, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { generateSheet } from './generate-sheet';
import { perfEnv, sessionCookies, signInForPerf, stats } from './session';

const EDITS = Number(process.env.PERF_EDITS ?? 50);
const ROWS = 10;

async function main() {
  const signedIn = await signInForPerf();
  const sheetId = process.env.PERF_SHEET_ID || (await generateSheet(30, signedIn)).sheetId;
  const url = `${perfEnv.APP_URL}/${perfEnv.WORKSPACE}/s/${sheetId}?view=grid`;
  const cookies = (await sessionCookies(signedIn.session)).map((c) => ({
    ...c,
    url: perfEnv.APP_URL,
  }));

  const browser = await chromium.launch();
  const open = async () => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await context.addCookies(cookies);
    const page = await context.newPage();
    await page.goto(url);
    await page.getByRole('grid').getByText('Row 00001', { exact: true }).waitFor();
    return page;
  };
  const editor = await open();
  const watcher = await open();
  await watcher.waitForTimeout(2000); // the realtime channel joins

  const scoreCell = (page: Page, row: number) =>
    page
      .getByRole('grid')
      .getByRole('row')
      .filter({ has: page.getByRole('gridcell', { name: `Row ${String(row).padStart(5, '0')}` }) })
      .getByRole('gridcell')
      .nth(5);

  const command: number[] = [];
  const visible: number[] = [];
  for (let i = 0; i < EDITS; i += 1) {
    const row = (i % ROWS) + 1;
    // under 1 000, so the cell shows it as typed (no thousands separator)
    const value = String(100 + (i % 900));
    await scoreCell(editor, row).click();
    await editor.keyboard.press('Enter');
    await editor.getByRole('textbox', { name: 'Score' }).fill(value);
    const answered = editor.waitForResponse(
      (r) => r.request().method() === 'POST' && !!r.request().headers()['next-action'],
    );
    // checked on every animation frame in the watching page (locator polling backs off to 500 ms)
    const seen = watcher.waitForFunction(
      ([name, v]) => {
        const rows = [...document.querySelectorAll('[role="grid"] [role="row"]')];
        const r = rows.find((el) =>
          el.querySelector('[role="gridcell"]')?.textContent?.includes(name!),
        );
        return !!r?.querySelectorAll('[role="gridcell"]')[5]?.textContent?.includes(v!);
      },
      [`Row ${String(row).padStart(5, '0')}`, value],
      { polling: 'raf', timeout: 15_000 },
    );
    const t0 = Date.now();
    await editor.keyboard.press('Enter');
    await answered;
    command.push(Date.now() - t0);
    await seen;
    visible.push(Date.now() - t0);
  }
  await browser.close();

  // the database path alone: PostgREST write and the realtime echo on a second client
  const { db, session } = signedIn;
  const listener = createClient(perfEnv.SUPABASE_URL, perfEnv.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  listener.realtime.setAuth(session.access_token);
  const { data: rows } = await db
    .from('items')
    .select('id')
    .eq('sheet_id', sheetId)
    .order('seq')
    .limit(ROWS);
  const { data: fields } = await db
    .from('fields')
    .select('id')
    .eq('sheet_id', sheetId)
    .eq('key', 'score')
    .single();
  const waiting = new Map<string, (t: number) => void>();
  const channel = listener
    .channel(`perf:${sheetId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'items', filter: `sheet_id=eq.${sheetId}` },
      (p) => {
        const v = (p.new as { values: Record<string, unknown> }).values[fields!.id];
        waiting.get(String(v))?.(Date.now());
      },
    );
  await new Promise<void>((resolve) =>
    channel.subscribe((s) => {
      if (s === 'SUBSCRIBED') resolve();
    }),
  );
  await new Promise((r) => setTimeout(r, 1000));
  const write: number[] = [];
  const echo: number[] = [];
  for (let i = 0; i < EDITS; i += 1) {
    const value = 5000 + i;
    const item = rows![i % rows!.length]!.id;
    const got = new Promise<number>((resolve, reject) => {
      waiting.set(String(value), resolve);
      setTimeout(() => reject(new Error('no realtime echo in 15 s')), 15_000);
    });
    const t0 = Date.now();
    const { error } = await db.rpc('set_item_values', {
      p_item: item,
      p_patch: { [fields!.id]: value },
    });
    if (error) throw new Error(error.message);
    write.push(Date.now() - t0);
    echo.push((await got) - t0);
  }
  await listener.removeChannel(channel);

  const report = {
    app: perfEnv.APP_URL,
    supabase: new URL(perfEnv.SUPABASE_URL).host,
    edits: EDITS,
    command: stats(command),
    visible: stats(visible),
    dbWrite: stats(write),
    dbEcho: stats(echo),
  };
  console.log(JSON.stringify(report, null, 2));
  console.log(
    `Cell edit visible to another person: p95 ${report.visible.p95} ms (budget 500 ms) ` +
      `${report.visible.p95 < 500 ? 'within budget' : 'OVER BUDGET'}.`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
