// Writes a sheet template into a workspace (docs/07 Part B) on the pack path (docs/11): the template is wrapped as a
// pack (or found in the repository's catalogue), written to the `packs` catalogue if it is not there yet, planned by
// the pure pack planner and written by install_pack in one transaction, with provenance on every row and a
// `pack.installed` entry in the workspace's log.
//
// It is given a Supabase client and does not import 'server-only' so that `scripts/seed.ts` (tsx, service role) can
// run it. With the service role, auth.uid() is null, so every activity entry is written with actor `system`; nothing
// runs automations or checks status rules while the sample data loads. Re-running changes nothing: the workspace
// already has the pack installed (or, for workspaces seeded before packs, the sheets carry the template marker).
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import type { Database } from '@/lib/database.types';
import { repoPacks } from '@/lib/packs/catalogue';
import { packHash } from '@/lib/packs/hash';
import { parsePack } from '@/lib/packs/manifest';
import { templateToPack } from '@/lib/packs/wrap';
import type { SheetTemplate } from '@/lib/templates/schema';
import { planInstall, syncCatalogue, writeInstall } from '@/server/packs/install';

type Db = SupabaseClient<Database>;

export interface ImportCounts {
  sheets: number;
  fields: number;
  groups: number;
  views: number;
  items: number;
  links: number;
  automations: number;
}

export type ImportOutcome =
  | { status: 'imported'; counts: ImportCounts; sheetIds: Record<string, string>; installId: string }
  | { status: 'exists'; sheetIds: Record<string, string> };

/** Sheets of this workspace made from this template before packs (sheets.settings.template): ref → sheet id. */
async function existing(db: Db, orgId: string, templateId: string) {
  const { data, error } = await db
    .from('sheets')
    .select('id, settings')
    .eq('org_id', orgId)
    .is('parent_sheet_id', null)
    .eq('settings->template->>id', templateId);
  if (error) throw new Error(`existing sheets: ${error.message}`);
  const out: Record<string, string> = {};
  for (const r of data ?? []) {
    const ref = (r.settings as { template?: { ref?: string } } | null)?.template?.ref;
    if (ref) out[ref] = r.id;
  }
  return out;
}

export async function importTemplate(
  db: Db,
  template: SheetTemplate,
  env: { orgId: string; now: Date; newId?: () => string },
  meta?: { title: string; version: string },
): Promise<ImportOutcome> {
  const found = await existing(db, env.orgId, template.id);
  const refs = template.sheets.map((s) => s.ref);
  if (refs.every((r) => found[r])) return { status: 'exists', sheetIds: found };
  if (refs.some((r) => found[r]))
    throw new Error(
      `Part of template ${template.id} is already in this workspace (${Object.keys(found).join(', ')}). ` +
        'Archive or delete those sheets, then import again.',
    );

  // the repository's pack for this template, else the template wrapped as a pack
  const manifest =
    repoPacks().find((p) => p.key === template.id) ??
    parsePack(
      templateToPack(template, {
        version: meta?.version ?? `${template.version}.0.0`,
        title: meta?.title ?? template.sheets[0]!.name,
      }),
    );
  await syncCatalogue(db, [manifest]);
  const plan = await planInstall(
    db,
    env.orgId,
    { manifest, hash: packHash(manifest) },
    // sample data: its automations start live (a person's install starts notifying ones in test mode)
    { userId: '', now: env.now, newId: env.newId ?? randomUUID, live: true },
  );
  if (plan.state === 'installed') return { status: 'exists', sheetIds: found };
  const problems = [...plan.preview.conflicts, ...plan.preview.warnings];
  if (plan.state === 'blocked' || problems.length)
    throw new Error(`Template ${template.id} does not fit:\n  ${problems.join('\n  ')}`);
  const written = await writeInstall(db, env.orgId, plan);
  if (!written.ok) throw new Error(`install ${template.id}: ${written.error.message}`);
  const c = written.data.counts;
  const sheetIds = Object.fromEntries(
    Object.entries(written.data.refMap)
      .filter(([k]) => k.startsWith('sheet:') && !k.includes('.'))
      .map(([k, v]) => [k.slice('sheet:'.length), v]),
  );
  return {
    status: 'imported',
    installId: written.data.installId,
    sheetIds,
    counts: {
      sheets: c.sheets ?? 0,
      fields: c.fields ?? 0,
      groups: c.groups ?? 0,
      views: (c.views ?? 0) + (c.forms ?? 0),
      items: c.items ?? 0,
      links: c.links ?? 0,
      automations: c.automations ?? 0,
    },
  };
}
