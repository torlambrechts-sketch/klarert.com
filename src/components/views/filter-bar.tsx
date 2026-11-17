'use client';

import { useId } from 'react';
import { ArrowDownWideNarrow, ChevronDown, ListFilter, Plus, Search, X } from 'lucide-react';
import { OPERATORS, kindOfKey, OP_LABEL, SPECIAL_KEYS } from '@/engine/conditions';
import { resolveFieldType } from '@/engine/fields/resolve';
import type { ValueKind } from '@/engine/fields/types';
import type { Condition, Ctx, Field, Json } from '@/engine/types';
import { NO_VALUE_OPS, splitConditions } from '@/engine/views/apply';
import type { SortRule, ViewConfig } from '@/engine/views/config';
import { optionsOf } from '@/components/fields/kit';
import { inputClass } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  toolbarButton,
  toolbarCount,
  toolbarOn,
  toolbarPlaceholder,
  toolbarSelect,
} from '@/components/table/toolbar-styles';

// Filters, sort and search of a view (docs/01 FR-26, docs/03 §4): conditions use the engine's operators per value
// kind; the field picker offers the item's name, group and id besides the sheet's fields.

export { OP_LABEL };

/** Operators the builder offers (picking an item or a signer by id has no picker yet). */
const offered = (kind: ValueKind) =>
  OPERATORS[kind].filter((op) => op !== 'includes_item' && op !== 'signed_by');

const NO_VALUE = NO_VALUE_OPS;
const COUNT_OPS = new Set(['next_days', 'last_days', 'count_gt', 'count_lt', 'expires_within']);
const LIST_OPS = new Set([
  'is_any_of',
  'is_none_of',
  'has_any_of',
  'has_all_of',
  'has_none_of',
  'includes_any_of',
  'excludes',
]);

const SPECIAL_NAMES: Record<string, string> = {
  __name: 'Name',
  __group: 'Group',
  __id: 'ID',
  __missing: 'Missing required',
};

export function keyLabel(key: string, ctx: Ctx) {
  return SPECIAL_NAMES[key] ?? ctx.fieldsByKey.get(key)?.name ?? key;
}

/** Fields that can be filtered: everything with operators besides "is empty". */
export function filterable(fields: Field[], ctx: Ctx) {
  return fields.filter((f) => {
    const kind = kindOfKey(f.key, ctx);
    return kind && kind !== 'none' && resolveFieldType(f.type)?.storage !== 'none';
  });
}

function defaultValue(op: string, kind: ValueKind): Json | undefined {
  if (NO_VALUE.has(op)) return undefined;
  if (LIST_OPS.has(op)) return [];
  if (COUNT_OPS.has(op)) return 7;
  if (op === 'between') return kind === 'number' ? [0, 10] : ['', ''];
  if (op === 'freshness_is') return 'expired';
  return '';
}

/** Choices for list operators: options of the field, people, or the sheet's groups. */
function choicesFor(key: string, kind: ValueKind, ctx: Ctx): { id: string; label: string }[] {
  if (key === '__group')
    return [...ctx.groups.values()]
      .sort((a, b) => (a.position < b.position ? -1 : 1))
      .map((g) => ({ id: g.id, label: g.name }));
  if (kind === 'people')
    return [
      { id: 'me', label: 'Me' },
      ...[...ctx.people.values()]
        .sort((a, b) => a.name.localeCompare(b.name, 'en-GB'))
        .map((p) => ({ id: p.id, label: p.name })),
    ];
  const field = ctx.fieldsByKey.get(key);
  return field ? optionsOf(field, ctx).map((o) => ({ id: o.id, label: o.label })) : [];
}

const selectClass = cn(inputClass, 'h-8 w-auto max-w-full pr-6');

/** A new condition on the first usable field with its first operator. */
export function newCondition(fields: Field[], ctx: Ctx): Condition {
  const key = fields[0]?.key ?? '__name';
  const kind = kindOfKey(key, ctx) ?? 'text';
  const op = offered(kind)[0]!;
  return { fieldKey: key, op, value: defaultValue(op, kind) };
}

export function FilterButton({
  config,
  setConfig,
  fields,
  ctx,
  computedNotice,
}: {
  config: ViewConfig;
  setConfig(update: (c: ViewConfig) => ViewConfig): void;
  fields: Field[];
  ctx: Ctx;
  /** Large sheets: filters on calculated columns run on loaded items only. */
  computedNotice: boolean;
}) {
  const conds = config.filters;
  const { invalid } = splitConditions(conds, ctx);
  const set = (next: Condition[]) => setConfig((c) => ({ ...c, filters: next }));
  const usable = filterable(fields, ctx);
  const count = conds.length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(toolbarButton, count > 0 && toolbarOn)}
          aria-label={count ? `Filter, ${count} active` : 'Filter'}
        >
          <ListFilter aria-hidden /> Filter
          {count ? (
            <span className="bg-ink text-label-12 ml-0.5 rounded-full px-1.5 leading-4 font-bold text-white tabular-nums">
              {count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(560px,calc(100vw-24px))]">
        <div className="flex flex-col gap-3">
          <p className="text-copy-13 font-semibold">Show items where all of these match</p>
          {conds.length === 0 ? (
            <p className="text-muted-foreground text-copy-13">No filters. Every item is shown.</p>
          ) : null}
          <ol className="flex flex-col gap-2">
            {conds.map((cond, i) => (
              <ConditionRow
                key={i}
                index={i}
                cond={cond}
                ctx={ctx}
                fields={usable}
                problem={invalid.find((x) => x.cond === cond)?.problem}
                onChange={(c) => set(conds.map((x, j) => (j === i ? c : x)))}
                onRemove={() => set(conds.filter((_, j) => j !== i))}
              />
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => set([...conds, newCondition(usable, ctx)])}
            >
              <Plus aria-hidden /> Add a condition
            </Button>
            {conds.length ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => set([])}>
                Clear all
              </Button>
            ) : null}
          </div>
          {computedNotice ? (
            <p className="text-muted-foreground text-label-12">
              Filters on calculated columns apply to loaded items.
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** One condition: field, operator and value (view filters and automation conditions). */
export function ConditionRow({
  index,
  cond,
  ctx,
  fields,
  problem,
  onChange,
  onRemove,
}: {
  index: number;
  cond: Condition;
  ctx: Ctx;
  fields: Field[];
  problem?: string;
  onChange(c: Condition): void;
  onRemove(): void;
}) {
  const id = useId();
  const kind = kindOfKey(cond.fieldKey, ctx);
  const ops = kind ? offered(kind) : [];
  const n = index + 1;
  return (
    <li className="border-line flex flex-col gap-1.5 rounded-md border p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          aria-label={`Condition ${n} field`}
          className={selectClass}
          value={cond.fieldKey}
          onChange={(e) => {
            const k = kindOfKey(e.target.value, ctx) ?? 'text';
            const op = offered(k).includes(cond.op) ? cond.op : offered(k)[0]!;
            onChange({ fieldKey: e.target.value, op, value: defaultValue(op, k) });
          }}
        >
          {!kind ? <option value={cond.fieldKey}>Deleted field</option> : null}
          {Object.keys(SPECIAL_KEYS).map((k) => (
            <option key={k} value={k}>
              {SPECIAL_NAMES[k]}
            </option>
          ))}
          {fields.map((f) => (
            <option key={f.id} value={f.key}>
              {f.name}
            </option>
          ))}
        </select>
        <select
          aria-label={`Condition ${n} operator`}
          className={selectClass}
          value={cond.op}
          disabled={!kind}
          onChange={(e) =>
            onChange({ ...cond, op: e.target.value, value: defaultValue(e.target.value, kind!) })
          }
        >
          {!ops.includes(cond.op) ? (
            <option value={cond.op}>{OP_LABEL[cond.op] ?? cond.op}</option>
          ) : null}
          {ops.map((op) => (
            <option key={op} value={op}>
              {OP_LABEL[op] ?? op}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="ml-auto"
          aria-label={`Remove condition ${n}`}
          onClick={onRemove}
        >
          <X aria-hidden />
        </Button>
      </div>
      {kind && !NO_VALUE.has(cond.op) ? (
        <ValueInput
          id={id}
          n={n}
          cond={cond}
          kind={kind}
          ctx={ctx}
          onChange={(value) => onChange({ ...cond, value })}
        />
      ) : null}
      {problem ? (
        <p className="text-crit text-label-12">{problem} This condition is skipped.</p>
      ) : null}
    </li>
  );
}

function ValueInput({
  id,
  n,
  cond,
  kind,
  ctx,
  onChange,
}: {
  id: string;
  n: number;
  cond: Condition;
  kind: ValueKind;
  ctx: Ctx;
  onChange(v: Json): void;
}) {
  const label = `Condition ${n} value`;
  const v = cond.value;
  if (LIST_OPS.has(cond.op)) {
    const chosen = new Set(Array.isArray(v) ? v.map(String) : []);
    const choices = choicesFor(cond.fieldKey, kind, ctx);
    return (
      <fieldset className="flex max-h-40 flex-wrap gap-x-3 gap-y-1 overflow-auto">
        <legend className="sr-only">{label}</legend>
        {choices.length === 0 ? (
          <p className="text-muted-foreground text-label-12">No options to choose from.</p>
        ) : null}
        {choices.map((c) => (
          <label key={c.id} className="text-label-13 flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={chosen.has(c.id)}
              onChange={(e) => {
                const next = new Set(chosen);
                if (e.target.checked) next.add(c.id);
                else next.delete(c.id);
                onChange([...next]);
              }}
            />
            {c.label}
          </label>
        ))}
      </fieldset>
    );
  }
  if (cond.op === 'at_least' || cond.op === 'at_most') {
    const choices = choicesFor(cond.fieldKey, kind, ctx);
    return (
      <select
        aria-label={label}
        className={selectClass}
        value={String(v ?? '')}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose…</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
    );
  }
  if (cond.op === 'freshness_is')
    return (
      <select
        aria-label={label}
        className={selectClass}
        value={String(v ?? '')}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="current">Current</option>
        <option value="expiring">Expiring</option>
        <option value="expired">Expired</option>
      </select>
    );
  const dateLike = kind === 'date' || kind === 'daterange';
  const type = COUNT_OPS.has(cond.op) || kind === 'number' ? 'number' : dateLike ? 'date' : 'text';
  if (cond.op === 'between') {
    const pair = Array.isArray(v) && v.length === 2 ? v : ['', ''];
    const read = (s: string): Json => (type === 'number' ? (s === '' ? '' : Number(s)) : s);
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          id={id}
          aria-label={`${label}, from`}
          type={type}
          className={cn(inputClass, 'w-40')}
          value={String(pair[0] ?? '')}
          onChange={(e) => onChange([read(e.target.value), pair[1] ?? ''])}
        />
        <span className="text-muted-foreground text-label-13">and</span>
        <input
          aria-label={`${label}, to`}
          type={type}
          className={cn(inputClass, 'w-40')}
          value={String(pair[1] ?? '')}
          onChange={(e) => onChange([pair[0] ?? '', read(e.target.value)])}
        />
      </div>
    );
  }
  return (
    <input
      id={id}
      aria-label={label}
      type={type}
      min={COUNT_OPS.has(cond.op) ? 0 : undefined}
      className={cn(inputClass, type === 'text' ? 'w-full' : 'w-44')}
      value={v === undefined || v === null ? '' : String(v)}
      onChange={(e) =>
        onChange(
          type === 'number'
            ? e.target.value === ''
              ? ''
              : Number(e.target.value)
            : e.target.value,
        )
      }
    />
  );
}

// ───────────────────────── sort ─────────────────────────

export function SortButton({
  config,
  setConfig,
  fields,
  ctx,
}: {
  config: ViewConfig;
  setConfig(update: (c: ViewConfig) => ViewConfig): void;
  fields: Field[];
  ctx: Ctx;
}) {
  const rules = config.sort;
  const set = (next: SortRule[]) => setConfig((c) => ({ ...c, sort: next }));
  const sortable = fields.filter((f) => resolveFieldType(f.type)?.storage !== 'none');
  const keys = ['__name', '__id', ...sortable.map((f) => f.key)];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn(toolbarSelect, rules.length > 0 && toolbarOn)}>
          <ArrowDownWideNarrow className="text-muted-foreground size-[15px] shrink-0" aria-hidden />
          <span
            className={cn('min-w-0 flex-1 truncate text-left', !rules.length && toolbarPlaceholder)}
          >
            {rules.length ? `Sorted by ${keyLabel(rules[0]!.fieldKey, ctx)}` : 'Default order'}
          </span>
          {rules.length > 1 ? (
            <span className={toolbarCount}>
              +{rules.length - 1}
              <span className="sr-only"> more</span>
            </span>
          ) : null}
          <ChevronDown className="text-muted-foreground size-[15px] shrink-0" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(440px,calc(100vw-24px))]">
        <div className="flex flex-col gap-3">
          <p className="text-copy-13 font-semibold">Sort items in each group by</p>
          {rules.length === 0 ? (
            <p className="text-muted-foreground text-copy-13">
              Items keep the order you gave them.
            </p>
          ) : null}
          <ol className="flex flex-col gap-2">
            {rules.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground text-label-12 w-12">
                  {i === 0 ? 'Sort by' : 'then by'}
                </span>
                <select
                  aria-label={`Sort level ${i + 1} field`}
                  className={selectClass}
                  value={r.fieldKey}
                  onChange={(e) =>
                    set(rules.map((x, j) => (j === i ? { ...x, fieldKey: e.target.value } : x)))
                  }
                >
                  {keys.map((k) => (
                    <option key={k} value={k}>
                      {keyLabel(k, ctx)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Sort level ${i + 1} direction`}
                  className={selectClass}
                  value={r.dir}
                  onChange={(e) =>
                    set(
                      rules.map((x, j) =>
                        j === i ? { ...x, dir: e.target.value as 'asc' | 'desc' } : x,
                      ),
                    )
                  }
                >
                  <option value="asc">A → Z, low → high</option>
                  <option value="desc">Z → A, high → low</option>
                </select>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove sort level ${i + 1}`}
                  onClick={() => set(rules.filter((_, j) => j !== i))}
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
          {rules.length < 5 ? (
            <div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  set([
                    ...rules,
                    {
                      fieldKey: keys.find((k) => !rules.some((r) => r.fieldKey === k)) ?? '__name',
                      dir: 'asc',
                    },
                  ])
                }
              >
                <Plus aria-hidden /> Add a sort
              </Button>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ───────────────────────── search ─────────────────────────

export function SheetSearch({ value, onChange }: { value: string; onChange(v: string): void }) {
  return (
    <label className="relative flex w-full items-center">
      <span className="sr-only">Search this sheet</span>
      <Search
        className="text-muted-foreground pointer-events-none absolute left-2.5 size-[15px]"
        aria-hidden
      />
      <input
        type="search"
        className={cn(inputClass, 'text-label-14 h-[38px] w-full pl-8')}
        placeholder="Search items…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
