import 'server-only';
import { laneInput } from '@/engine/fields/view-support';
import { sheetCtx, todayIn } from '@/engine/sheet-data';
import type { Automation, Condition, Json } from '@/engine/types';
import { lifecycle, stageField, stageFields, type Lifecycle } from '@/engine/workflow';
import { fetchSheetData, type Db } from '@/lib/sheet-query';
import { newId } from '@/server/sheet-context';

// Reads for the workflow page (docs/05 §4): the sheets of the workspace, the stage fields of the chosen sheet and its
// lifecycle by the chosen field. Run under the person's session and RLS.

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export interface WorkflowData {
  sheets: { id: string; name: string }[];
  sheet: { id: string; name: string; itemLabel: string } | null;
  /** Fields of the sheet that can be the stages. */
  fields: { key: string; name: string }[];
  lifecycle:
    (Omit<Lifecycle, 'field'> & { field: { id: string; key: string; name: string } }) | null;
  /** The raw value that puts an item into each stage, by stage key ('' = no stage). */
  inputs: Record<string, Json>;
  today: string;
}

export async function getWorkflow(
  db: Db,
  orgId: string,
  env: { timeZone: string; userId: string; isAdmin: boolean },
  choice: { sheetId: string | null; fieldKey: string | null },
): Promise<WorkflowData> {
  const now = new Date();
  const today = todayIn(now, env.timeZone);
  const sheets = must(
    await db
      .from('sheets')
      .select('id, name')
      .eq('org_id', orgId)
      .is('archived_at', null)
      .order('position'),
  );
  const empty: WorkflowData = {
    sheets,
    sheet: null,
    fields: [],
    lifecycle: null,
    inputs: {},
    today,
  };
  const sheetId = sheets.find((s) => s.id === choice.sheetId)?.id ?? sheets[0]?.id;
  if (!sheetId) return empty;
  const [data, autoRows] = await Promise.all([
    fetchSheetData(db, sheetId),
    db
      .from('automations')
      .select('id, sheet_id, name, enabled, trigger, conditions, actions, source, version, locked')
      .eq('sheet_id', sheetId)
      .order('created_at')
      .order('id')
      .then(must),
  ]);
  if (!data) return empty;
  const ctx = sheetCtx(data, { now, newId, ...env });
  const usable = stageFields(data.fields, ctx);
  const field = stageField(data.fields, choice.fieldKey, ctx);
  const sheet = { id: data.sheet.id, name: data.sheet.name, itemLabel: data.sheet.itemLabel };
  const fields = usable.map((f) => ({ key: f.key, name: f.name }));
  if (!field) return { ...empty, sheet, fields };
  const automations: Automation[] = autoRows.map((r) => ({
    id: r.id,
    sheetId: r.sheet_id,
    name: r.name,
    enabled: r.enabled,
    trigger: r.trigger as Automation['trigger'],
    conditions: (r.conditions ?? []) as unknown as Condition[],
    actions: (r.actions ?? []) as Automation['actions'],
    source: r.source,
    version: r.version,
    locked: r.locked,
  }));
  const sheetName = (id: string) =>
    sheets.find((s) => s.id === id)?.name ?? data.related.sheets.find((s) => s.id === id)?.name;
  const l = lifecycle(field, data.items, automations, ctx, sheetName);
  const inputs: Record<string, Json> = {};
  for (const s of l.stages) inputs[s.key ?? ''] = laneInput(field, ctx, s.key) as Json;
  return {
    sheets,
    sheet,
    fields,
    lifecycle: { ...l, field: { id: field.id, key: field.key, name: field.name } },
    inputs,
    today,
  };
}
