import 'server-only';
import { laneInput } from '@/engine/fields/view-support';
import { emptySheetData, sheetCtx, todayIn } from '@/engine/sheet-data';
import type { Automation, Condition, Json } from '@/engine/types';
import { lifecycle, stageField, stageFields, type Lifecycle } from '@/engine/workflow';
import { fetchAllPages, fetchItemsOfSheets, type Db } from '@/lib/sheet-query';
import { fetchSheetMetas } from '@/server/repositories/dashboards';
import { newId } from '@/server/sheet-context';

// Reads for the workflow page (docs/05 §4): every sheet of the workspace as one lifecycle row (its stage field, the
// stages, the items still running), the chosen sheet's field from ?field=. Run under the person's session and RLS.

export type WorkflowLifecycle = Omit<Lifecycle, 'field'> & {
  field: { id: string; key: string; name: string };
};

export interface WorkflowRow {
  sheet: { id: string; name: string; itemLabel: string };
  /** Fields of the sheet that can be the stages. */
  fields: { key: string; name: string }[];
  /** Null when the sheet has no status or label field. */
  lifecycle: WorkflowLifecycle | null;
  /** The raw value that puts an item into each stage, by stage key ('' = no stage). */
  inputs: Record<string, Json>;
  /** The sheet's approval workflows (docs/04 §13): name, on or off, the step names. */
  approvals: { id: string; name: string; enabled: boolean; steps: string[] }[];
}

export interface WorkflowData {
  rows: WorkflowRow[];
  /** The sheet named in the URL, when it still exists. */
  chosen: string | null;
  today: string;
}

function toAutomation(r: {
  id: string;
  sheet_id: string;
  name: string;
  enabled: boolean;
  trigger: unknown;
  conditions: unknown;
  actions: unknown;
  source: string;
  version: number;
  locked: boolean;
}): Automation {
  return {
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
  };
}

export async function getWorkflow(
  db: Db,
  orgId: string,
  env: { timeZone: string; userId: string; isAdmin: boolean },
  choice: { sheetId: string | null; fieldKey: string | null },
): Promise<WorkflowData> {
  const now = new Date();
  const today = todayIn(now, env.timeZone);
  // One read for the sheets, their fields and groups and the people; then the items of all of them. Links and
  // related items are not needed for stages, done and overdue (stored values), so the page stays a few queries.
  const [metas, autoRows] = await Promise.all([
    fetchSheetMetas(db, orgId),
    fetchAllPages((from, to) =>
      db
        .from('automations')
        .select(
          'id, sheet_id, name, enabled, trigger, conditions, actions, source, version, locked',
        )
        .eq('org_id', orgId)
        .order('created_at')
        .order('id')
        .range(from, to),
    ),
  ]);
  const sheets = metas.sheets.map((m) => m.sheet);
  const allFields = metas.sheets.flatMap((m) => m.fields);
  const chosen = sheets.find((s) => s.id === choice.sheetId)?.id ?? null;
  const automations = autoRows.map(toAutomation);
  const itemsOf = await fetchItemsOfSheets(
    db,
    orgId,
    sheets.map((s) => s.id),
  );
  const sheetName = (id: string) => sheets.find((s) => s.id === id)?.name;
  const rows: WorkflowRow[] = metas.sheets.map((m) => {
    const data = {
      ...emptySheetData(m.sheet),
      fields: m.fields,
      groups: m.groups,
      people: metas.people,
      items: itemsOf.get(m.sheet.id) ?? [],
      related: { sheets, fields: allFields, items: [] },
    };
    const ctx = sheetCtx(data, { now, newId, ...env });
    const usable = stageFields(m.fields, ctx);
    const field = stageField(m.fields, m.sheet.id === chosen ? choice.fieldKey : null, ctx);
    const sheet = { id: m.sheet.id, name: m.sheet.name, itemLabel: m.sheet.itemLabel };
    const fields = usable.map((f) => ({ key: f.key, name: f.name }));
    const approvals = (m.sheet.workflows ?? []).map((w) => ({
      id: w.id,
      name: w.name,
      enabled: w.enabled,
      steps: w.steps.map((st) => st.name),
    }));
    if (!field) return { sheet, fields, lifecycle: null, inputs: {}, approvals };
    const l = lifecycle(
      field,
      data.items,
      automations.filter((a) => a.sheetId === m.sheet.id),
      ctx,
      sheetName,
    );
    const inputs: Record<string, Json> = {};
    for (const st of l.stages) inputs[st.key ?? ''] = laneInput(field, ctx, st.key) as Json;
    return {
      sheet,
      fields,
      lifecycle: { ...l, field: { id: field.id, key: field.key, name: field.name } },
      inputs,
      approvals,
    };
  });
  return { rows, chosen, today };
}
