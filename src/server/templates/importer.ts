// Writes a sheet template into a workspace (docs/07 Part B; the template's `importer` notes). The plan comes from the
// pure planner (src/lib/templates/plan.ts); this file only writes it, in the documented order:
// sheets → fields without links → link fields with inverses → groups → views → items → links → automations.
//
// It is given a Supabase client and does not import 'server-only' so that `scripts/seed.ts` (tsx, service role) can
// run it. With the service role, auth.uid() is null, so every activity entry (item.created, link.changed and the
// schema entries) is written with actor `system`; items go through create_items and links through set_item_links,
// the same RPCs the commands use, and no automation runs and no status rule is checked while the sample data loads.
// The automations are inserted last, enabled as the template says. Re-running finds the sheets by their template
// marker (sheets.settings.template) and changes nothing.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Json } from '@/engine/types';
import type { Database } from '@/lib/database.types';
import { planTemplateImport, type ImportPlan, type PlanEnv } from '@/lib/templates/plan';
import type { SheetTemplate } from '@/lib/templates/schema';

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
  | { status: 'imported'; counts: ImportCounts; sheetIds: Record<string, string> }
  | { status: 'exists'; sheetIds: Record<string, string> };

function must<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

/** Sheets of this workspace already made from this template: ref → sheet id. */
async function existing(db: Db, orgId: string, templateId: string) {
  const rows = must(
    await db
      .from('sheets')
      .select('id, settings')
      .eq('org_id', orgId)
      .eq('settings->template->>id', templateId),
    'existing sheets',
  );
  const out: Record<string, string> = {};
  for (const r of rows ?? []) {
    const ref = (r.settings as { template?: { ref?: string } } | null)?.template?.ref;
    if (ref) out[ref] = r.id;
  }
  return out;
}

export async function importTemplate(
  db: Db,
  template: SheetTemplate,
  env: Omit<PlanEnv, 'lastSheetPosition'>,
): Promise<ImportOutcome> {
  const found = await existing(db, env.orgId, template.id);
  const refs = template.sheets.map((s) => s.ref);
  if (refs.every((r) => found[r])) return { status: 'exists', sheetIds: found };
  if (refs.some((r) => found[r]))
    throw new Error(
      `Part of template ${template.id} is already in this workspace (${Object.keys(found).join(', ')}). ` +
        'Archive or delete those sheets, then import again.',
    );

  const last = must(
    await db
      .from('sheets')
      .select('position')
      .eq('org_id', env.orgId)
      .order('position', { ascending: false })
      .limit(1),
    'last sheet',
  );
  const plan = planTemplateImport(template, { ...env, lastSheetPosition: last?.[0]?.position ?? null });
  if (plan.problems.length)
    throw new Error(`Template ${template.id} does not fit:\n  ${plan.problems.join('\n  ')}`);
  return { status: 'imported', ...(await write(db, plan)) };
}

async function write(db: Db, plan: ImportPlan) {
  const counts: ImportCounts = {
    sheets: 0,
    fields: 0,
    groups: 0,
    views: 0,
    items: 0,
    links: 0,
    automations: 0,
  };
  const sheets = plan.sheets;
  must(await db.from('sheets').insert(sheets.map((s) => s.row as never)), 'sheets');
  counts.sheets = sheets.length;

  const allFields = sheets.flatMap((s) => s.fields);
  const isLink = (f: (typeof allFields)[number]) =>
    !!f.config && typeof f.config === 'object' && 'targetSheetId' in f.config;
  for (const batch of [allFields.filter((f) => !isLink(f)), allFields.filter(isLink)]) {
    if (batch.length) must(await db.from('fields').insert(batch as never), 'fields');
    counts.fields += batch.length;
  }

  const groups = sheets.flatMap((s) => s.groups);
  must(await db.from('groups').insert(groups), 'groups');
  counts.groups = groups.length;

  // sub-items: the child sheets after their parents (docs/02 §12)
  for (const s of sheets) {
    const sub = s.subitems;
    if (!sub) continue;
    const orgId = s.row.org_id;
    must(await db.from('sheets').insert(sub.sheet as never), 'sub-item sheet');
    must(
      await db.from('groups').insert({ ...sub.group, org_id: orgId, sheet_id: sub.sheet.id }),
      'sub-item group',
    );
    must(
      await db
        .from('fields')
        .insert(sub.fields.map((f) => ({ ...f, org_id: orgId, sheet_id: sub.sheet.id })) as never),
      'sub-item fields',
    );
    counts.sheets += 1;
    counts.groups += 1;
    counts.fields += sub.fields.length;
  }

  const views = sheets.flatMap((s) => s.views);
  if (views.length) must(await db.from('views').insert(views as never), 'views');
  counts.views = views.length;

  const itemIds = new Map<string, string>(); // `${sheetRef}|${name}` → id
  for (const s of sheets) {
    for (const g of s.items) {
      const n = must(
        await db.rpc('create_items', {
          p_sheet: s.row.id,
          p_group: g.groupId,
          p_rows: g.rows as unknown as Json,
          p_note: 'Template import',
        }),
        `items of ${s.row.name}`,
      );
      counts.items += n ?? 0;
    }
    const rows = must(
      await db.from('items').select('id, name').eq('sheet_id', s.row.id),
      `items of ${s.row.name}`,
    );
    for (const r of rows ?? []) itemIds.set(`${s.ref}|${r.name}`, r.id);
  }

  // one set_item_links call per (field, from item), each direction written on its own side
  const calls = new Map<string, { field: string; from: string; to: string[] }>();
  for (const l of plan.links) {
    const from = itemIds.get(`${l.from.sheetRef}|${l.from.name}`);
    const to = itemIds.get(`${l.to.sheetRef}|${l.to.name}`);
    if (!from || !to) throw new Error(`link ${l.from.name} → ${l.to.name}: item not found`);
    const k = `${l.fieldId}|${from}`;
    const c = calls.get(k) ?? { field: l.fieldId, from, to: [] };
    c.to.push(to);
    calls.set(k, c);
  }
  for (const c of calls.values()) {
    must(
      await db.rpc('set_item_links', {
        p_field: c.field,
        p_from: c.from,
        p_to: c.to,
        p_mode: 'add',
      }),
      'links',
    );
    counts.links += c.to.length;
  }

  if (plan.automations.length)
    must(await db.from('automations').insert(plan.automations as never), 'automations');
  counts.automations = plan.automations.length;

  return { counts, sheetIds: Object.fromEntries(sheets.map((s) => [s.ref, s.row.id])) };
}
