'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { resolveFieldType } from '@/engine/fields/resolve';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Field, Item } from '@/engine/types';
import { fieldUI } from '@/components/fields/registry';
import { CommentDialog } from './comment-dialog';
import type { SheetActions } from './use-sheet';

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
      const field = data.fields.find((f) => f.id === col);
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
    [actions, ctx, data.fields],
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

  return { commit, dialog };
}
