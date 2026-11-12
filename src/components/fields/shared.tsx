'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, Plus, Search, Settings2 } from 'lucide-react';
import type { LabelOption } from '@/engine/fields/types';
import { resolveFieldType } from '@/engine/fields/resolve';
import type { Ctx, Field, Item } from '@/engine/types';
import { valueOf } from '@/engine/values';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { searchOptions } from './option-search';

// Building blocks for cells and editors: label chips and blocks (docs/05 §3.1, §6), avatars, editor frames, a text
// editor and an option list editor. Type-agnostic; each type's file composes them.

const LIGHT = new Set(['grey', 'yellow']);

export const colorVar = (color: string) => `var(--label-${color}, var(--label-grey))`;
/** A label colour as a fill behind white text: darker where the label colour is short of 4.5:1. */
export const solidVar = (color: string) => `var(--solid-${color}, ${colorVar(color)})`;

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
              background: solidVar(option.color),
              borderColor: solidVar(option.color),
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
      style={{
        background: light ? colorVar(option.color) : solidVar(option.color),
        color: light ? 'var(--ink)' : '#fff',
      }}
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
      style={{ width: size, height: size, background: solidVar(p?.color ?? 'dark') }}
    >
      {/* initials as generated content: decoration only, so the name read out (and matched by "label in name")
          is the person's name */}
      <span
        aria-hidden
        data-initials={p?.initials ?? '?'}
        className="before:content-[attr(data-initials)]"
      />
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
 * The popover every cell editor opens in (Grid, List, item panel): white, rounded, a soft shadow. Editors that draw
 * edge to edge (the option picker) mark themselves `data-flush` and the padding goes.
 */
export const editorPopoverClass =
  'rounded-[10px] border-line p-3 shadow-[0_10px_28px_rgb(20_20_20/0.12),0_2px_6px_rgb(20_20_20/0.06)] has-[[data-flush]]:p-0';

/** Quiet text action for the picker footer. */
function FooterAction({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick(): void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'text-muted-foreground hover:text-ink focus-visible:outline-focus inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-semibold focus-visible:outline-2',
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Pick one or several options: a search field on top (focused on open), the list, and a slim footer. Arrows move,
 * Enter picks (with `multiple` it toggles; Ctrl/Cmd+Enter or Done saves); Space picks while nothing is typed; Esc
 * closes. With `onAdd`, a search no option has exactly ends the list with "Add “text”", which adds the option and
 * picks it. `onEditOptions` puts "Edit options" in the footer.
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
  onAdd,
  onEditOptions,
}: {
  title: string;
  options: LabelOption[];
  selected: string[];
  multiple?: boolean;
  onCommit(ids: string[]): void;
  onCancel(): void;
  render?: (o: LabelOption) => React.ReactNode;
  allowClear?: boolean;
  /** Add a typed option to the field; resolves to it, or null when it could not be added. */
  onAdd?: (label: string) => Promise<LabelOption | null>;
  onEditOptions?: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(selected);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      options.findIndex((o) => selected.includes(o.id)),
    ),
  );
  const listId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const { shown, add } = useMemo(
    () => searchOptions(options, query, !!onAdd),
    [options, query, onAdd],
  );
  const rows = shown.length + (add ? 1 : 0);
  const at = Math.min(active, rows - 1);
  useEffect(() => {
    searchRef.current?.focus();
    // again after the popover's own focus handling (inside a modal, e.g. the item panel, it mounts after this)
    const raf = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);
  // keep the active row in view while moving with the keyboard
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  const pick = (id: string) => {
    if (!multiple) return onCommit([id]);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  const addTyped = async () => {
    if (!onAdd || !add || adding) return;
    setAdding(true);
    const o = await onAdd(add);
    setAdding(false);
    if (!o) return;
    if (!multiple) return onCommit([o.id]);
    setPicked((p) => (p.includes(o.id) ? p : [...p, o.id]));
    setQuery('');
    setActive(options.length);
  };
  const choose = (i: number) => {
    if (i < shown.length) pick(shown[i]!.id);
    else if (add) void addTyped();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(rows - 1, at + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(0, at - 1));
    } else if (e.key === 'Home' && !query) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && !query) {
      e.preventDefault();
      setActive(rows - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (multiple && (e.metaKey || e.ctrlKey)) return onCommit(picked);
      if (rows > 0) choose(at);
    } else if (e.key === ' ' && !query) {
      // nothing typed yet: Space picks, as in a listbox
      e.preventDefault();
      if (rows > 0) choose(at);
    }
  };
  const rowId = (i: number) =>
    i < shown.length ? `${listId}-${shown[i]!.id}` : add ? `${listId}-add` : undefined;
  const current = multiple ? picked : selected;
  const canClear = allowClear && current.length > 0;
  const rowClass = (on: boolean) =>
    cn(
      'flex min-h-9 cursor-pointer items-center gap-2.5 py-1.5 pr-3 pl-4 text-sm select-none',
      // active row (mouse or keyboard): soft fill and a focus-coloured bar on the left (>= 3:1 against white)
      on && 'bg-sel shadow-[inset_3px_0_0_var(--focus)]',
    );

  return (
    <div
      data-flush
      role="group"
      aria-label={title}
      className="flex min-w-0 flex-col bg-white text-sm"
    >
      <div className="p-2">
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            aria-hidden
          />
          <input
            ref={searchRef}
            role="combobox"
            aria-expanded
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={rows > 0 ? rowId(at) : undefined}
            aria-label={`Search ${title.toLowerCase()}`}
            placeholder="Search"
            autoComplete="off"
            spellCheck={false}
            maxLength={120}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            className="border-line focus-visible:border-focus focus-visible:ring-focus/25 placeholder:text-muted-foreground h-9 w-full rounded-md border bg-white pr-2 pl-8 text-sm outline-none focus-visible:ring-2"
          />
        </div>
      </div>
      <div className="border-line border-t" />
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={title}
        aria-multiselectable={multiple || undefined}
        aria-busy={adding || undefined}
        className="max-h-64 overflow-y-auto py-1 outline-none"
      >
        {shown.map((o, i) => {
          const on = current.includes(o.id);
          return (
            <li
              key={o.id}
              id={`${listId}-${o.id}`}
              role="option"
              aria-selected={on}
              data-active={i === at}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o.id)}
              onMouseMove={() => i !== at && setActive(i)}
              className={rowClass(i === at)}
            >
              <span className="flex min-w-0 flex-1 items-center">
                {render ? render(o) : <Chip option={o} />}
              </span>
              <span className="flex size-4 shrink-0 items-center justify-center">
                {on ? <Check className="text-ink size-4" aria-hidden /> : null}
              </span>
            </li>
          );
        })}
        {add ? (
          <li
            id={`${listId}-add`}
            role="option"
            aria-selected={false}
            aria-disabled={adding || undefined}
            data-active={at === shown.length}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void addTyped()}
            onMouseMove={() => at !== shown.length && setActive(shown.length)}
            className={cn(rowClass(at === shown.length), 'text-ink font-semibold')}
          >
            <Plus className="text-muted-foreground size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {adding ? `Adding “${add}”…` : `Add “${add}”`}
            </span>
          </li>
        ) : null}
      </ul>
      {shown.length === 0 ? (
        <p role="status" className="text-muted-foreground px-4 pt-0.5 pb-2 text-sm">
          No matches
        </p>
      ) : null}
      {multiple || canClear || onEditOptions ? (
        <div className="border-line flex min-h-10 items-center gap-1 border-t px-2 py-1">
          {onEditOptions ? (
            <FooterAction onClick={onEditOptions}>
              <Settings2 className="size-3.5" aria-hidden /> Edit options
            </FooterAction>
          ) : null}
          <span className="flex-1" />
          {canClear ? <FooterAction onClick={() => onCommit([])}>Clear</FooterAction> : null}
          {multiple ? (
            <>
              <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={() => onCommit(picked)}>
                Done
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
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
