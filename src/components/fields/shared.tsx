'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { LabelOption } from '@/engine/fields/types';
import { resolveFieldType } from '@/engine/fields/resolve';
import type { Ctx, Field, Item } from '@/engine/types';
import { valueOf } from '@/engine/values';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// Building blocks for cells and editors: label chips and blocks (docs/05 §3.1, §6), avatars, editor frames, a text
// editor and an option list editor. Type-agnostic; each type's file composes them.

const LIGHT = new Set(['grey', 'yellow']);

export const colorVar = (color: string) => `var(--label-${color}, var(--label-grey))`;

/** Red and orange options that are not done need action: solid with "!" (docs/05 §3.1). */
export const actionNeeded = (o: LabelOption) =>
  !o.done && (o.color === 'red' || o.color === 'orange');

export function Bang() {
  return (
    <span
      aria-hidden
      className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border border-current text-[9px] leading-none font-bold"
    >
      !
    </span>
  );
}

/** Pill for List cells, cards and editors. */
export function Chip({ option, className }: { option: LabelOption; className?: string }) {
  const solid = actionNeeded(option);
  return (
    <span
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold',
        className,
      )}
      style={
        solid
          ? {
              background: colorVar(option.color),
              borderColor: colorVar(option.color),
              color: '#fff',
            }
          : {
              background: `color-mix(in srgb, ${colorVar(option.color)} 13%, white)`,
              borderColor: colorVar(option.color),
              color: 'var(--ink)',
            }
      }
    >
      {solid ? <Bang /> : null}
      {option.done ? <Check className="size-3 shrink-0" aria-hidden /> : null}
      <span className="truncate">{option.label}</span>
      {solid ? <span className="sr-only"> (needs action)</span> : null}
      {option.done ? <span className="sr-only"> (done)</span> : null}
    </span>
  );
}

/** Full-cell colour block for status cells in the Grid (docs/05 §3.2). */
export function Block({ option }: { option: LabelOption }) {
  const light = LIGHT.has(option.color);
  return (
    <span
      className="absolute inset-0 flex items-center justify-center gap-1 px-2 text-[13px] font-semibold"
      style={{ background: colorVar(option.color), color: light ? 'var(--ink)' : '#fff' }}
    >
      {actionNeeded(option) ? <Bang /> : null}
      {option.done ? <Check className="size-3.5 shrink-0" aria-hidden /> : null}
      <span className="truncate">{option.label}</span>
      {actionNeeded(option) ? <span className="sr-only"> (needs action)</span> : null}
      {option.done ? <span className="sr-only"> (done)</span> : null}
    </span>
  );
}

export function Avatar({ id, ctx, size = 24 }: { id: string; ctx: Ctx; size?: number }) {
  const p = ctx.people.get(id);
  return (
    <span
      title={p?.name ?? 'Former member'}
      className="inline-flex shrink-0 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white"
      style={{ width: size, height: size, background: colorVar(p?.color ?? 'grey') }}
    >
      <span aria-hidden>{p?.initials ?? '?'}</span>
      <span className="sr-only">{p?.name ?? 'Former member'}</span>
    </span>
  );
}

export function Avatars({ ids, ctx, max = 3 }: { ids: string[]; ctx: Ctx; max?: number }) {
  const shown = ids.slice(0, max);
  return (
    <span className="flex items-center -space-x-1.5">
      {shown.map((id) => (
        <Avatar key={id} id={id} ctx={ctx} />
      ))}
      {ids.length > max ? (
        <span className="text-muted-foreground pl-2.5 text-xs font-semibold">
          +{ids.length - max}
        </span>
      ) : null}
    </span>
  );
}

export function Text({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('block min-w-0 truncate', className)}>{children}</span>;
}

/** The type definition of a field (pure engine). */
export const defOf = (field: Field) => resolveFieldType(field.type)!;
export const displayText = (field: Field, value: unknown, ctx: Ctx) =>
  defOf(field).toText(value, field.config, ctx);

/** The frame every editor popover uses: a title for screen readers, content, and a footer. */
export function EditorFrame({
  title,
  children,
  footer,
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={title}>
      <p className="text-muted-foreground text-xs font-semibold">{title}</p>
      {children}
      {footer ? <div className="flex flex-wrap justify-end gap-2 pt-1">{footer}</div> : null}
    </div>
  );
}

export function SaveCancel({
  onSave,
  onCancel,
  onClear,
  saveLabel = 'Save',
}: {
  onSave(): void;
  onCancel(): void;
  onClear?: () => void;
  saveLabel?: string;
}) {
  return (
    <>
      {onClear ? (
        <Button type="button" size="sm" variant="ghost" className="mr-auto" onClick={onClear}>
          Clear
        </Button>
      ) : null}
      <Button type="button" size="sm" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="button" size="sm" onClick={onSave}>
        {saveLabel}
      </Button>
    </>
  );
}

export const inputClass =
  'border-input h-8 w-full rounded-md border bg-white px-2 text-sm outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30';

/**
 * One-line (or multi-line) text editor. Enter saves (Ctrl/Cmd+Enter when multi-line); an input the type cannot read
 * shows `invalid` and stays open. Empty saves as empty.
 */
export function TextEditor({
  title,
  initial,
  onCommit,
  onCancel,
  check,
  invalid = 'This value is not valid.',
  multiline = false,
  placeholder,
  inputMode,
  maxLength,
}: {
  title: string;
  initial: string;
  onCommit(v: string | null): void;
  onCancel(): void;
  /** False when the text cannot be read as a value of the type. */
  check?: (text: string) => boolean;
  invalid?: string;
  multiline?: boolean;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  maxLength?: number;
}) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const save = () => {
    const t = text.trim();
    if (!t) return onCommit(null);
    if (check && !check(t)) return setError(invalid);
    onCommit(multiline ? text : t);
  };
  const props = {
    id,
    ref,
    value: text,
    placeholder,
    maxLength,
    'aria-label': title,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-err` : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => {
      setText(e.target.value);
      setError(null);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        save();
      }
    },
  };
  return (
    <EditorFrame
      title={title}
      footer={multiline ? <SaveCancel onSave={save} onCancel={onCancel} /> : undefined}
    >
      {multiline ? (
        <textarea {...props} rows={6} className={cn(inputClass, 'h-auto py-1.5')} />
      ) : (
        <input {...props} inputMode={inputMode} className={inputClass} />
      )}
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-crit text-xs">
          {error}
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          {multiline ? 'Ctrl+Enter saves. Esc cancels.' : 'Enter saves. Esc cancels.'}
        </p>
      )}
    </EditorFrame>
  );
}

/**
 * Pick one or several options. Arrows move, Enter or Space picks; with `multiple` the choice is saved with Done or
 * Enter on the search box. A search box appears for long lists.
 */
export function OptionsEditor({
  title,
  options,
  selected,
  multiple = false,
  onCommit,
  onCancel,
  render,
  allowClear = true,
}: {
  title: string;
  options: LabelOption[];
  selected: string[];
  multiple?: boolean;
  onCommit(ids: string[]): void;
  onCancel(): void;
  render?: (o: LabelOption) => React.ReactNode;
  allowClear?: boolean;
}) {
  const [picked, setPicked] = useState<string[]>(selected);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      options.findIndex((o) => selected.includes(o.id)),
    ),
  );
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const showSearch = options.length > 8;
  const shown = useMemo(
    () =>
      query ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())) : options,
    [options, query],
  );
  useEffect(() => {
    if (showSearch) searchRef.current?.focus();
    else listRef.current?.focus();
  }, [showSearch]);

  const pick = (id: string) => {
    if (!multiple) return onCommit([id]);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(shown.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' || (e.key === ' ' && e.target === listRef.current)) {
      e.preventDefault();
      const o = shown[active];
      if (multiple && e.key === 'Enter' && e.target === searchRef.current && !query)
        return onCommit(picked);
      if (o) pick(o.id);
    }
  };
  const activeId = shown[active] ? `${listId}-${shown[active]!.id}` : undefined;
  return (
    <EditorFrame
      title={title}
      footer={
        multiple ? (
          <SaveCancel onSave={() => onCommit(picked)} onCancel={onCancel} saveLabel="Done" />
        ) : allowClear && selected.length > 0 ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => onCommit([])}>
            Clear
          </Button>
        ) : undefined
      }
    >
      {showSearch ? (
        <input
          ref={searchRef}
          className={inputClass}
          placeholder="Search"
          aria-label={`Search ${title.toLowerCase()}`}
          aria-controls={listId}
          aria-activedescendant={activeId}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
        />
      ) : null}
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={title}
        aria-multiselectable={multiple || undefined}
        aria-activedescendant={showSearch ? undefined : activeId}
        tabIndex={showSearch ? -1 : 0}
        onKeyDown={onKey}
        className="flex max-h-64 flex-col gap-0.5 overflow-auto outline-none"
      >
        {shown.length === 0 ? (
          <li className="text-muted-foreground px-2 py-1 text-sm">No matches</li>
        ) : null}
        {shown.map((o, i) => {
          const on = (multiple ? picked : selected).includes(o.id);
          return (
            <li
              key={o.id}
              id={`${listId}-${o.id}`}
              role="option"
              aria-selected={on}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o.id)}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm',
                i === active && 'bg-sel ring-focus ring-1',
              )}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {on ? <Check className="size-4" aria-hidden /> : null}
              </span>
              {render ? render(o) : <Chip option={o} />}
            </li>
          );
        })}
      </ul>
    </EditorFrame>
  );
}

/** Read-only explanation for computed and app-managed values. */
export function ExplainEditor({
  title,
  children,
  onCancel,
}: {
  title: string;
  children: React.ReactNode;
  onCancel(): void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <EditorFrame
      title={title}
      footer={
        <Button ref={ref} type="button" size="sm" variant="outline" onClick={onCancel}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-1.5 text-sm">{children}</div>
    </EditorFrame>
  );
}

/** The value a cell shows: protected values keep `undefined` for "may not see" (the cell says Restricted). */
export function cellValue(item: Item, field: Field, ctx: Ctx): unknown {
  return defOf(field).storage === 'protected'
    ? ctx.protectedValue(item.id, field.id)
    : valueOf(item, field, ctx);
}
