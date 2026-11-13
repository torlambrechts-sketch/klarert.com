// The heart of setColumnGroups (docs/02 sheets.settings.columnGroups): who may change a sheet's column groups, the
// checks on them, the field moves that keep each group's columns together and the stored settings. Kept free of
// `server-only` and of Supabase so the rules are unit-tested; the command in ./sheets.ts supplies the real
// dependencies (withOrg 'admin', the person's client). The settings write goes through sheets.update, so the
// sheets audit trigger logs it.
import type { Json } from '@/engine/types';
import {
  columnGroupsSchema,
  describeGroupsChange,
  parseColumnGroups,
  planGroupPositions,
  type ColumnGroup,
} from '@/engine/views/column-groups';
import { fail, ok, type Result } from '@/server/result';

export const ONLY_ADMINS_GROUPS = 'Only owners and admins can change column groups.';

export interface GroupField {
  id: string;
  key: string;
  position: string;
}

export interface ColumnGroupsDeps {
  role: string;
  /** The sheet's settings and live fields, or null when it is not in the workspace. */
  loadSheet(): Promise<{ settings: Record<string, Json>; fields: GroupField[] } | null>;
  saveSettings(settings: Record<string, Json>): Promise<Result<null>>;
  /** New positions for fields, so each group's columns sit together. */
  moveFields(moves: { fieldId: string; position: string }[]): Promise<Result<null>>;
}

export interface ColumnGroupsResult {
  groups: ColumnGroup[];
  /** Fields that moved to sit with their group. */
  moved: number;
  /** "Added Assess, 3 fields regrouped." or null when nothing changed. */
  summary: string | null;
}

const isAdmin = (role: string) => role === 'owner' || role === 'admin';

export async function setColumnGroupsWith(
  deps: ColumnGroupsDeps,
  input: { groups: ColumnGroup[] },
): Promise<Result<ColumnGroupsResult>> {
  // withOrg('admin') checks this first; checked again so the rule holds wherever this runs
  if (!isAdmin(deps.role)) return fail('forbidden', ONLY_ADMINS_GROUPS);
  const checked = columnGroupsSchema.safeParse(input.groups);
  if (!checked.success)
    return fail('invalid', checked.error.issues[0]?.message ?? 'Check the column groups.');
  const groups = checked.data;
  const sheet = await deps.loadSheet();
  if (!sheet) return fail('not_found', 'This sheet no longer exists.');

  const keys = new Set(sheet.fields.map((f) => f.key));
  const ids = new Set<string>();
  const names = new Set<string>();
  const taken = new Set<string>();
  for (const g of groups) {
    if (ids.has(g.id)) return fail('invalid', 'Two groups have the same id.');
    ids.add(g.id);
    const name = g.name.toLowerCase();
    if (names.has(name)) return fail('invalid', `There is already a group called ${g.name}.`);
    names.add(name);
    for (const k of g.fieldKeys) {
      if (!keys.has(k)) return fail('invalid', 'A group names a field that no longer exists.');
      if (taken.has(k)) return fail('invalid', 'A field can be in one group only.');
      taken.add(k);
    }
  }

  const before = parseColumnGroups(sheet.settings.columnGroups, keys);
  const moves = planGroupPositions(sheet.fields, groups, before);
  if (moves.length) {
    const moved = await deps.moveFields(moves);
    if (!moved.ok) return moved;
  }
  const { columnGroups: _old, ...rest } = sheet.settings;
  void _old;
  const saved = await deps.saveSettings(
    groups.length ? { ...rest, columnGroups: groups as unknown as Json } : rest,
  );
  if (!saved.ok) return saved;
  return ok({ groups, moved: moves.length, summary: describeGroupsChange(before, groups) });
}
