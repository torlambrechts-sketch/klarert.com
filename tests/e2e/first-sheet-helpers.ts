import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { rest } from './helpers';

// Helpers for the docs/07 acceptance walkthrough (first-sheet.spec.ts).

/**
 * A fresh workspace from the seed: the four people of templates/first-sheet.json (Maria owner, James and Tom editors,
 * Vic viewer), teams, job roles, the folder "Your sheets", and, unless `empty`, the template's two sheets with items,
 * links and automations (the importer). The seed is the only place outside the app allowed the service role.
 */
export function seedWorkspace(prefix: string, opts: { empty?: boolean } = {}): string {
  const slug = `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 4)}`;
  execFileSync('pnpm', ['exec', 'tsx', '--env-file-if-exists=.env.local', 'scripts/seed.ts'], {
    env: { ...process.env, SEED_WORKSPACE: slug, SEED_SHEETS: opts.empty ? '0' : '1' },
    stdio: 'pipe',
    timeout: 60_000,
  });
  return slug;
}

/**
 * SQL as the database owner against the local stack: only to move time forward for the webhook worker (docs/07 B9
 * "time-travel the worker"). Uses psql, or psql inside the local database container.
 */
export function localSql(query: string): string {
  const url =
    process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  try {
    return execFileSync('psql', [url, '-Atc', query], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    const container = execFileSync(
      'docker',
      ['ps', '--format', '{{.Names}}', '--filter', 'name=supabase_db_'],
      {
        encoding: 'utf8',
      },
    )
      .trim()
      .split('\n')[0]!;
    return execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-Atc', query], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  }
}

/** ISO date `days` from today in the workspace time zone (Europe/London). */
export function isoIn(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "20/11/2026" for an ISO date: how a person types a UK date. */
export const ukDate = (iso: string) => iso.split('-').reverse().join('/');

/** "16 Nov" for an ISO date: how cells show a date (docs/05: 11 Nov 2026). */
export const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

export type Ids = {
  orgId: string;
  sheets: Record<string, string>;
  /** `${sheetName}` → item name → { id, display_id } */
  item(sheet: string, name: string): Promise<{ id: string; display_id: string }>;
  field(sheet: string, key: string): Promise<string>;
};

/** Look up ids of a seeded workspace over REST as the signed-in person. */
export async function idsOf(page: Page, slug: string): Promise<Ids> {
  const [org] = await rest<{ id: string }[]>(page, `orgs?slug=eq.${slug}&select=id`);
  const sheets = await rest<{ id: string; name: string }[]>(
    page,
    `sheets?org_id=eq.${org!.id}&select=id,name`,
  );
  const byName = Object.fromEntries(sheets.map((s) => [s.name, s.id]));
  return {
    orgId: org!.id,
    sheets: byName,
    async item(sheet, name) {
      const rows = await rest<{ id: string; display_id: string }[]>(
        page,
        `items?sheet_id=eq.${byName[sheet]}&name=eq.${encodeURIComponent(name)}&select=id,display_id`,
      );
      expect(rows, `${sheet} › ${name}`).toHaveLength(1);
      return rows[0]!;
    },
    async field(sheet, key) {
      const rows = await rest<{ id: string }[]>(
        page,
        `fields?sheet_id=eq.${byName[sheet]}&key=eq.${key}&select=id`,
      );
      return rows[0]!.id;
    },
  };
}

/** Wait until a popover or menu has gone (Radix keeps it the top layer during its exit animation). */
export async function popoverGone(page: Page) {
  await expect(page.locator('[data-radix-popper-content-wrapper]')).toHaveCount(0);
}
