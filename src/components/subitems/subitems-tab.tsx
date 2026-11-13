'use client';

import { useState } from 'react';
import { FileStack, Plus } from 'lucide-react';
import { positionAt } from '@/components/table/table-model';
import { itemStatusField } from '@/engine/fields/item-status';
import { resolveFieldType } from '@/engine/fields/resolve';
import { isSubitemDone, subitemLabel } from '@/engine/subitems';
import type { Ctx, Field, Item } from '@/engine/types';
import { kindOf } from '@/engine/values';
import { fieldUI } from '@/components/fields/registry';
import { cellValue } from '@/components/fields/shared';
import { Bar } from '@/components/fields/kit';
import { Button } from '@/components/ui/button';
import type { SubitemsHandle } from './use-subitems';

// The item panel's Sub-items tab (docs/05 §3.4): how many are done, a compact list (status, owner, due date) where a
// click opens the sub-item in the panel, "+ Add" and "From template". Empty, loading and error states included.

/** The columns the compact list shows: the status field, the first people field, the first deadline or date. */
export function listFields(fields: Field[], ctx: Ctx): Field[] {
  const status = itemStatusField(ctx, fields);
  const people = fields.find(
    (f) => resolveFieldType(f.type)?.storage === 'values' && kindOf(f, ctx) === 'people',
  );
  const date =
    fields.find((f) => resolveFieldType(f.type)?.isDeadline?.(f.config as never)) ??
    fields.find((f) => resolveFieldType(f.type)?.kind === 'date');
  return [status, people, date].filter((f): f is Field => !!f);
}

export function SubitemsTab({
  parent,
  parentSheetId,
  handle,
  canEdit,
  hasTemplate,
  onOpen,
}: {
  parent: Item;
  parentSheetId: string;
  handle: SubitemsHandle;
  canEdit: boolean;
  hasTemplate: boolean;
  onOpen(item: Item): void;
}) {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  if (handle.error)
    return (
      <div role="alert" className="border-line flex flex-col items-start gap-2 rounded-lg border p-4">
        <p className="m-0 font-semibold">The sub-items could not be loaded.</p>
        <Button type="button" variant="outline" onClick={handle.refetch}>
          Retry
        </Button>
      </div>
    );
  if (!handle.state)
    return (
      <div aria-busy="true" aria-label="Loading sub-items" className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-soft h-11 animate-pulse rounded-md" />
        ))}
      </div>
    );
  const { data, ctx, actions } = handle.state;
  const parentCtxSheet = ctx.sheetOf(parent.id) ?? { subitems: null };
  const label = subitemLabel(parentCtxSheet);
  const one = subitemLabel(parentCtxSheet, 1).toLowerCase();
  const list = data.items
    .filter((i) => i.parentId === parent.id)
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  const done = list.filter((c) => isSubitemDone(c, ctx)).length;
  const cols = listFields(data.fields, ctx);

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    setName('');
    setAdding(true);
    await actions.createSubitem(parent.id, n, positionAt(list, list.length));
    setAdding(false);
  };

  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <p className="text-label-13 m-0 shrink-0 font-medium">
          {list.length === 0
            ? `No ${label.toLowerCase()} yet.`
            : `${done} of ${list.length} done`}
        </p>
        {list.length > 0 ? (
          <span className="flex-1">
            <Bar pct={(done / list.length) * 100} color="var(--bar-good)" />
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {canEdit && hasTemplate ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void actions.subitemsFromTemplate(parentSheetId, parent.id)}
          >
            <FileStack aria-hidden /> From template
          </Button>
        ) : null}
      </div>
      {list.length > 0 ? (
        <ul className="border-line m-0 flex list-none flex-col rounded-lg border p-0" aria-label={label}>
          {list.map((c) => (
            <li
              key={c.id}
              className="border-line flex min-h-11 items-center gap-2 border-b px-2 last:border-b-0"
            >
              <button
                type="button"
                disabled={c.id.startsWith('temp-')}
                onClick={() => onOpen(c)}
                className="hover:bg-subtle focus-visible:outline-focus flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1.5 text-left focus-visible:outline-2"
              >
                <span className="text-muted-foreground text-label-12-mono shrink-0">
                  {c.displayId}
                </span>
                <span className="text-label-13 truncate">{c.name}</span>
              </button>
              {cols.map((f) => {
                const ui = fieldUI(f.type);
                return (
                  <span key={f.id} className="flex w-[96px] shrink-0 items-center overflow-hidden">
                    <span className="sr-only">{f.name}: </span>
                    <ui.Cell
                      value={cellValue(c, f, ctx) as never}
                      field={f}
                      item={c}
                      ctx={ctx}
                      density="table"
                    />
                  </span>
                );
              })}
            </li>
          ))}
        </ul>
      ) : null}
      {canEdit ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            className="border-line placeholder:text-muted-foreground text-label-13 focus-visible:outline-focus bg-background-100 h-11 min-w-0 flex-1 rounded-md border border-dashed px-3 focus-visible:outline-2"
            placeholder={`+ Add ${one}`}
            aria-label={`Add ${one} to ${parent.displayId}`}
            value={name}
            maxLength={500}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={!name.trim() || adding}>
            <Plus aria-hidden /> Add
          </Button>
        </form>
      ) : null}
    </section>
  );
}
