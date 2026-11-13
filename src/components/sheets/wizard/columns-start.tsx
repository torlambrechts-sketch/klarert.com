'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { createSheetAction } from '@/app/[org]/s/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fieldType, typesByFamily } from '@/engine/fields/registry';
import { isLinkType, needsLibraryTarget } from '@/engine/fields/type-change';
import { BasicsFields, useBasics, useCreate, type WizardContext } from './basics';
import { selectClass } from './fields';

type Column = {
  key: number;
  name: string;
  type: string;
  /** Link types: the sheet to link to and whether it shows the link too. */
  targetSheetId?: string;
  twoWay?: boolean;
};

// the sub-items column comes with sub-items, not from this list
const FAMILIES = typesByFamily((t) => t.addable !== false);

export function TypeSelect({
  value,
  onChange,
  label,
  families = FAMILIES,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  families?: ReturnType<typeof typesByFamily>;
}) {
  return (
    <select
      aria-label={label}
      className={selectClass}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {families.map((f) => (
        <optgroup key={f.family} label={f.label}>
          {f.types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Step 2 for Blank, Register, Tracker, Log and Inspection: details and an editable column list. */
export function ColumnsStart({
  ctx,
  start,
}: {
  ctx: WizardContext;
  start: {
    id: string;
    itemLabel: string;
    groups: string[];
    fields: [string, string][];
    /** The side-menu folder sheets from this start go into (templates/starts.json). */
    folder?: string;
    /** Starts with a sub-item set: its name and the sub-items "From template" adds. */
    subitems?: { label: string; names: string[] };
  };
}) {
  const basics = useBasics(ctx, {
    itemLabel: start.itemLabel,
    groups: start.groups.join(', '),
    folder: start.folder,
  });
  const [columns, setColumns] = useState<Column[]>(() =>
    start.fields.map(([name, type], i) => ({ key: i, name, type })),
  );
  const [nextKey, setNextKey] = useState(start.fields.length);
  const { pending, errors, run } = useCreate();

  const update = (key: number, patch: Partial<Column>) =>
    setColumns((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const move = (i: number, by: -1 | 1) =>
    setColumns((cs) => {
      const next = [...cs];
      const [c] = next.splice(i, 1);
      next.splice(i + by, 0, c!);
      return next;
    });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = basics.values;
    run(
      () =>
        createSheetAction({
          org: ctx.org,
          name: v.name,
          itemLabel: v.itemLabel,
          idPrefix: v.idPrefix,
          ...basics.folder,
          groups: v.groups,
          startId: start.id,
          columns: columns.map((c) => ({
            name: c.name,
            type: c.type,
            ...(isLinkType(c.type) && c.targetSheetId
              ? { targetSheetId: c.targetSheetId, twoWay: !!c.twoWay }
              : {}),
          })),
        }),
      () => ({ text: 'Sheet created. Add your first item.' }),
      ctx.org,
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" aria-label="Sheet details" noValidate>
      <BasicsFields basics={basics} ctx={ctx} errors={errors} />
      <fieldset className="flex flex-col gap-3">
        <legend className="text-label-14 mb-1 font-bold">Fields</legend>
        <p className="text-muted-foreground text-copy-13">
          Every {basics.values.itemLabel.toLowerCase() || 'item'} gets these fields. The name is
          always the first column.
        </p>
        {columns.length === 0 ? (
          <p className="text-muted-foreground text-copy-13">
            No fields yet. Add the first one below.
          </p>
        ) : (
          <ol className="flex flex-col gap-2" aria-label="Fields">
            {columns.map((c, i) => (
              <li
                key={c.key}
                className="border-line bg-background-100 flex flex-col gap-2 rounded-lg border p-2 sm:flex-row sm:items-center"
              >
                <span
                  className="text-muted-foreground text-label-12-mono hidden w-5 sm:block"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <Input
                  aria-label={`Name of field ${i + 1}`}
                  value={c.name}
                  maxLength={80}
                  onChange={(e) => update(c.key, { name: e.target.value })}
                  className="sm:max-w-60"
                />
                <div className="sm:w-48">
                  <TypeSelect
                    label={`Type of field ${i + 1}`}
                    value={c.type}
                    onChange={(type) => update(c.key, { type })}
                  />
                </div>
                {isLinkType(c.type) ? (
                  <LinkTarget
                    column={c}
                    index={i}
                    sheets={ctx.sheets.filter((s) => !needsLibraryTarget(c.type) || s.isLibrary)}
                    onChange={(patch) => update(c.key, patch)}
                  />
                ) : (
                  <span className="text-muted-foreground text-label-12 min-w-0 flex-1">
                    {fieldType(c.type)?.description}
                  </span>
                )}
                <span className="flex gap-1">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Move ${c.name || `field ${i + 1}`} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Move ${c.name || `field ${i + 1}`} down`}
                    disabled={i === columns.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove ${c.name || `field ${i + 1}`}`}
                    onClick={() => setColumns((cs) => cs.filter((x) => x.key !== c.key))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        )}
        {errors.columns ? <p className="text-crit text-copy-13">{errors.columns}</p> : null}
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={columns.length >= 100}
            onClick={() => {
              setColumns((cs) => [
                ...cs,
                { key: nextKey, name: `Field ${cs.length + 1}`, type: 'text' },
              ]);
              setNextKey((k) => k + 1);
            }}
          >
            <Plus aria-hidden /> Add field
          </Button>
        </div>
      </fieldset>
      {start.subitems ? (
        <section aria-label={start.subitems.label} className="flex flex-col gap-1.5">
          <h3 className="text-label-14 m-0 font-bold">{start.subitems.label}</h3>
          <p className="text-muted-foreground text-copy-13 m-0">
            Comes with sub-items called {start.subitems.label.toLowerCase()}. Add them to an item in
            one go with From template: {start.subitems.names.join(', ')}. You can change them in the
            sheet settings.
          </p>
        </section>
      ) : null}
      <div>
        <Button type="submit" disabled={pending || !!basics.prefixProblem}>
          {pending ? 'Creating…' : 'Create sheet'}
        </Button>
      </div>
    </form>
  );
}

/** Link columns: which sheet they link to, and "Show on <sheet> too" (creates the inverse field there). */
function LinkTarget({
  column,
  index,
  sheets,
  onChange,
}: {
  column: Column;
  index: number;
  sheets: { id: string; name: string }[];
  onChange(patch: Partial<Column>): void;
}) {
  const target = sheets.find((s) => s.id === column.targetSheetId);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <select
        aria-label={`Sheet that field ${index + 1} links to`}
        className={selectClass}
        value={column.targetSheetId ?? ''}
        onChange={(e) => onChange({ targetSheetId: e.target.value || undefined })}
      >
        <option value="">
          {sheets.length ? 'Choose the sheet to link to' : 'No sheets to link to yet'}
        </option>
        {sheets.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {target ? (
        <label className="text-label-12 flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!column.twoWay}
            onChange={(e) => onChange({ twoWay: e.target.checked })}
          />
          Show on {target.name} too
        </label>
      ) : (
        <span className="text-muted-foreground text-label-12">
          You can also choose the sheet later in the field settings.
        </span>
      )}
    </div>
  );
}
