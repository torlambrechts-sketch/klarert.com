'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { resolveFieldType } from '@/engine/fields/resolve';
import type { SheetData } from '@/engine/sheet-data';
import type { LabelOption } from '@/engine/fields/types';
import type { Ctx, Field, Item } from '@/engine/types';
import { fieldUI } from '@/components/fields/registry';
import type { EditorProps } from '@/components/fields/types';
import { CommentDialog } from './comment-dialog';
import { useGridStore } from './grid-store';
import type { SheetActions } from './use-sheet';

/** Who may change a field's settings and options: editors on unlocked fields, admins always (fields RLS). */
export const mayEditField = (field: Field, p: { canEdit: boolean; isAdmin: boolean }) =>
  p.canEdit && (!field.locked || p.isAdmin);

/**
 * Saving one value from an editor, shared by the Grid and the item panel: the name, link fields (setLinks) and stored
 * values (setCell) with the status-rule comment box (docs/03 §6) and the "Keep mine / Use theirs" conflict choice
 * (docs/02 §5). Render `dialog` once next to the editors.
 */
export function useValueCommit(data: SheetData, ctx: Ctx, actions: SheetActions) {
  const [comment, setComment] = useState<{
    item: Item;
    field: Field;
    value: unknown;
    message: string;
  } | null>(null);

  const commit = useCallback(
    async (item: Item, col: string, raw: unknown, note?: string) => {
      if (col === 'name') {
        const name = typeof raw === 'string' ? raw.trim() : '';
        if (!name) return void toast.error('A name is required.');
        if (name !== item.name) await actions.setCell(item, { name });
        return;
      }
      // the cache, not this render: an option added a moment ago is already in the field's config there
      const field = (actions.current() ?? data).fields.find((f) => f.id === col);
      if (!field) return;
      const def = resolveFieldType(field.type)!;
      if (def.storage === 'links')
        return void (await actions.setLinks(
          item,
          field,
          Array.isArray(raw) ? (raw as string[]) : [],
        ));
      if (def.storage !== 'values' && def.storage !== 'protected') return;
      const value =
        raw === null || raw === undefined ? null : def.normalize(raw, field.config, ctx);
      if (raw !== null && raw !== undefined && value === null)
        return void toast.error(`This is not a valid ${field.name.toLowerCase()}.`);
      if (
        def.storage === 'values' &&
        JSON.stringify(item.values[field.id] ?? null) === JSON.stringify(value)
      )
        return;
      const r = await actions.setCell(item, {
        fieldId: field.id,
        value,
        note,
        expectedUpdatedAt: fieldUI(field.type).conflictCheck ? item.updatedAt : undefined,
      });
      if (r.ok) return;
      if (r.error.code === 'comment_required')
        setComment({ item, field, value, message: r.error.message });
      if (r.error.code === 'conflict')
        toast(r.error.message, {
          duration: 10000,
          action: {
            label: 'Keep mine',
            onClick: () => void actions.setCell(item, { fieldId: field.id, value }),
          },
          cancel: { label: 'Use theirs', onClick: () => void actions.refresh() },
        });
    },
    [actions, ctx, data],
  );

  const store = useGridStore();
  const addOption = useCallback(
    async (field: Field, label: string): Promise<LabelOption | null> =>
      (await actions.addFieldOption(field, label))?.option ?? null,
    [actions],
  );

  /**
   * The editor props that change the field itself: "Add …" in option pickers (types with addOption) and "Edit
   * options", for people who may edit the field. `close` closes the editor before the field settings open.
   */
  const fieldProps = useCallback(
    (
      field: Field,
      p: { canEdit: boolean; isAdmin: boolean },
      close: () => void,
    ): Pick<EditorProps, 'onAddOption' | 'onEditField'> => {
      if (!mayEditField(field, p)) return {};
      return {
        onAddOption: resolveFieldType(field.type)?.addOption
          ? (label) => addOption(field, label)
          : undefined,
        onEditField: () => {
          close();
          store.getState().openSettings(field.id);
        },
      };
    },
    [addOption, store],
  );

  const dialog = (
    <CommentDialog
      open={!!comment}
      message={comment?.message ?? ''}
      onCancel={() => setComment(null)}
      onSubmit={async (note) => {
        if (!comment) return;
        const { item, field, value } = comment;
        setComment(null);
        const r = await actions.setCell(item, { fieldId: field.id, value, note });
        if (r.ok) toast('Saved with your comment.');
      }}
    />
  );

  return { commit, dialog, fieldProps };
}
