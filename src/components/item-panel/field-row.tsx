'use client';

import { hiddenFor } from '@/engine/values';
import { useId, useState } from 'react';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import type { Ctx, Field, Item } from '@/engine/types';
import { fieldUI } from '@/components/fields/registry';
import { cellValue, defOf, displayText, editorPopoverClass } from '@/components/fields/shared';
import type { EditorProps } from '@/components/fields/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * One label/value pair of "All fields" (docs/05 §3.4): the type's Cell, and on click the type's Editor in a popover,
 * exactly as in the Grid. Computed values open their explanation; read-only values are plain text.
 */
export function FieldRow({
  item,
  field,
  ctx,
  editable,
  readOnlyReason,
  onCommit,
  onButton,
  fieldProps,
  children,
}: {
  item: Item;
  field: Field;
  ctx: Ctx;
  /** The person may change this item's values. */
  editable: boolean;
  readOnlyReason: string;
  onCommit(item: Item, fieldId: string, raw: unknown): Promise<void> | void;
  onButton?(): void;
  /** "Add …" and "Edit options" in the editor; `close` closes the popover first. */
  fieldProps?(close: () => void): Pick<EditorProps, 'onAddOption' | 'onEditField'>;
  /** Replaces the value (file fields render their own manager). */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const descId = useId();
  const ui = fieldUI(field.type);
  const def = defOf(field);
  const value = cellValue(item, field, ctx);
  const explainOnly = def.storage === 'computed' || def.storage === 'none';
  const canOpen = explainOnly || editable;
  // a restricted field the person may not see (docs/02 §16): its cell says Restricted, never Empty
  const hidden = hiddenFor(field, ctx);
  const text = hidden ? 'Restricted' : displayText(field, value, ctx);
  // protected values the person may not see are undefined: the cell says Restricted
  const empty = !hidden && value !== undefined && def.isEmpty(value as never);
  const missing = field.required && def.storage === 'values' && empty;

  const commit = (fieldId: string, raw: unknown) => {
    setOpen(false);
    void onCommit(item, fieldId, raw);
  };

  return (
    <div className="contents">
      <dt id={labelId} className="text-muted-foreground text-13 flex min-w-0 flex-col pt-1.5">
        <span className="flex items-center gap-1">
          <span className="truncate">{field.name}</span>
          {field.required ? (
            <span className="text-crit">
              <span aria-hidden>*</span>
              <span className="sr-only">required</span>
            </span>
          ) : null}
          {field.locked ? (
            <span title="Kept by the app. You can hide it, not delete it.">
              <Lock className="size-3" aria-hidden />
              <span className="sr-only">Kept by the app</span>
            </span>
          ) : null}
        </span>
        {field.description ? (
          <span id={descId} className="text-muted-foreground/90 text-12">
            {field.description}
          </span>
        ) : null}
      </dt>
      <dd className="m-0 min-w-0">
        {children ? (
          children
        ) : ui.toggle && editable ? (
          <button
            type="button"
            aria-labelledby={labelId}
            aria-describedby={field.description ? descId : undefined}
            className="hover:bg-soft focus-visible:outline-focus text-13 flex min-h-8 w-full items-center rounded-md px-1.5 text-left focus-visible:outline-2"
            onClick={() => commit(field.id, ui.toggle!(value as never))}
          >
            <ui.Cell value={value as never} field={field} item={item} ctx={ctx} density="list" />
          </button>
        ) : canOpen ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`${explainOnly ? 'About' : 'Edit'} ${field.name}${text ? `: ${text}` : ''}`}
                aria-describedby={field.description ? descId : undefined}
                className={cn(
                  'hover:bg-soft focus-visible:outline-focus text-13 flex min-h-8 w-full items-center rounded-md px-1.5 text-left focus-visible:outline-2',
                  missing && 'outline-crit/60 outline-1 -outline-offset-1',
                )}
              >
                <span className="min-w-0 flex-1">
                  {empty && !explainOnly ? (
                    <span className="text-muted-foreground">{missing ? 'Required' : 'Empty'}</span>
                  ) : (
                    <ui.Cell
                      value={value as never}
                      field={field}
                      item={item}
                      ctx={ctx}
                      density="list"
                    />
                  )}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className={editorPopoverClass}
              style={{ width: Math.min(ui.editorWidth ?? 300, 420) }}
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <ui.Editor
                value={value as never}
                field={field}
                item={item}
                ctx={ctx}
                onCommit={(v) => commit(field.id, v)}
                onCancel={() => setOpen(false)}
                onCommitField={editable ? (fid, v) => commit(fid, v) : undefined}
                onButton={
                  editable && onButton
                    ? () => {
                        setOpen(false);
                        onButton();
                      }
                    : undefined
                }
                {...(open && editable ? fieldProps?.(() => setOpen(false)) : undefined)}
              />
            </PopoverContent>
          </Popover>
        ) : (
          <button
            type="button"
            aria-label={`${field.name}${text ? `: ${text}` : ''}`}
            className="text-13 flex min-h-8 w-full cursor-default items-center rounded-md px-1.5 text-left"
            onClick={() => toast(readOnlyReason)}
          >
            <span className="min-w-0 flex-1">
              {empty ? (
                <span className="text-muted-foreground">Empty</span>
              ) : (
                <ui.Cell
                  value={value as never}
                  field={field}
                  item={item}
                  ctx={ctx}
                  density="list"
                />
              )}
            </span>
          </button>
        )}
      </dd>
    </div>
  );
}
