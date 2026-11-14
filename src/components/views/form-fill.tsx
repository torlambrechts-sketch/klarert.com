'use client';

import { useId, useState } from 'react';
import { resolveFieldType } from '@/engine/fields/resolve';
import type { Ctx, Item } from '@/engine/types';
import type { FormQuestion } from '@/engine/views/form';
import { fieldUI } from '@/components/fields/registry';
import { inputClass } from '@/components/fields/shared';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// The questions of a form (docs/05 §3.3): the public form, the internal form and the builder's live preview.
// Text questions are inputs; every other type opens its own editor from the field UI registry in a popover.

export interface FormFillProps {
  questions: FormQuestion[];
  ctx: Ctx;
  nameLabel: string;
  name: string;
  onName(v: string): void;
  /** field id → raw answer (what the type's editor commits). */
  answers: Record<string, unknown>;
  onAnswer(fieldId: string, raw: unknown): void;
  errors: Record<string, string>;
  disabled?: boolean;
}

function blankItem(ctx: Ctx, values: Item['values']): Item {
  const now = ctx.now.toISOString();
  return {
    id: 'form',
    sheetId: ctx.sheet.id,
    groupId: '',
    seq: 0,
    displayId: '',
    name: '',
    values,
    position: 'a0',
    locked: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function Label({
  htmlFor,
  children,
  required,
  requiredWord,
}: {
  htmlFor?: string;
  children: React.ReactNode;
  required: boolean;
  /** Say "Required" in words after the label (the New item dialog) instead of the forms' asterisk. */
  requiredWord?: boolean;
}) {
  if (requiredWord)
    return (
      <label htmlFor={htmlFor} className="text-label-14 font-medium">
        {children}
        {required ? (
          <span className="text-muted-foreground text-label-12 ml-2 font-normal"> Required</span>
        ) : null}
      </label>
    );
  return (
    <label htmlFor={htmlFor} className="text-label-14 font-medium">
      {children}
      {required ? (
        <>
          <span aria-hidden className="text-crit">
            {' '}
            *
          </span>
          <span className="sr-only"> (required)</span>
        </>
      ) : null}
    </label>
  );
}

export function FormFill(p: FormFillProps) {
  const nameId = useId();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId} required>
          {p.nameLabel}
        </Label>
        <input
          id={nameId}
          className={cn(inputClass, 'h-9')}
          value={p.name}
          maxLength={500}
          disabled={p.disabled}
          aria-invalid={!!p.errors.__name}
          aria-describedby={p.errors.__name ? `${nameId}-error` : undefined}
          onChange={(e) => p.onName(e.target.value)}
        />
        {p.errors.__name ? (
          <p id={`${nameId}-error`} className="text-crit text-copy-13">
            {p.errors.__name}
          </p>
        ) : null}
      </div>
      {p.questions.map((q) => (
        <Question
          key={q.field.id}
          q={q}
          ctx={p.ctx}
          raw={p.answers[q.field.id]}
          answers={p.answers}
          error={p.errors[q.field.id]}
          disabled={p.disabled}
          onAnswer={(v) => p.onAnswer(q.field.id, v)}
        />
      ))}
    </div>
  );
}

export function Question({
  q,
  ctx,
  raw,
  answers,
  error,
  disabled,
  onAnswer,
  requiredWord,
}: {
  q: FormQuestion;
  ctx: Ctx;
  raw: unknown;
  answers: Record<string, unknown>;
  error?: string;
  disabled?: boolean;
  onAnswer(v: unknown): void;
  requiredWord?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const def = resolveFieldType(q.field.type)!;
  const ui = fieldUI(q.field.type);
  const describedBy =
    [q.help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined;
  const value = raw === undefined || raw === null ? null : def.normalize(raw, q.field.config, ctx);
  const values = Object.fromEntries(
    Object.entries(answers).flatMap(([k, v]) =>
      v === undefined || v === null ? [] : [[k, v as never]],
    ),
  );
  const item = blankItem(ctx, values);

  return (
    <div className="flex flex-col gap-1.5" data-question={q.field.id}>
      <Label htmlFor={id} required={q.required} requiredWord={requiredWord}>
        {q.label}
      </Label>
      {q.help ? (
        <p id={`${id}-help`} className="text-muted-foreground text-label-12 -mt-1">
          {q.help}
        </p>
      ) : null}
      {def.kind === 'text' ? (
        <input
          id={id}
          className={cn(inputClass, 'h-9')}
          value={typeof raw === 'string' ? raw : ''}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          onChange={(e) => onAnswer(e.target.value)}
        />
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              id={id}
              type="button"
              disabled={disabled}
              aria-describedby={describedBy}
              className={cn(
                inputClass,
                'flex h-auto min-h-9 items-center gap-2 py-1 text-left',
                error && 'border-crit',
              )}
            >
              {value === null || def.isEmpty(value) ? (
                <span className="text-muted-foreground">Choose or type an answer</span>
              ) : (
                <span className="flex min-w-0 flex-1 items-center">
                  <ui.Cell
                    value={value as never}
                    field={q.field}
                    item={item}
                    ctx={ctx}
                    density="list"
                  />
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="p-3"
            style={{ width: Math.min(ui.editorWidth ?? 300, 360) }}
          >
            <ui.Editor
              value={value as never}
              field={q.field}
              item={item}
              ctx={ctx}
              onCommit={(v) => {
                onAnswer(v);
                setOpen(false);
              }}
              onCancel={() => setOpen(false)}
            />
          </PopoverContent>
        </Popover>
      )}
      {error ? (
        <p id={`${id}-error`} className="text-crit text-copy-13">
          {error}
        </p>
      ) : null}
    </div>
  );
}
