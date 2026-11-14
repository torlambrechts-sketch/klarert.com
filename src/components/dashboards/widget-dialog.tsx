'use client';

import { useId, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
// the field types the widget's field choices and conditions read (installs the registry in the browser)
import '@/engine/fields/registry';
import {
  DEFAULT_DAYS,
  MAX_DAYS,
  WIDGET_ORDER,
  WIDGET_TYPES,
  widgetFieldChoices,
  widgetProblem,
  type WidgetConfig,
} from '@/engine/dashboards';
import { describeCondition } from '@/engine/automations/builder';
import { emptySheetData, sheetCtx } from '@/engine/sheet-data';
import type { Condition, Ctx, Person } from '@/engine/types';
import { inputClass } from '@/components/fields/shared';
import { ConditionRow, filterable, newCondition } from '@/components/views/filter-bar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { SheetMeta } from '@/server/repositories/dashboards';

// Add or edit a widget (docs/05 §4): the kind (from the widget registry), then only what that kind needs: a sheet,
// a field it can use, conditions (the same condition rows as view filters) and a period. The registry checks the
// widget before it can be saved; the command checks it again on the server.

export interface WidgetEditorData {
  sheets: SheetMeta[];
  people: Person[];
  timeZone: string;
  userId: string;
}

const newWidgetId = () => `w${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
const selectClass = cn(inputClass, 'h-9');

export function WidgetDialog({
  open,
  initial,
  editor,
  onCancel,
  onSave,
}: {
  open: boolean;
  /** The widget to edit; a new one when absent. */
  initial?: WidgetConfig;
  editor: WidgetEditorData;
  onCancel(): void;
  onSave(widget: WidgetConfig): Promise<boolean>;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-h-[calc(100dvh-32px)] overflow-y-auto sm:max-w-[600px]">
        {open ? (
          <WidgetForm initial={initial} editor={editor} onCancel={onCancel} onSave={onSave} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function WidgetForm({
  initial,
  editor,
  onCancel,
  onSave,
}: {
  initial?: WidgetConfig;
  editor: WidgetEditorData;
  onCancel(): void;
  onSave(widget: WidgetConfig): Promise<boolean>;
}) {
  const ids = { type: useId(), sheet: useId(), field: useId(), days: useId(), title: useId() };
  const [type, setType] = useState(initial?.type ?? WIDGET_ORDER[0]!);
  const [sheetId, setSheetId] = useState<string | null>(
    initial?.sheetId ?? editor.sheets[0]?.sheet.id ?? null,
  );
  const [fieldKey, setFieldKey] = useState<string | null>(initial?.fieldKey ?? null);
  const [conditions, setConditions] = useState<Condition[]>(initial?.conditions ?? []);
  // a pack's widget may look only at some items (its standard's rows of a shared register): kept on its own sheet
  const [scope, setScope] = useState<Condition[]>(initial?.scope ?? []);
  const [days, setDays] = useState<number>(initial?.days ?? DEFAULT_DAYS);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [titleTouched, setTitleTouched] = useState(!!initial);
  const [busy, setBusy] = useState(false);
  const def = WIDGET_TYPES[type]!;

  const ctxs = useMemo(() => {
    const env = {
      now: new Date(),
      timeZone: editor.timeZone,
      userId: editor.userId,
      newId: (p: string) => `${p}${crypto.randomUUID().slice(0, 6)}`,
    };
    const m = new Map<string, Ctx>();
    for (const s of editor.sheets)
      m.set(
        s.sheet.id,
        sheetCtx(
          { ...emptySheetData(s.sheet), fields: s.fields, groups: s.groups, people: editor.people },
          env,
        ),
      );
    return m;
  }, [editor]);
  const lookup = (id: string) => {
    const meta = editor.sheets.find((s) => s.sheet.id === id);
    const ctx = ctxs.get(id);
    return meta && ctx ? { fields: meta.fields, ctx } : undefined;
  };

  const usesSheet = def.needs.sheet !== 'none';
  const effectiveSheet = usesSheet ? sheetId : null;
  const current = effectiveSheet ? lookup(effectiveSheet) : undefined;
  const keptScope = effectiveSheet && effectiveSheet === initial?.sheetId ? scope : [];
  const choices = current ? widgetFieldChoices(type, current.fields, current.ctx) : [];
  const effectiveField = def.needs.field
    ? (choices.find((f) => f.key === fieldKey)?.key ?? choices[0]?.key ?? null)
    : null;
  const sheetName = editor.sheets.find((s) => s.sheet.id === effectiveSheet)?.sheet.name;
  const fieldName = choices.find((f) => f.key === effectiveField)?.name;
  const autoTitle = def.defaultTitle({ sheet: sheetName, field: fieldName, days });
  const widget: WidgetConfig = {
    id: initial?.id ?? newWidgetId(),
    type,
    title: (titleTouched ? title : autoTitle).trim() || autoTitle,
    ...(effectiveSheet ? { sheetId: effectiveSheet } : {}),
    ...(effectiveField ? { fieldKey: effectiveField } : {}),
    ...(def.needs.conditions && conditions.length && effectiveSheet ? { conditions } : {}),
    ...(def.needs.conditions && keptScope.length ? { scope: keptScope } : {}),
    ...(def.needs.days ? { days } : {}),
  };
  const problem = widgetProblem(widget, lookup);
  const usable = current ? filterable(current.fields, current.ctx) : [];

  const save = async () => {
    if (problem) return;
    setBusy(true);
    await onSave(widget);
    setBusy(false);
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-col gap-1">
        <DialogTitle className="text-heading-16">
          {initial ? 'Edit widget' : 'Add widget'}
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-label-13">
          Widgets read from your sheets each time the dashboard opens.
        </DialogDescription>
      </div>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="text-label-13 mb-1 font-medium">Kind</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {WIDGET_ORDER.map((id) => {
            const t = WIDGET_TYPES[id]!;
            return (
              <label
                key={id}
                className={cn(
                  'border-line hover:border-line-strong bg-background-100 text-label-13 flex cursor-pointer gap-2 rounded-lg border p-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--focus)]',
                  type === id && 'border-brand ring-brand ring-1',
                )}
              >
                <input
                  type="radio"
                  name={ids.type}
                  value={id}
                  checked={type === id}
                  onChange={() => {
                    setType(id);
                    setFieldKey(null);
                    if (!t.needs.conditions) setConditions([]);
                    if (t.needs.sheet === 'required' && !sheetId)
                      setSheetId(editor.sheets[0]?.sheet.id ?? null);
                  }}
                  className="mt-0.5"
                />
                <span className="flex flex-col">
                  <span className="font-medium">{t.label}</span>
                  <span className="text-muted-foreground text-label-12">{t.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {usesSheet ? (
        <label htmlFor={ids.sheet} className="text-label-13 flex flex-col gap-1 font-medium">
          Sheet
          <select
            id={ids.sheet}
            className={selectClass}
            value={sheetId ?? ''}
            onChange={(e) => {
              setSheetId(e.target.value || null);
              setFieldKey(null);
              setConditions([]);
            }}
          >
            {def.needs.sheet === 'optional' ? <option value="">All sheets</option> : null}
            {editor.sheets.length === 0 ? <option value="">No sheets yet</option> : null}
            {editor.sheets.map((s) => (
              <option key={s.sheet.id} value={s.sheet.id}>
                {s.sheet.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {def.needs.field ? (
        <label htmlFor={ids.field} className="text-label-13 flex flex-col gap-1 font-medium">
          {def.fieldPrompt?.label ?? (def.needs.field === 'date' ? 'Date field' : 'Field')}
          <select
            id={ids.field}
            className={selectClass}
            value={effectiveField ?? ''}
            disabled={choices.length === 0}
            onChange={(e) => setFieldKey(e.target.value || null)}
          >
            {choices.length === 0 ? (
              <option value="">
                {def.fieldPrompt?.none ??
                  (def.needs.field === 'date'
                    ? 'This sheet has no date field'
                    : 'This sheet has no status or label field')}
              </option>
            ) : null}
            {choices.map((f) => (
              <option key={f.id} value={f.key}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {def.needs.conditions && current && keptScope.length ? (
        <div className="flex flex-col gap-1">
          <p className="text-copy-13 m-0 font-medium">Only items where</p>
          <ul className="text-copy-13 text-muted-foreground m-0 flex list-none flex-col gap-0.5 p-0">
            {keptScope.map((c, i) => (
              <li key={i}>{describeCondition(c, current.ctx)}</li>
            ))}
          </ul>
          <div>
            <Button type="button" size="sm" variant="outline" onClick={() => setScope([])}>
              Look at every item
            </Button>
          </div>
        </div>
      ) : null}

      {def.needs.conditions && current ? (
        <div className="flex flex-col gap-2">
          <p className="text-copy-13 m-0 font-medium">Count items where all of these match</p>
          {conditions.length === 0 ? (
            <p className="text-muted-foreground text-copy-13 m-0">
              No conditions: every item counts.
            </p>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {conditions.map((c, i) => (
                <ConditionRow
                  key={i}
                  index={i}
                  cond={c}
                  ctx={current.ctx}
                  fields={usable}
                  onChange={(next) => setConditions(conditions.map((x, j) => (j === i ? next : x)))}
                  onRemove={() => setConditions(conditions.filter((_, j) => j !== i))}
                />
              ))}
            </ol>
          )}
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={conditions.length >= 10}
              onClick={() => setConditions([...conditions, newCondition(usable, current.ctx)])}
            >
              <Plus aria-hidden /> Add a condition
            </Button>
          </div>
        </div>
      ) : null}

      {def.needs.days ? (
        <label htmlFor={ids.days} className="text-label-13 flex flex-col gap-1 font-medium">
          Last days
          <input
            id={ids.days}
            type="number"
            min={1}
            max={MAX_DAYS}
            className={cn(inputClass, 'h-9 w-32')}
            value={days}
            onChange={(e) =>
              setDays(Math.min(MAX_DAYS, Math.max(1, Math.round(Number(e.target.value) || 1))))
            }
          />
        </label>
      ) : null}

      <label htmlFor={ids.title} className="text-label-13 flex flex-col gap-1 font-medium">
        Title
        <input
          id={ids.title}
          className={cn(inputClass, 'h-9')}
          maxLength={80}
          value={titleTouched ? title : autoTitle}
          onChange={(e) => {
            setTitleTouched(true);
            setTitle(e.target.value);
          }}
        />
      </label>

      {problem ? (
        <p className="text-muted-foreground text-copy-13 m-0" role="status">
          {problem}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !!problem}>
          {initial ? 'Save widget' : 'Add widget'}
        </Button>
      </div>
    </form>
  );
}
