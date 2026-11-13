// Adopting a framework (docs/12): the library pack's install plan, plus — when the workspace names a controls sheet
// — a "Controls" link field on the library sheet that points at it and mirrors the controls sheet's requirement field
// (config.inverseFieldId), so a link made on either side shows on both. Everything else is the pack planner's.
// Pure: the plan and the choice in, the plan out.
import { fieldType } from '../fields/registry';
import { keyBetween } from '../ordering';
import type { PackPlan } from '../packs/plan';
import type { Field, Json, Sheet } from '../types';
import { LIBRARY_KEYS } from './pack';

/** A sheet that can hold the workspace's controls: it has a requirement field that links to any library. */
export interface ControlsSheet {
  sheetId: string;
  sheetName: string;
  /** The requirement field (targetSheetId null: any library sheet) the library's Controls field mirrors. */
  fieldId: string;
  fieldName: string;
}

/**
 * Sheets whose items can cover requirements of several frameworks: not a library, not a sub-item sheet, with a
 * requirement or control link field that links to any library (no single target sheet).
 */
export function controlsSheets(
  sheets: readonly Pick<Sheet, 'id' | 'name' | 'isLibrary' | 'parentSheetId'>[],
  fields: readonly Pick<Field, 'id' | 'sheetId' | 'name' | 'type' | 'config' | 'position'>[],
): ControlsSheet[] {
  return sheets
    .filter((s) => !s.isLibrary && !s.parentSheetId)
    .flatMap((s) => {
      const f = fields
        .filter(
          (x) =>
            x.sheetId === s.id &&
            (x.type === 'requirement' || x.type === 'controllink') &&
            !(x.config as { targetSheetId?: string | null }).targetSheetId,
        )
        .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))[0];
      return f ? [{ sheetId: s.id, sheetName: s.name, fieldId: f.id, fieldName: f.name }] : [];
    });
}

/** The plan with the library's Controls field, two-way with the controls sheet's requirement field. */
export function withControlsLink(
  plan: PackPlan,
  controls: ControlsSheet | null,
  newId: () => string,
): PackPlan {
  if (!controls || !plan.payload) return plan;
  const sheet = plan.payload.sheets.find((s) => s.is_library === true && !s.parent_sheet_id);
  if (!sheet) return plan;
  const sheetId = String(sheet.id);
  const own = plan.payload.fields.filter((f) => f.sheet_id === sheetId);
  if (own.some((f) => f.key === LIBRARY_KEYS.controls)) return plan;
  const last = own
    .map((f) => String(f.position))
    .sort()
    .at(-1);
  const sheetRef = String(sheet.ref);
  const ref = `${sheetRef}.${LIBRARY_KEYS.controls}`;
  const field: Record<string, Json> = {
    id: newId(),
    ref,
    sheet_id: sheetId,
    key: LIBRARY_KEYS.controls,
    name: 'Controls',
    type: 'link',
    position: keyBetween(last ?? null, null),
    width: fieldType('link')?.defaultWidth ?? 180,
    required: false,
    locked: false,
    description: `Controls from ${controls.sheetName} that cover this requirement. Linked both ways with ${controls.fieldName}.`,
    config: { targetSheetId: controls.sheetId, multiple: true, inverseFieldId: controls.fieldId },
    rules: [],
    visibility: null,
  };
  const sheetName = String(sheet.name);
  return {
    ...plan,
    operations: [
      ...plan.operations,
      { kind: 'field', ref, name: `${sheetName} › Controls`, action: 'create' },
    ],
    preview: {
      ...plan.preview,
      counts: { ...plan.preview.counts, fields: plan.preview.counts.fields + 1 },
      sheets: plan.preview.sheets.map((s) =>
        s.ref === sheetRef ? { ...s, fields: s.fields + 1 } : s,
      ),
      links: [
        ...plan.preview.links,
        { from: sheetName, field: 'Controls', to: controls.sheetName, twoWay: true },
      ],
    },
    payload: { ...plan.payload, fields: [...plan.payload.fields, field] },
  };
}
