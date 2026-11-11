import 'server-only';
import { keyBetween, keysBetween } from '@/engine/ordering';
import {
  LABEL_COLORS,
  createGroupInput,
  deleteGroupInput,
  moveGroupInput,
  updateGroupInput,
} from '@/lib/schemas/sheets';
import type { ServerClient } from '@/lib/supabase/server';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { withOrg } from './context';

// Groups (docs/01 FR-8): add, rename, recolour, reorder, delete. Editors (RLS groups_write); schema triggers log them.

async function groupsOf(db: ServerClient, sheetId: string) {
  const { data } = await db
    .from('groups')
    .select('id, sheet_id, name, color, position')
    .eq('sheet_id', sheetId)
    .order('position');
  return data ?? [];
}

async function groupInOrg(db: ServerClient, orgId: string, groupId: string) {
  const { data } = await db
    .from('groups')
    .select('id, sheet_id, name')
    .eq('id', groupId)
    .eq('org_id', orgId)
    .maybeSingle();
  return data;
}

export async function createGroup(input: unknown): Promise<Result<{ id: string }>> {
  const p = createGroupInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'editor',
    async ({ supabase, orgId }) => {
      const { data: sheet } = await supabase
        .from('sheets')
        .select('id')
        .eq('id', p.data.sheetId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (!sheet) return fail('not_found', 'Sheet not found.');
      const existing = await groupsOf(supabase, sheet.id);
      const color = p.data.color ?? LABEL_COLORS[existing.length % LABEL_COLORS.length]!;
      const { data, error } = await supabase
        .from('groups')
        .insert({
          org_id: orgId,
          sheet_id: sheet.id,
          name: p.data.name,
          color,
          position: keyBetween(existing.at(-1)?.position ?? null, null),
        })
        .select('id')
        .single();
      return error ? fromDbError(error) : ok({ id: data.id });
    },
    'createGroup',
  );
}

/** Rename and/or recolour. */
export async function updateGroup(input: unknown): Promise<Result<null>> {
  const p = updateGroupInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { name, color } = p.data;
  if (name === undefined && color === undefined) return ok(null);
  return withOrg(
    p.data.org,
    'editor',
    async ({ supabase, orgId }) => {
      const { data, error } = await supabase
        .from('groups')
        .update({ ...(name !== undefined ? { name } : {}), ...(color ? { color } : {}) })
        .eq('id', p.data.groupId)
        .eq('org_id', orgId)
        .select('id');
      if (error) return fromDbError(error);
      return data.length ? ok(null) : fail('not_found', 'Group not found.');
    },
    'updateGroup',
  );
}

/** Move a group to a new index among its sheet's groups; only that group's position changes. */
export async function moveGroup(input: unknown): Promise<Result<null>> {
  const p = moveGroupInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'editor',
    async ({ supabase, orgId }) => {
      const group = await groupInOrg(supabase, orgId, p.data.groupId);
      if (!group) return fail('not_found', 'Group not found.');
      const others = (await groupsOf(supabase, group.sheet_id)).filter((g) => g.id !== group.id);
      const at = Math.min(p.data.toIndex, others.length);
      const position = keyBetween(others[at - 1]?.position ?? null, others[at]?.position ?? null);
      const { error } = await supabase.from('groups').update({ position }).eq('id', group.id);
      return error ? fromDbError(error) : ok(null);
    },
    'moveGroup',
  );
}

/** Delete an empty group, or move its items to `moveTo` first (delete_group: one transaction, moves logged). */
export async function deleteGroup(input: unknown): Promise<Result<{ moved: number }>> {
  const p = deleteGroupInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'editor',
    async ({ supabase, orgId }) => {
      const group = await groupInOrg(supabase, orgId, p.data.groupId);
      if (!group) return fail('not_found', 'Group not found.');
      const all = await groupsOf(supabase, group.sheet_id);
      if (all.length <= 1) return fail('conflict', 'A sheet needs at least one group.');
      const { data: items, error: itemsError } = await supabase
        .from('items')
        .select('id, position')
        .eq('group_id', group.id)
        .order('position');
      if (itemsError) return fromDbError(itemsError);
      const positions: Record<string, string> = {};
      if (items.length > 0) {
        if (!p.data.moveTo)
          return fail('conflict', 'This group has items. Choose a group to move them to first.', {
            moveTo: 'Choose a group to move the items to.',
          });
        if (!all.some((g) => g.id === p.data.moveTo && g.id !== group.id))
          return fail('invalid', 'Choose another group of this sheet.', {
            moveTo: 'Choose another group of this sheet.',
          });
        const { data: last } = await supabase
          .from('items')
          .select('position')
          .eq('group_id', p.data.moveTo)
          .order('position', { ascending: false })
          .limit(1);
        const keys = keysBetween(last?.[0]?.position ?? null, null, items.length);
        items.forEach((it, i) => (positions[it.id] = keys[i]!));
      }
      const { data, error } = await supabase.rpc('delete_group', {
        p_group: group.id,
        p_target: items.length > 0 ? p.data.moveTo! : undefined,
        p_positions: positions,
      });
      return error ? fromDbError(error) : ok({ moved: data });
    },
    'deleteGroup',
  );
}
