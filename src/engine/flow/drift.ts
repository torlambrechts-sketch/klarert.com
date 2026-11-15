// "Differs from pack" (docs/05 §3.8): each row a pack made, as the workspace holds it now, compared with the same row
// as the installed version ships it (the base of the three-way upgrade, docs/11 Upgrades), attribute by attribute as
// the upgrade compares them. Automations: name, trigger, conditions, actions (never on/off). Forms: name and settings.
// Fields: name, description, required, locked and each setting the pack ships. Approval workflows: each one whole.
// Pure: the server plans the base and reads the live rows.
import { sameJson } from '../packs/upgrade';
import type { Json } from '../types';
import type { DriftState, Provenance } from './types';

type Row = Record<string, Json>;

/** The installed version of one install, planned as install_pack wrote it, by ref (ids are the install's). */
export interface BaseRows {
  installId: string;
  automations: Map<string, Row>;
  views: Map<string, Row>;
  fields: Map<string, Row>;
  sheets: Map<string, Row>;
  /** Approval workflows the install adds to other packs' sheets (docs/11 Extends). */
  extensionWorkflows: { sheetId: string; workflow: Json }[];
}

export interface LiveRows {
  automations: {
    id: string;
    pack: Provenance | null;
    name: string;
    trigger: Json;
    conditions: Json;
    actions: Json;
  }[];
  forms: { id: string; pack: Provenance | null; name: string; config: Json }[];
  fields: {
    id: string;
    pack: Provenance | null;
    name: string;
    description: string | null;
    required: boolean;
    locked: boolean;
    config: Json;
  }[];
  /** Sheets with their approval workflows as stored (sheets.settings.workflows). */
  sheets: { id: string; pack: Provenance | null; workflows: Json }[];
}

const isObj = (v: Json | undefined): v is Record<string, Json> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const state = (same: boolean): DriftState => (same ? 'unchanged' : 'changed');
const idOf = (w: Json): string | null => (isObj(w) && typeof w.id === 'string' ? w.id : null);

/** `automation:<id>`, `form:<id>`, `field:<id>` and `workflow:<sheet>:<id>` → unchanged or changed. */
export function packDrift(base: BaseRows, live: LiveRows): Record<string, DriftState> {
  const out: Record<string, DriftState> = {};
  const own = <T extends { pack: Provenance | null }>(rows: T[]) =>
    rows.filter((r) => r.pack?.installId === base.installId);

  for (const a of own(live.automations)) {
    const b = base.automations.get(a.pack!.ref);
    if (!b) continue;
    out[`automation:${a.id}`] = state(
      sameJson(b.name, a.name) &&
        sameJson(b.trigger, a.trigger) &&
        sameJson(b.conditions ?? [], a.conditions ?? []) &&
        sameJson(b.actions, a.actions),
    );
  }
  for (const f of own(live.forms)) {
    const b = base.views.get(f.pack!.ref);
    if (!b) continue;
    out[`form:${f.id}`] = state(sameJson(b.name, f.name) && sameJson(b.config, f.config));
  }
  for (const f of own(live.fields)) {
    const b = base.fields.get(f.pack!.ref);
    if (!b) continue;
    const top =
      sameJson(b.name, f.name) &&
      sameJson(b.description ?? null, f.description ?? null) &&
      sameJson(b.required ?? false, f.required) &&
      sameJson(b.locked ?? false, f.locked);
    const bc = isObj(b.config) ? b.config : {};
    const mc = isObj(f.config) ? f.config : {};
    const cfg = Object.keys(bc).every((k) => sameJson(bc[k], mc[k]));
    out[`field:${f.id}`] = state(top && cfg);
  }
  // approval workflows: the pack's own sheets (base settings.workflows) and the sheets it extends
  const shipped = new Map<string, Map<string, Json>>();
  const ship = (sheetId: string, w: Json) => {
    const id = idOf(w);
    if (!id) return;
    const m = shipped.get(sheetId) ?? new Map<string, Json>();
    m.set(id, w);
    shipped.set(sheetId, m);
  };
  for (const s of live.sheets) {
    if (s.pack?.installId !== base.installId) continue;
    const b = base.sheets.get(s.pack.ref);
    const flows = isObj(b?.settings) ? b!.settings.workflows : undefined;
    if (Array.isArray(flows)) for (const w of flows) ship(s.id, w);
  }
  for (const e of base.extensionWorkflows) ship(e.sheetId, e.workflow);
  for (const s of live.sheets) {
    const m = shipped.get(s.id);
    if (!m || !Array.isArray(s.workflows)) continue;
    for (const w of s.workflows) {
      const id = idOf(w);
      const b = id ? m.get(id) : undefined;
      if (id && b !== undefined) out[`workflow:${s.id}:${id}`] = state(sameJson(b, w));
    }
  }
  return out;
}
