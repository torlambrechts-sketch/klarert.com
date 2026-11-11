'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { createSheetAction } from '@/app/[org]/s/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fieldType, typesByFamily } from '@/engine/fields/registry';
import { BasicsFields, useBasics, useCreate, type WizardContext } from './basics';
import { selectClass } from './fields';

type Column = { key: number; name: string; type: string };

const FAMILIES = typesByFamily();

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
  start: { itemLabel: string; groups: string[]; fields: [string, string][] };
}) {
  const basics = useBasics(ctx, { itemLabel: start.itemLabel, groups: start.groups.join(', ') });
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
          folderId: v.folderId,
          groups: v.groups,
          columns: columns.map((c) => ({ name: c.name, type: c.type })),
        }),
      () => ({ text: 'Sheet created.' }),
      ctx.org,
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" aria-label="Sheet details" noValidate>
      <BasicsFields basics={basics} ctx={ctx} errors={errors} />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-base font-bold">Fields</legend>
        <p className="text-muted-foreground text-sm">
          Every {basics.values.itemLabel.toLowerCase() || 'item'} gets these fields. The name is
          always the first column.
        </p>
        {columns.length === 0 ? (
          <p className="text-muted-foreground text-sm">No fields yet. Add the first one below.</p>
        ) : (
          <ol className="flex flex-col gap-2" aria-label="Fields">
            {columns.map((c, i) => (
              <li
                key={c.key}
                className="border-line flex flex-col gap-2 rounded-[var(--radius-card)] border bg-white p-2 sm:flex-row sm:items-center"
              >
                <span
                  className="text-muted-foreground hidden w-5 font-mono text-xs sm:block"
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
                <span className="text-muted-foreground min-w-0 flex-1 text-xs">
                  {fieldType(c.type)?.description}
                </span>
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
        {errors.columns ? <p className="text-crit text-sm">{errors.columns}</p> : null}
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
      <div>
        <Button type="submit" disabled={pending || !!basics.prefixProblem}>
          {pending ? 'Creating…' : 'Create sheet'}
        </Button>
      </div>
    </form>
  );
}
