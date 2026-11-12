'use client';

import { useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { LabelOption } from '@/engine/fields/types';
import type { Ctx, Field } from '@/engine/types';
import { cn } from '@/lib/utils';
import {
  Block,
  Chip,
  defOf,
  displayText,
  ExplainEditor,
  OptionsEditor,
  Text,
  TextEditor,
} from './shared';
import type { CellProps, EditorProps, FieldTypeUI } from './types';

// Factories for the common shapes of field UI: free text that the type parses, one or several options, and
// read-only values the app computes. Type files use these and override what differs.

export function Empty() {
  return <span className="sr-only">Empty</span>;
}

export function TextCell({ value, field, ctx, className }: CellProps & { className?: string }) {
  const t = displayText(field, value, ctx);
  return t ? <Text className={className}>{t}</Text> : <Empty />;
}

/** A type edited as text and read back with its parseText. */
export function textUI(spec: {
  icon: LucideIcon;
  /** Text shown in the editor for a stored value (default: the display text). */
  toInput?: (v: unknown, field: Field, ctx: Ctx) => string;
  multiline?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  invalid?: string;
  placeholder?: string;
  align?: 'right';
  Cell?: React.FC<CellProps>;
  maxLength?: number;
}): FieldTypeUI {
  return {
    icon: spec.icon,
    Cell:
      spec.Cell ??
      ((p) => (
        <TextCell
          {...p}
          className={spec.align === 'right' ? 'text-right tabular-nums' : undefined}
        />
      )),
    Editor: ({ value, field, ctx, onCommit, onCancel }: EditorProps) => {
      const def = defOf(field);
      const initial =
        value === null || value === undefined
          ? ''
          : spec.toInput
            ? spec.toInput(value, field, ctx)
            : def.toText(value, field.config, ctx);
      return (
        <TextEditor
          title={field.name}
          initial={initial}
          multiline={spec.multiline}
          inputMode={spec.inputMode}
          placeholder={spec.placeholder}
          maxLength={spec.maxLength}
          invalid={spec.invalid}
          check={(t) => def.parseText(t, field.config, ctx) !== null}
          onCommit={(t) => onCommit(t === null ? null : def.parseText(t, field.config, ctx))}
          onCancel={onCancel}
        />
      );
    },
  };
}

/** The option keys a stored value selects. */
export function selectedKeys(field: Field, value: unknown): string[] {
  const def = defOf(field);
  if (value === null || value === undefined) return [];
  if (def.keyOf) {
    const k = def.keyOf(value, field.config);
    return k === null ? [] : [k];
  }
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === 'string');
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return [String(value)];
  return [];
}

export const optionsOf = (field: Field, ctx: Ctx): LabelOption[] =>
  defOf(field).options?.(field.config, ctx) ?? [];

/** The raw input for one option: its id when the type reads ids, else its label. */
export function optionInput(field: Field, ctx: Ctx, o: LabelOption): unknown {
  const def = defOf(field);
  return def.normalize(o.id, field.config, ctx) !== null ? o.id : o.label;
}

/**
 * An option cell: one option fills the cell as a rounded block (List and Grid alike); several (multi-select) are
 * compact chips side by side.
 */
export function OptionCell({ value, field, ctx, density }: CellProps) {
  const opts = optionsOf(field, ctx);
  const keys = selectedKeys(field, value);
  const chosen = keys.map((k) => opts.find((o) => o.id === k)).filter((o): o is LabelOption => !!o);
  if (chosen.length === 0) return <Empty />;
  if (!Array.isArray(value)) return <Block option={chosen[0]!} density={density} />;
  const shown = chosen.slice(0, 3);
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden">
      {shown.map((o) => (
        <Chip key={o.id} option={o} className="shrink-0" />
      ))}
      {chosen.length > 3 ? (
        <span className="text-muted-foreground text-meta font-semibold">+{chosen.length - 3}</span>
      ) : null}
    </span>
  );
}

/** The picker of an option type, with "Add …" and "Edit options" when the host passes them. */
function OptionPicker({
  value,
  field,
  ctx,
  onCommit,
  onCancel,
  onAddOption,
  onEditField,
  multiple,
  render,
}: EditorProps & { multiple: boolean; render?: (o: LabelOption) => React.ReactNode }) {
  // options added here are in the field's config by the time they are picked, but maybe not in this render's props
  const added = useRef<LabelOption[]>([]);
  const opts = optionsOf(field, ctx);
  const find = (id: string) =>
    opts.find((o) => o.id === id) ?? added.current.find((o) => o.id === id);
  return (
    <OptionsEditor
      variant={multiple ? 'list' : 'blocks'}
      title={field.name}
      options={opts}
      selected={selectedKeys(field, value)}
      multiple={multiple}
      render={render}
      onCancel={onCancel}
      onAdd={
        onAddOption
          ? async (label) => {
              const o = await onAddOption(label);
              if (o) added.current = [...added.current, o];
              return o;
            }
          : undefined
      }
      onEditOptions={onEditField}
      onCommit={(ids) => {
        const chosen = ids.map(find).filter((o): o is LabelOption => !!o);
        if (chosen.length === 0) return onCommit(null);
        const fresh = added.current.some((o) => o.id === chosen[0]!.id);
        onCommit(
          multiple
            ? chosen.map((o) => o.id)
            : // a new option is read by its label: this render's config may not have its id yet
              fresh
              ? chosen[0]!.label
              : optionInput(field, ctx, chosen[0]!),
        );
      }}
    />
  );
}

/** A type picked from its options (status, dropdown, role, team …). */
export function optionUI(spec: {
  icon: LucideIcon;
  multiple?: boolean | ((field: Field) => boolean);
  render?: (o: LabelOption) => React.ReactNode;
}): FieldTypeUI {
  return {
    icon: spec.icon,
    Cell: (p) => <OptionCell {...p} />,
    Editor: (p) => (
      <OptionPicker
        {...p}
        multiple={typeof spec.multiple === 'function' ? spec.multiple(p.field) : !!spec.multiple}
        render={spec.render}
      />
    ),
  };
}

/** A value the app computes or manages: the cell shows it, the editor explains it. */
export function computedUI(spec: {
  icon: LucideIcon;
  explain: (p: EditorProps) => React.ReactNode;
  Cell?: React.FC<CellProps>;
}): FieldTypeUI {
  return {
    icon: spec.icon,
    Cell: spec.Cell ?? ((p) => <TextCell {...p} />),
    Editor: (p) => (
      <ExplainEditor title={p.field.name} onCancel={p.onCancel}>
        {spec.explain(p)}
      </ExplainEditor>
    ),
  };
}

export function Muted({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('text-muted-foreground', className)}>{children}</span>;
}

export function Bar({ pct, color = 'var(--focus)' }: { pct: number; color?: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <span
      className="bg-soft border-line block h-1.5 w-full overflow-hidden rounded-full border"
      aria-hidden
    >
      <span className="block h-full" style={{ width: `${w}%`, background: color }} />
    </span>
  );
}
