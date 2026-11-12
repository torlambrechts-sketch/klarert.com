'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Link2, Link2Off } from 'lucide-react';
import QRCode from 'qrcode';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { createFormLinkAction, disableFormLinkAction } from '@/app/[org]/s/view-actions';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Field } from '@/engine/types';
import {
  emptyConfig,
  type FormFieldLayout,
  type FormLayout,
  type ViewConfig,
} from '@/engine/views/config';
import {
  checkFormAnswers,
  defaultFormLayout,
  formFieldChoices,
  formQuestions,
} from '@/engine/views/form';
import { inputClass } from '@/components/fields/shared';
import { byPosition, positionsAtEnd } from '@/components/table/table-model';
import type { SheetActions } from '@/components/grid/use-sheet';
import { Button } from '@/components/ui/button';
import { env } from '@/lib/env';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { FormFill } from './form-fill';
import type { ActiveView, ViewsState } from './use-views';

// Form view (docs/05 §3.3, FR-25): the builder on the left (fields on or off, order, label, help, required; only
// types allowed on forms), a live preview at phone width on the right that is also the internal form, and the
// public link with "Copy public link", "Disable link" and a QR code made in the browser.

export function FormView({
  org,
  data,
  ctx,
  actions,
  view,
  config,
  setConfig,
  views,
  canEdit,
}: {
  org: string;
  data: SheetData;
  ctx: Ctx;
  actions: SheetActions;
  view: ActiveView;
  config: ViewConfig;
  setConfig(update: (c: ViewConfig) => ViewConfig): void;
  views: ViewsState;
  canEdit: boolean;
}) {
  if (!view.saved)
    return (
      <div className="border-line flex flex-col items-start gap-3 rounded-[var(--radius-card)] border border-dashed p-6 text-sm">
        <p>
          No form yet. A form lets people add {data.sheet.itemLabel.toLowerCase()}s without opening
          the sheet, signed in or through a public link.
        </p>
        {canEdit ? (
          <Button
            type="button"
            onClick={() =>
              void views.create({
                name: 'Form',
                type: 'form',
                shared: true,
                config: { ...emptyConfig(), form: defaultFormLayout(data.fields) },
              })
            }
          >
            Create a form
          </Button>
        ) : (
          <p className="text-muted-foreground">Ask an editor to create one.</p>
        )}
      </div>
    );
  const layout = config.form ?? { fields: [] };
  return (
    <div className="grid min-h-0 flex-1 gap-4 overflow-auto lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Builder
          fields={data.fields}
          groups={data.groups}
          layout={layout}
          readOnly={!view.canWrite}
          itemLabel={data.sheet.itemLabel}
          onChange={(form) => setConfig((c) => ({ ...c, form }))}
        />
        <PublicLink
          org={org}
          viewId={view.saved.id}
          shared={view.saved.ownerId === null}
          canEdit={canEdit}
        />
      </div>
      <Preview
        data={data}
        ctx={ctx}
        actions={actions}
        layout={layout}
        viewId={view.saved.id}
        canEdit={canEdit}
      />
    </div>
  );
}

function Builder({
  fields,
  groups,
  layout,
  readOnly,
  itemLabel,
  onChange,
}: {
  fields: Field[];
  groups: SheetData['groups'];
  layout: FormLayout;
  readOnly: boolean;
  itemLabel: string;
  onChange(l: FormLayout): void;
}) {
  const id = useId();
  const choices = formFieldChoices(fields);
  const on = layout.fields.filter((q) => choices.some((f) => f.key === q.key));
  const off = choices.filter((f) => !on.some((q) => q.key === f.key));
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const setQ = (key: string, patch: Partial<FormFieldLayout>) =>
    onChange({ ...layout, fields: on.map((q) => (q.key === key ? { ...q, ...patch } : q)) });
  const move = (i: number, by: number) => {
    const next = [...on];
    const [q] = next.splice(i, 1);
    next.splice(i + by, 0, q!);
    onChange({ ...layout, fields: next });
  };
  const sortedGroups = [...groups].sort((a, b) => (a.position < b.position ? -1 : 1));
  return (
    <section
      aria-labelledby={`${id}-h`}
      className="border-line flex flex-col gap-3 rounded-[var(--radius-card)] border p-4"
    >
      <h2 id={`${id}-h`} className="text-base font-bold">
        Form builder
      </h2>
      {readOnly ? (
        <p className="text-muted-foreground text-sm">Only editors can change this form.</p>
      ) : null}
      <fieldset disabled={readOnly} className="flex flex-col gap-3">
        <legend className="sr-only">Form settings</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Title
            <input
              className={cn(inputClass, 'font-normal')}
              value={layout.title ?? ''}
              maxLength={200}
              placeholder="The sheet name"
              onChange={(e) => onChange({ ...layout, title: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            New items go to
            <select
              className={cn(inputClass, 'font-normal')}
              value={layout.groupId ?? ''}
              onChange={(e) => onChange({ ...layout, groupId: e.target.value || null })}
            >
              <option value="">First group ({sortedGroups[0]?.name ?? 'none'})</option>
              {sortedGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Description
          <textarea
            className={cn(inputClass, 'h-16 py-1 font-normal')}
            value={layout.description ?? ''}
            maxLength={2000}
            onChange={(e) => onChange({ ...layout, description: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Name question
          <input
            className={cn(inputClass, 'font-normal')}
            value={layout.nameLabel ?? ''}
            maxLength={200}
            placeholder={itemLabel}
            onChange={(e) => onChange({ ...layout, nameLabel: e.target.value })}
          />
        </label>
        <h3 className="text-sm font-bold">Questions on the form</h3>
        {on.length === 0 ? (
          <p className="text-muted-foreground text-sm">Only the name is asked. Add fields below.</p>
        ) : null}
        <ol className="flex flex-col gap-2">
          {on.map((q, i) => {
            const f = byKey.get(q.key)!;
            return (
              <li key={q.key} className="border-line flex flex-col gap-2 rounded-md border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked
                      onChange={() =>
                        onChange({ ...layout, fields: on.filter((x) => x.key !== q.key) })
                      }
                    />
                    {f.name}
                  </label>
                  <label className="ml-auto flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={q.required ?? f.required}
                      onChange={(e) => setQ(q.key, { required: e.target.checked })}
                    />
                    Required
                  </label>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Move ${f.name} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Move ${f.name} down`}
                    disabled={i === on.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    aria-label={`${f.name} label`}
                    className={inputClass}
                    value={q.label ?? ''}
                    maxLength={200}
                    placeholder={f.name}
                    onChange={(e) => setQ(q.key, { label: e.target.value })}
                  />
                  <input
                    aria-label={`${f.name} help text`}
                    className={inputClass}
                    value={q.help ?? ''}
                    maxLength={1000}
                    placeholder="Help text"
                    onChange={(e) => setQ(q.key, { help: e.target.value })}
                  />
                </div>
              </li>
            );
          })}
        </ol>
        {off.length ? (
          <>
            <h3 className="text-sm font-bold">Not on the form</h3>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {off.map((f) => (
                <li key={f.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() =>
                        onChange({
                          ...layout,
                          fields: [...on, { key: f.key, required: f.required || undefined }],
                        })
                      }
                    />
                    {f.name}
                  </label>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <p className="text-muted-foreground text-xs">
          Calculated fields, links, files and other values the app keeps cannot be asked on a form.
        </p>
      </fieldset>
    </section>
  );
}

function PublicLink({
  org,
  viewId,
  shared,
  canEdit,
}: {
  org: string;
  viewId: string;
  shared: boolean;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const key = ['form-link', viewId];
  const link = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('form_links')
        .select('id, token, enabled')
        .eq('view_id', viewId)
        .eq('enabled', true)
        .limit(1);
      if (error) throw new Error(error.message);
      return data?.[0] ?? null;
    },
  });
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const url = link.data
    ? `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/f/${link.data.token}`
    : null;
  useEffect(() => {
    if (!url) return setQr(null);
    let alive = true;
    QRCode.toDataURL(url, { margin: 1, width: 160 })
      .then((d) => alive && setQr(d))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [url]);

  return (
    <section className="border-line flex flex-col gap-3 rounded-[var(--radius-card)] border p-4">
      <h2 className="text-base font-bold">Public link</h2>
      {link.isPending ? (
        <div aria-busy="true" className="bg-soft h-9 animate-pulse rounded" />
      ) : link.isError ? (
        <div role="alert" className="flex items-center gap-2 text-sm">
          The link could not be loaded.
          <Button type="button" size="sm" variant="outline" onClick={() => void link.refetch()}>
            Retry
          </Button>
        </div>
      ) : url ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-muted-foreground text-sm">
              Anyone with this link can send the form without signing in. At most 10 answers per
              minute from one network.
            </p>
            <input
              aria-label="Public link"
              readOnly
              className={cn(inputClass, 'font-mono text-xs')}
              value={url}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    toast('Public link copied.');
                  } catch {
                    toast.error('The link could not be copied. Select it and copy it yourself.');
                  }
                }}
              >
                <Copy aria-hidden /> Copy public link
              </Button>
              {canEdit ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const r = await disableFormLinkAction({ org, linkId: link.data!.id });
                    setBusy(false);
                    if (!r.ok) return void toast.error(r.error.message);
                    qc.setQueryData(key, null);
                    toast('Link disabled. It no longer opens the form.');
                  }}
                >
                  <Link2Off aria-hidden /> Disable link
                </Button>
              ) : null}
            </div>
          </div>
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qr}
              width={160}
              height={160}
              alt="QR code of the public link"
              className="border-line rounded border"
            />
          ) : (
            <div className="bg-soft size-40 rounded" aria-hidden />
          )}
        </div>
      ) : canEdit && shared ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-muted-foreground text-sm">
            No public link. Create one to share the form.
          </p>
          <Button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await createFormLinkAction({ org, viewId });
              setBusy(false);
              if (!r.ok) return void toast.error(r.error.message);
              qc.setQueryData(key, r.data.link);
              toast('Public link created.');
            }}
          >
            <Link2 aria-hidden /> Create public link
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          {shared
            ? 'No public link. Ask an editor to create one.'
            : 'Share this view to publish a public link.'}
        </p>
      )}
    </section>
  );
}

function Preview({
  data,
  ctx,
  actions,
  layout,
  viewId,
  canEdit,
}: {
  data: SheetData;
  ctx: Ctx;
  actions: SheetActions;
  layout: FormLayout;
  viewId: string;
  canEdit: boolean;
}) {
  const questions = useMemo(() => formQuestions(layout, data.fields), [layout, data.fields]);
  const nameLabel = layout.nameLabel?.trim() || data.sheet.itemLabel;
  const [name, setName] = useState('');
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const groupId =
    layout.groupId && data.groups.some((g) => g.id === layout.groupId)
      ? layout.groupId
      : [...data.groups].sort((a, b) => (a.position < b.position ? -1 : 1))[0]?.id;
  return (
    <section aria-label="Preview" className="flex flex-col gap-2">
      <h2 className="text-base font-bold">Preview</h2>
      <p className="text-muted-foreground text-xs">
        {canEdit ? 'Fill it in here to add an item as yourself.' : 'How the form looks on a phone.'}
      </p>
      <form
        noValidate
        className="border-line mx-auto flex w-full max-w-[390px] flex-col gap-4 rounded-[var(--radius-card)] border bg-white p-4 shadow-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!canEdit || !groupId) return;
          const check = checkFormAnswers(questions, name, answers, ctx, nameLabel);
          setErrors(check.errors);
          if (Object.keys(check.errors).length) return;
          setSending(true);
          const list = data.items.filter((i) => i.groupId === groupId).sort(byPosition);
          const [position] = positionsAtEnd(list, 1);
          const item = await actions.createItem(groupId, name.trim(), position!, undefined, {
            values: check.values,
            formViewId: viewId,
          });
          setSending(false);
          if (item) {
            toast(`Sent. ${item.displayId} was added.`);
            setName('');
            setAnswers({});
          }
        }}
      >
        <header className="flex flex-col gap-1">
          <p className="text-lg font-extrabold">{layout.title?.trim() || data.sheet.name}</p>
          {layout.description?.trim() ? (
            <p className="text-muted-foreground text-sm whitespace-pre-line">
              {layout.description}
            </p>
          ) : null}
        </header>
        <FormFill
          questions={questions}
          ctx={ctx}
          nameLabel={nameLabel}
          name={name}
          onName={setName}
          answers={answers}
          onAnswer={(fid, v) => setAnswers((a) => ({ ...a, [fid]: v }))}
          errors={errors}
          disabled={sending || !canEdit}
        />
        {canEdit ? (
          <div>
            <Button type="submit" disabled={sending}>
              {sending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        ) : null}
      </form>
    </section>
  );
}
