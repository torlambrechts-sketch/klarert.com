import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { generateNKeysBetween } from 'fractional-indexing';
import { accessToken, rest } from './helpers';

// Sheets, automations and items made over REST as the signed-in person (RLS applies), and grid steps that wait for
// the server's answer. Shared by the automation specs (M7 runner, M8 builder).

export const STATUS = {
  options: [
    { id: 'opt_todo', label: 'Not started', color: 'grey' },
    { id: 'opt_wip', label: 'Working on it', color: 'orange' },
    { id: 'opt_stuck', label: 'Stuck', color: 'red' },
    { id: 'opt_done', label: 'Done', color: 'green', done: true },
  ],
};

export type FieldSpec = {
  key: string;
  name: string;
  type: string;
  config?: Record<string, unknown>;
  rules?: unknown[];
};
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const prefix = () =>
  `${Array.from({ length: 5 }, () => letters[Math.floor(Math.random() * letters.length)]).join('')}-`;

/** Who is signed in on this page (the token's subject). */
export async function me(page: Page): Promise<string> {
  const token = await accessToken(page);
  return (JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as { sub: string })
    .sub;
}

async function workspace(page: Page, slug: string) {
  const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
  const [folder] = await rest<{ id: string }[]>(
    page,
    `folders?org_id=eq.${org!.id}&select=id&order=position&limit=1`,
  );
  return { orgId: org!.id, folderId: folder?.id ?? null };
}

/** A sheet with groups Open and Done and the given fields, created in one call (create_sheet). */
export async function makeSheet(
  page: Page,
  name: string,
  fields: FieldSpec[],
  itemLabel = 'Item',
  slug = 'meridian',
) {
  const { orgId, folderId } = await workspace(page, slug);
  const id = randomUUID();
  const groups = { Open: randomUUID(), Done: randomUUID() };
  const positions = generateNKeysBetween(null, null, fields.length);
  const ids = Object.fromEntries(fields.map((f) => [f.key, randomUUID()]));
  const idPrefix = prefix();
  await rest(page, 'rpc/create_sheet', {
    method: 'POST',
    body: {
      p: {
        sheet: {
          id,
          org_id: orgId,
          folder_id: folderId,
          name,
          item_label: itemLabel,
          id_prefix: idPrefix,
          position: `a${Date.now().toString(36)}`,
        },
        groups: [
          { id: groups.Open, name: 'Open', color: 'orange', position: 'a0' },
          { id: groups.Done, name: 'Done', color: 'green', position: 'a1' },
        ],
        fields: fields.map((f, i) => ({
          id: ids[f.key],
          key: f.key,
          name: f.name,
          type: f.type,
          position: positions[i],
          config: f.config ?? {},
          rules: f.rules ?? [],
        })),
      },
    },
  });
  const columns = fields.map((f) => f.name);
  return {
    id,
    orgId,
    idPrefix,
    groups,
    url: `/${slug}/s/${id}?view=table`,
    field: (key: string) => ids[key]!,
    /** Grid cell of an item: column 0 is the name, then the fields in order. */
    cell: (p: Page, item: string, column: string) =>
      p
        .getByRole('grid')
        .getByRole('row')
        .filter({ has: p.getByRole('gridcell', { name: item, exact: false }) })
        .getByRole('gridcell')
        .nth(columns.indexOf(column) + 1),
  };
}
export type Sheet = Awaited<ReturnType<typeof makeSheet>>;

export async function addAutomation(
  page: Page,
  sheet: Sheet,
  a: { name: string; trigger: Json; conditions?: Json[]; actions: Json[] },
): Promise<string> {
  const [row] = await rest<{ id: string }[]>(page, 'automations?select=id', {
    method: 'POST',
    body: {
      org_id: sheet.orgId,
      sheet_id: sheet.id,
      name: a.name,
      trigger: a.trigger,
      conditions: a.conditions ?? [],
      actions: a.actions,
      created_by: await me(page),
    },
  });
  return row!.id;
}

/** Items created directly (no automations run): the starting state of a test. */
export async function seedItems(
  page: Page,
  sheet: Sheet,
  rows: { name: string; values?: Record<string, Json> }[],
): Promise<Record<string, string>> {
  const keys = generateNKeysBetween(null, null, rows.length);
  await rest(page, 'rpc/create_items', {
    method: 'POST',
    body: {
      p_sheet: sheet.id,
      p_group: sheet.groups.Open,
      p_rows: rows.map((r, i) => ({ name: r.name, position: keys[i], values: r.values ?? {} })),
    },
  });
  const items = await rest<{ id: string; name: string }[]>(
    page,
    `items?sheet_id=eq.${sheet.id}&select=id,name`,
  );
  return Object.fromEntries(items.map((i) => [i.name, i.id]));
}

/** Wait until the server has answered the next server action (the command and its automations are finished). */
export function nextAnswer(page: Page) {
  return page.waitForResponse(
    (r) => r.request().method() === 'POST' && !!r.request().headers()['next-action'],
  );
}

/**
 * Finish the row an edit left held ("Editing" marker): its automations run now, against the final values. Waits for
 * the server to answer the finish. Does nothing when the row is not held.
 */
export async function finishRow(page: Page, item: string) {
  const row = page
    .getByRole('grid')
    .getByRole('row')
    .filter({ has: page.getByRole('gridcell', { name: item, exact: false }) });
  const done = row.getByRole('button', { name: 'Done', exact: true });
  await done.waitFor({ state: 'visible', timeout: 1_000 }).catch(() => undefined);
  if (!(await done.isVisible())) return;
  const answered = nextAnswer(page);
  await done.click();
  await answered;
}

// a double click opens the editor whether or not the cell is the active one; the row is finished afterwards
// (edits hold a row's automations until the person is done with it)
export async function pickStatus(
  page: Page,
  sheet: Sheet,
  item: string,
  label: string,
  opts: { finish?: boolean } = {},
) {
  await sheet.cell(page, item, 'Status').dblclick();
  const answered = nextAnswer(page);
  await page.getByRole('listbox', { name: 'Status' }).getByRole('option', { name: label }).click();
  await answered;
  if (opts.finish !== false) await finishRow(page, item);
}

export async function typeInto(
  page: Page,
  sheet: Sheet,
  item: string,
  column: string,
  text: string,
  opts: { finish?: boolean } = {},
) {
  await sheet.cell(page, item, column).dblclick();
  await page.getByRole('textbox', { name: column }).fill(text);
  const answered = nextAnswer(page);
  await page.keyboard.press('Enter');
  await answered;
  if (opts.finish !== false) await finishRow(page, item);
}

export type Run = { status: string; depth: number; detail: string; steps: { outcome: string }[] };
export const runsOf = (page: Page, automationId: string) =>
  rest<Run[]>(
    page,
    `automation_runs?automation_id=eq.${automationId}&select=status,depth,detail,steps&order=id`,
  );
