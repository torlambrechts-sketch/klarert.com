'use client';

import { useDeferredValue, useId, useMemo, useState } from 'react';
import { importCsvAction } from '@/app/[org]/s/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CSV_LIMITS, csvImportable, parseCsv, planColumns } from '@/engine/fields/csv';
import { typesByFamily } from '@/engine/fields/registry';
import { BasicsFields, useBasics, useCreate, type WizardContext } from './basics';
import { TypeSelect } from './columns-start';

const IMPORTABLE = typesByFamily((t) => csvImportable(t.id));

/** Step 2 for "Import a spreadsheet": paste or choose a CSV, confirm each column's type, create. */
export function CsvStart({ ctx }: { ctx: WizardContext }) {
  const basics = useBasics(ctx, { itemLabel: 'Item', groups: 'Imported' });
  const [pasted, setPasted] = useState('');
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const text = useDeferredValue(file ? file.text : pasted);
  const parsed = useMemo(() => (text.trim() ? parseCsv(text) : null), [text]);
  const plan = useMemo(() => (parsed?.ok ? planColumns(parsed.table) : []), [parsed]);
  // the person's choices per column, reset whenever the header changes
  const headerKey = parsed?.ok ? parsed.table.header.join('\u0000') : '';
  const [choice, setChoice] = useState<{ key: string; cols: { name: string; type: string }[] }>({
    key: '',
    cols: [],
  });
  const chosen =
    choice.key === headerKey ? choice.cols : plan.map((c) => ({ name: c.name, type: c.type }));
  const setCol = (i: number, patch: Partial<{ name: string; type: string }>) =>
    setChoice({ key: headerKey, cols: chosen.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const { pending, errors, run } = useCreate();
  const textId = useId();
  const fileId = useId();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setFileError(null);
    if (!f) return setFile(null);
    if (f.size > CSV_LIMITS.bytes) {
      setFile(null);
      setFileError('The file is larger than 10 MB. Split it and import the parts.');
      return;
    }
    setFile({ name: f.name, text: await f.text() });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!parsed?.ok) return;
    const v = basics.values;
    run(
      () =>
        importCsvAction({
          org: ctx.org,
          name: v.name,
          itemLabel: v.itemLabel,
          idPrefix: v.idPrefix,
          folderId: v.folderId,
          groups: v.groups,
          csv: text,
          columns: plan.map((c, i) => ({
            index: c.index,
            name: chosen[i]?.name ?? c.name,
            type: chosen[i]?.type ?? c.type,
          })),
        }),
      (d) => ({
        text:
          `Sheet created with ${d.imported === 1 ? '1 item' : `${d.imported.toLocaleString('en-GB')} items`}.` +
          (d.skippedCells > 0
            ? ` ${d.skippedCells === 1 ? '1 cell was' : `${d.skippedCells.toLocaleString('en-GB')} cells were`} left empty: the value did not match the field type.`
            : ''),
        error:
          d.imported < d.items
            ? `Only ${d.imported.toLocaleString('en-GB')} of ${d.items.toLocaleString('en-GB')} rows were imported. Try the rest again.`
            : undefined,
      }),
      ctx.org,
    );
  }

  const rows = parsed?.ok ? parsed.table.rows : [];
  const examples = (index: number) =>
    rows
      .map((r) => r[index] ?? '')
      .filter(Boolean)
      .slice(0, 3)
      .join(' · ');

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" aria-label="Import details" noValidate>
      <BasicsFields basics={basics} ctx={ctx} errors={errors} />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-base font-bold">Spreadsheet</legend>
        <p className="text-muted-foreground text-sm">
          The first row holds the field names; the first column becomes the item name. At most{' '}
          {CSV_LIMITS.rows.toLocaleString('en-GB')} rows, {CSV_LIMITS.columns} columns and 10 MB.
        </p>
        {file ? (
          <p className="text-sm">
            Using <span className="font-semibold">{file.name}</span>.{' '}
            <button type="button" className="text-info underline" onClick={() => setFile(null)}>
              Paste text instead
            </button>
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={textId}>CSV text</Label>
            <textarea
              id={textId}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={7}
              spellCheck={false}
              placeholder={
                'Item,Owner email,Due,Hours\nCalibrate torque wrench,grace@example.com,2026-11-25,2'
              }
              aria-invalid={parsed && !parsed.ok ? true : undefined}
              className="border-input focus-visible:ring-ring/50 rounded-md border bg-white p-2 font-mono text-[12.5px] outline-none focus-visible:ring-[3px]"
            />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={fileId}>Or choose a file</Label>
          <Input id={fileId} type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onFile} />
        </div>
        {fileError ? (
          <p role="alert" className="text-crit text-sm">
            {fileError}
          </p>
        ) : null}
        {parsed && !parsed.ok ? (
          <p role="alert" className="text-crit text-sm">
            {parsed.message}
          </p>
        ) : null}
        {errors.csv ? <p className="text-crit text-sm">{errors.csv}</p> : null}
      </fieldset>

      {parsed?.ok ? (
        <section aria-labelledby="csv-confirm" className="flex flex-col gap-3">
          <h2 id="csv-confirm" className="text-base font-bold">
            Confirm the fields
          </h2>
          <p className="text-muted-foreground text-sm">
            {rows.length === 1 ? '1 row' : `${rows.length.toLocaleString('en-GB')} rows`} will
            become {basics.values.itemLabel.toLowerCase() || 'item'}s named from “
            {parsed.table.header[0]}”. Check the type of each column; a value that does not fit its
            type is left empty.
          </p>
          {plan.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              The file has only one column, so no fields will be created.
            </p>
          ) : (
            <div className="border-line overflow-x-auto rounded-[var(--radius-card)] border bg-white">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-soft">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Field
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Type
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Examples
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {plan.map((c, i) => (
                    <tr key={c.index} className="border-line border-t">
                      <td className="px-3 py-2">
                        <Input
                          aria-label={`Name of column ${c.index + 1}`}
                          value={chosen[i]?.name ?? c.name}
                          maxLength={80}
                          onChange={(e) => setCol(i, { name: e.target.value })}
                        />
                      </td>
                      <td className="w-48 px-3 py-2">
                        <TypeSelect
                          label={`Type of ${chosen[i]?.name || c.name}`}
                          families={IMPORTABLE}
                          value={chosen[i]?.type ?? c.type}
                          onChange={(type) => setCol(i, { type })}
                        />
                      </td>
                      <td className="text-muted-foreground max-w-60 truncate px-3 py-2">
                        {examples(c.index) || 'Empty'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      <div>
        <Button type="submit" disabled={pending || !parsed?.ok || !!basics.prefixProblem}>
          {pending ? 'Importing…' : 'Import and create sheet'}
        </Button>
      </div>
    </form>
  );
}
