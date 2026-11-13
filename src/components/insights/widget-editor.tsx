'use client';

import { useEffect, useId, useState } from 'react';
import { Info, Lock, Trash2 } from 'lucide-react';
import {
  AGGREGATIONS,
  computeWidget,
  dateFields,
  DATED_FILTERS,
  defaultListColumns,
  groupFields,
  INSIGHT_FILTERS,
  INSIGHT_WIDGET_TYPES,
  insightWidgetSchema,
  listFields,
  MAX_LIST_COLUMNS,
  MAX_NOTE,
  MAX_TITLE,
  numberFields,
  SPANS,
  widgetDateField,
  widgetDef,
  widgetGroupField,
  widgetNumberField,
  widgetSource,
  widgetTitle,
  type Aggregation,
  type InsightFilter,
  type InsightsData,
  type InsightWidget,
  type InsightWidgetType,
  type Span,
} from '@/engine/insights';
import { inputClass } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogTitle, SideSheetContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { WIDGET_ICONS } from './icons';
import { WidgetBody, type BodyActions } from './widget-body';

// The widget editor (docs/05 §3.6): a side sheet with a live preview and the settings the widget type asks for
// (its EditorSpec), then Title and Width. Nothing is saved until Save.

export interface EditorState {
  mode: 'add' | 'edit';
  /** The row the widget goes into or sits in; null = a new row. */
  rowId: string | null;
  widget: InsightWidget;
}

const selectClass = cn(inputClass, 'h-9 text-label-13.5 px-2.5');

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  const Tag = htmlFor ? 'label' : 'span';
  return (
    <div className="flex flex-col gap-2">
      <Tag {...(htmlFor ? { htmlFor } : {})} className="text-label-13 font-medium">
        {label}
      </Tag>
      {children}
      {hint ? (
        <small className="text-muted-foreground text-label-12 flex items-start gap-1.5 leading-[1.4]">
          {hint}
        </small>
      ) : null}
    </div>
  );
}

/** A segmented choice (top N, months, width): buttons that say which one is on. */
export function Segmented<T extends string | number>({
  label,
  value,
  choices,
  onChange,
  className,
}: {
  label: string;
  value: T;
  choices: readonly { value: T; label: string; name?: string }[];
  onChange(v: T): void;
  className?: string;
}) {
  return (
    <span
      role="group"
      aria-label={label}
      className={cn('bg-soft inline-flex gap-0.5 rounded-lg p-0.5', className)}
    >
      {choices.map((c) => (
        <button
          key={String(c.value)}
          type="button"
          aria-pressed={c.value === value}
          aria-label={c.name}
          title={c.name}
          onClick={() => onChange(c.value)}
          className={cn(
            'text-label-12 inline-flex h-[26px] min-w-[30px] flex-1 items-center justify-center rounded-md px-2 font-medium whitespace-nowrap',
            c.value === value
              ? 'bg-background-100 text-ink shadow-tooltip'
              : 'text-muted-foreground hover:text-ink',
          )}
        >
          {c.label}
        </button>
      ))}
    </span>
  );
}

export function WidgetEditor({
  state,
  data,
  sheets,
  bodyActions,
  onClose,
  onSave,
  onRemove,
  onSourceChange,
}: {
  state: EditorState | null;
  data: InsightsData;
  /** Sheets the person can read, for the data source. */
  sheets: { id: string; name: string }[];
  bodyActions: BodyActions;
  onClose(): void;
  onSave(s: EditorState): void;
  onRemove(widgetId: string): void;
  /** Another sheet was chosen: load it for the preview and the field lists. */
  onSourceChange(sheetId: string | undefined): void;
}) {
  const id = useId();
  const [w, setW] = useState<InsightWidget | null>(state?.widget ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setW(state?.widget ?? null);
    setError(null);
  }, [state]);
  if (!state || !w) return <Dialog open={false} />;

  const def = widgetDef(w.type);
  const spec = def.editor;
  const loaded = widgetSource(w, data);
  const s = loaded && loaded !== 'loading' ? loaded : null;
  const set = (patch: Partial<InsightWidget>) => setW((x) => (x ? { ...x, ...patch } : x));
  const groups = s ? groupFields(s) : [];
  const dates = s ? dateFields(s) : [];
  const numbers = s ? numberFields(s) : [];
  const dated = DATED_FILTERS.includes(w.filter ?? 'all');
  const showDate =
    spec.date === 'always' || (spec.date === 'filtered' && dated && dates.length > 1);
  const listable = s ? listFields(s) : [];
  const columns = s ? (w.columns ?? defaultListColumns(s, widgetDateField(w, s))) : [];
  const fieldsLoading = loaded === 'loading';

  const save = () => {
    const parsed = insightWidgetSchema.safeParse({
      ...w,
      title: w.title?.trim() || undefined,
      text: w.text?.trim() ? w.text : undefined,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the settings.');
    onSave({ ...state, widget: parsed.data });
  };

  const sourceOptions = [
    { id: data.current.sheet.id, name: `${data.current.sheet.name} (this sheet)` },
    ...sheets.filter((x) => x.id !== data.current.sheet.id),
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <SideSheetContent className="text-label-13.5 w-[min(480px,100vw)]">
        <div className="border-soft flex flex-col gap-1 border-b py-5 pr-12 pl-6">
          <DialogTitle className="text-heading-16 m-0">
            {state.mode === 'add' ? 'Add widget' : 'Configure widget'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-label-13 m-0">
            {state.mode === 'add'
              ? 'Pick a type and where the data comes from.'
              : 'Changes apply when you save.'}
          </DialogDescription>
        </div>
        <div className="flex flex-1 flex-col gap-[18px] overflow-auto px-6 pt-5 pb-6">
          <section
            aria-label="Preview"
            className="bg-subtle border-soft flex flex-col gap-2 rounded-xl border px-3 pt-2.5 pb-3"
          >
            <span aria-hidden className="text-muted-foreground text-label-11 font-medium">
              Preview
            </span>
            <div
              className="border-line bg-background-100 pointer-events-none flex flex-col rounded-xl border"
              inert
            >
              <div className="px-5 pt-4 pb-1">
                <h3 className="text-label-14 m-0 truncate font-semibold">{widgetTitle(w, data)}</h3>
              </div>
              <div className="max-h-[260px] overflow-hidden px-5 pt-2.5 pb-[18px]">
                <WidgetBody
                  model={computeWidget(w, data)}
                  height="m"
                  actions={bodyActions}
                  preview
                />
              </div>
            </div>
          </section>

          <Field label="Widget type">
            <div
              role="group"
              aria-label="Widget type"
              className="grid grid-cols-3 gap-2 sm:grid-cols-4"
            >
              {INSIGHT_WIDGET_TYPES.map((t: InsightWidgetType) => {
                const Icon = WIDGET_ICONS[t];
                const on = t === w.type;
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ type: t })}
                    className={cn(
                      'bg-background-100 text-label-12.5 flex flex-col items-start gap-2 rounded-[10px] border p-2.5 text-left font-medium',
                      on
                        ? 'border-gray-1000 ring-gray-1000 ring-1'
                        : 'border-line hover:border-line-strong',
                    )}
                  >
                    <Icon
                      className={cn('size-4', on ? 'text-ink' : 'text-muted-foreground')}
                      aria-hidden
                    />
                    {widgetDef(t).label}
                  </button>
                );
              })}
            </div>
          </Field>

          {spec.source ? (
            <Field
              label="Data source"
              htmlFor={`${id}-src`}
              hint={
                <>
                  <Lock className="mt-px size-[13px] shrink-0" aria-hidden />
                  <span>Lists every sheet you can view. Figures respect your access.</span>
                </>
              }
            >
              <select
                id={`${id}-src`}
                className={selectClass}
                value={w.src ?? data.current.sheet.id}
                onChange={(e) => {
                  const src = e.target.value === data.current.sheet.id ? undefined : e.target.value;
                  onSourceChange(src);
                  set({ src, by: undefined, date: undefined, num: undefined, columns: undefined });
                }}
              >
                {sourceOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {spec.hint && s ? (
            <p className="text-muted-foreground text-copy-13 m-0">{spec.hint(w, s)}</p>
          ) : null}

          {spec.groupBy ? (
            <Field label="Group by" htmlFor={`${id}-by`}>
              {groups.length || fieldsLoading ? (
                <select
                  id={`${id}-by`}
                  className={selectClass}
                  disabled={fieldsLoading}
                  value={s ? (widgetGroupField(w, s)?.key ?? '') : ''}
                  onChange={(e) => set({ by: e.target.value })}
                >
                  {groups.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-muted-foreground text-copy-13 m-0">
                  No status, dropdown, people or checkbox fields on this sheet.
                </p>
              )}
            </Field>
          ) : null}

          {spec.filter ? (
            <Field label="Show" htmlFor={`${id}-filter`}>
              <select
                id={`${id}-filter`}
                className={selectClass}
                value={w.filter ?? 'all'}
                onChange={(e) => set({ filter: e.target.value as InsightFilter })}
              >
                {INSIGHT_FILTERS.map((f) => (
                  <option
                    key={f.id}
                    value={f.id}
                    disabled={DATED_FILTERS.includes(f.id) && !!s && !dates.length}
                  >
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {spec.aggregation ? (
            <Field label="Value">
              <div className="grid grid-cols-2 gap-2">
                <select
                  aria-label="Value"
                  className={selectClass}
                  value={w.agg ?? 'count'}
                  onChange={(e) => {
                    const agg = e.target.value as Aggregation;
                    set({
                      agg: agg === 'count' ? undefined : agg,
                      num: agg === 'count' ? undefined : (w.num ?? numbers[0]?.key),
                    });
                  }}
                >
                  {AGGREGATIONS.filter((a) => a.id === 'count' || numbers.length).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
                {w.agg && w.agg !== 'count' && numbers.length && s ? (
                  <select
                    aria-label="Number field"
                    className={selectClass}
                    value={widgetNumberField(w, s)?.key ?? ''}
                    onChange={(e) => set({ num: e.target.value })}
                  >
                    {numbers.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span />
                )}
              </div>
            </Field>
          ) : null}

          {showDate ? (
            <Field label="Date field" htmlFor={`${id}-date`}>
              {dates.length || fieldsLoading ? (
                <select
                  id={`${id}-date`}
                  className={selectClass}
                  disabled={fieldsLoading}
                  value={s ? (widgetDateField(w, s)?.key ?? '') : ''}
                  onChange={(e) => set({ date: e.target.value })}
                >
                  {dates.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-muted-foreground text-copy-13 m-0">
                  No date fields on this sheet.
                </p>
              )}
            </Field>
          ) : null}

          {spec.columns ? (
            <Field
              label="Columns"
              hint={
                <>
                  <Info className="mt-px size-[13px] shrink-0" aria-hidden />
                  <span>Up to {MAX_LIST_COLUMNS}, shown after the item name.</span>
                </>
              }
            >
              <div role="group" aria-label="Columns" className="flex flex-wrap gap-1.5">
                {listable.map((f) => {
                  const on = columns.includes(f.key);
                  return (
                    <button
                      key={f.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        if (on) return set({ columns: columns.filter((k) => k !== f.key) });
                        if (columns.length >= MAX_LIST_COLUMNS)
                          return setError(`Choose up to ${MAX_LIST_COLUMNS} columns.`);
                        setError(null);
                        set({ columns: [...columns, f.key] });
                      }}
                      className={cn(
                        'text-label-12.5 h-7 rounded-full border px-2.5',
                        on
                          ? 'border-gray-1000 bg-gray-1000 text-background-100'
                          : 'border-line bg-background-100 hover:border-line-strong',
                      )}
                    >
                      {f.name}
                    </button>
                  );
                })}
              </div>
            </Field>
          ) : null}

          {spec.top ? (
            <Field label={spec.top.label}>
              <Segmented
                label={spec.top.label}
                className="self-start"
                value={w.top ?? spec.top.fallback}
                choices={spec.top.choices}
                onChange={(v) => set({ top: v })}
              />
            </Field>
          ) : null}

          {spec.text ? (
            <Field
              label="Text"
              htmlFor={`${id}-text`}
              hint={`${(w.text ?? '').length} of ${MAX_NOTE} characters`}
            >
              <textarea
                id={`${id}-text`}
                className={cn(
                  inputClass,
                  'text-label-13.5 h-24 resize-y px-2.5 py-2 leading-[1.5]',
                )}
                maxLength={MAX_NOTE}
                placeholder="Context, targets or instructions for this view"
                value={w.text ?? ''}
                onChange={(e) => set({ text: e.target.value })}
              />
            </Field>
          ) : null}

          <Field label="Title" htmlFor={`${id}-title`}>
            <input
              id={`${id}-title`}
              className={selectClass}
              maxLength={MAX_TITLE}
              value={w.title ?? ''}
              placeholder={widgetDef(w.type).autoTitle(w, s ?? undefined)}
              onChange={(e) => set({ title: e.target.value })}
            />
          </Field>

          <Field label="Width">
            <Segmented
              label="Width"
              className="self-start"
              value={w.span}
              choices={SPANS.map((x) => ({ value: x.span as Span, label: x.label }))}
              onChange={(span) => set({ span })}
            />
          </Field>
          {error ? (
            <p role="alert" className="text-crit text-copy-13 m-0">
              {error}
            </p>
          ) : null}
        </div>
        <div className="border-soft flex items-center gap-2 border-t px-6 py-3.5">
          {state.mode === 'edit' ? (
            <Button
              type="button"
              variant="ghost"
              className="text-crit h-9"
              onClick={() => onRemove(w.id)}
            >
              <Trash2 aria-hidden className="size-3.5" /> Remove
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button type="button" variant="outline" className="h-9" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" className="h-9" onClick={save}>
            {state.mode === 'add' ? 'Add widget' : 'Save'}
          </Button>
        </div>
      </SideSheetContent>
    </Dialog>
  );
}
