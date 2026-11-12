'use client';

import { useState } from 'react';
import { becomesKey, isToken, keyLabel, setValueText, valueTokens } from '@/engine/automations';
import type { Ctx, Field, Item, Json } from '@/engine/types';
import { fieldUI } from '@/components/fields/registry';
import { defOf, inputClass } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// A value for a field, picked with the field type's own editor from the UI registry (docs/04 §10): status shows its
// options, dates a date picker, people the people list. set_field values also offer the tokens Today, In N days,
// the person who made the change and Empty. field_becomes stores the option key the editor picked.

/** The item the editors edit: an empty one, so they start blank and nothing real is touched. */
function blankItem(field: Field): Item {
  return {
    id: 'automation-builder',
    sheetId: field.sheetId,
    groupId: '',
    seq: 0,
    displayId: '',
    name: '',
    values: {},
    position: 'a0',
    locked: false,
    createdAt: '',
    updatedAt: '',
  };
}

export function ValuePicker({
  field,
  ctx,
  value,
  onChange,
  label,
  mode = 'set',
  invalid,
}: {
  field: Field;
  ctx: Ctx;
  value: Json | undefined;
  onChange(v: Json): void;
  /** Accessible name of the button ("Trigger value", "Action 1 value"). */
  label: string;
  /** set: a raw value or token for set_field; key: the option key a field_becomes trigger compares. */
  mode?: 'set' | 'key';
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(() => {
    const m = typeof value === 'string' ? value.match(/^\$in:(-?\d+)$/) : null;
    return m ? Number(m[1]) : 7;
  });
  const ui = fieldUI(field.type);
  const def = defOf(field);
  const tokens = mode === 'set' ? valueTokens(field, ctx) : [];
  const empty = value === undefined || value === null || value === '';
  const text = empty
    ? ''
    : mode === 'key'
      ? keyLabel(field, String(value), ctx)
      : setValueText(field, value, ctx);
  // the editor starts from the current literal (tokens and keys are not values of the field)
  const current =
    empty || (mode === 'set' && isToken(value)) ? null : def.normalize(value, field.config, ctx);
  const pick = (v: Json) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${text || 'Choose a value'}`}
          className={cn(
            inputClass,
            'flex w-auto max-w-full min-w-28 items-center text-left',
            empty && 'text-muted-foreground',
            invalid && 'border-crit',
          )}
        >
          <span className="truncate">{text || 'Choose a value'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex flex-col gap-3 p-3"
        style={{ width: Math.min(ui.editorWidth ?? 300, 420) }}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {tokens.length ? (
          <div className="flex flex-col gap-1.5" role="group" aria-label="Values that change">
            {tokens.map((t) =>
              t.id.startsWith('$in:') ? (
                <div key={t.id} className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => pick(`$in:${days}`)}
                  >
                    In
                  </Button>
                  <input
                    type="number"
                    min={0}
                    max={3650}
                    aria-label="Number of days from the change"
                    className={cn(inputClass, 'w-20')}
                    value={days}
                    onChange={(e) =>
                      setDays(Math.max(0, Math.min(3650, Number(e.target.value) || 0)))
                    }
                  />
                  <span className="text-sm">days</span>
                </div>
              ) : (
                <Button
                  key={t.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="justify-start"
                  onClick={() => pick(t.id)}
                >
                  {t.label}
                </Button>
              ),
            )}
          </div>
        ) : null}
        <ui.Editor
          value={current as never}
          field={field}
          item={blankItem(field)}
          ctx={ctx}
          onCommit={(raw) => {
            if (mode === 'key') {
              const k = becomesKey(field, raw, ctx, value);
              if (k) pick(k);
              else setOpen(false);
              return;
            }
            if (raw === null || raw === undefined) return pick('$empty');
            const v = def.normalize(raw, field.config, ctx);
            pick((v ?? raw) as Json);
          }}
          onCancel={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
