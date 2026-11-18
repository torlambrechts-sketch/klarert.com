'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Copy, FileText, Globe, Lock, MoreHorizontal, Plus } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  copyFormToSheetAction,
  createFormAction,
  deleteFormAction,
  duplicateFormAction,
  saveFormAction,
} from '@/app/[org]/s/view-actions';
import { formatDateTime } from '@/engine/fields/helpers';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx } from '@/engine/types';
import type { FormAccess, SavedView } from '@/engine/views/config';
import { formAccess, formState, formStatus } from '@/engine/views/form';
import { inputClass } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { fetchAllPages } from '@/lib/sheet-query';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { FillForm, FormBuilder, StatusChip } from './form-builder';
import { copyText, internalUrl, publicUrl, type FormLinkRow } from './form-share';
import { viewsKey, type ViewsState } from './use-views';
import { itemsWord } from '@/engine/nouns';

// The Forms tab (docs/05 §3.3): every form of the sheet as a card (status, Public/Internal, link, answers, last
// answer). Owners and admins open a card to build the form and use its menu (duplicate, copy to another sheet,
// close or reopen, delete); editors open it to fill it in. The tab id stays `form`; ?form=<id> picks a form.

const formLinksKey = (sheetId: string) => ['form-links', sheetId] as const;

/** The sheet's live form links by form (view) id. Also read by the Design tab's form builder (docs/05 §3.8). */
export function useFormLinks(sheetId: string) {
  return useQuery({
    queryKey: formLinksKey(sheetId),
    queryFn: async () => {
      const { data: rows, error } = await createClient()
        .from('form_links')
        .select('id, token, enabled, view_id')
        .eq('sheet_id', sheetId)
        .eq('enabled', true);
      if (error) throw new Error(error.message);
      return new Map((rows ?? []).map((r) => [r.view_id ?? '', r]));
    },
  });
}

/** Keep a form's link in the cache after Share creates, regenerates or disables it. */
export function useSetFormLink(sheetId: string) {
  const qc = useQueryClient();
  return (viewId: string, link: FormLinkRow | null) =>
    qc.setQueryData<Map<string, FormLinkRow & { view_id: string | null }>>(
      formLinksKey(sheetId),
      (m) => {
        const next = new Map(m ?? []);
        if (link) next.set(viewId, { ...link, view_id: viewId });
        else next.delete(viewId);
        return next;
      },
    );
}
const formStatsKey = (sheetId: string) => ['form-stats', sheetId] as const;

export function FormView({
  org,
  data,
  ctx,
  views,
  canEdit,
  isAdmin,
}: {
  org: string;
  data: SheetData;
  ctx: Ctx;
  views: ViewsState;
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const sheetId = data.sheet.id;
  const qc = useQueryClient();
  const search = useSearchParams();
  const viewParam = search.get('view');
  const selectedId =
    search.get('form') ??
    (viewParam && views.tabs.forms.some((f) => f.id === viewParam) ? viewParam : null);
  const forms = views.tabs.forms.map((f) => f.saved!).filter(Boolean);
  const selected = forms.find((f) => f.id === selectedId) ?? null;

  const links = useFormLinks(sheetId);
  const stats = useQuery({
    queryKey: formStatsKey(sheetId),
    queryFn: async () => {
      const { data: rows, error } = await createClient().rpc('form_stats', { p_sheet: sheetId });
      if (error) throw new Error(error.message);
      return new Map((rows ?? []).map((r) => [r.view_id, r]));
    },
  });
  const setLink = useSetFormLink(sheetId);

  const go = (formId: string | null) => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'form');
    if (formId) url.searchParams.set('form', formId);
    else url.searchParams.delete('form');
    window.history.pushState(null, '', url.toString());
  };

  if (views.query.isError)
    return (
      <div role="alert" className="text-13 flex items-center gap-2 py-6">
        The forms could not be loaded.
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void views.query.refetch()}
        >
          Retry
        </Button>
      </div>
    );

  if (selected) {
    const link = links.data?.get(selected.id) ?? null;
    if (isAdmin)
      return (
        <FormBuilder
          key={selected.id}
          org={org}
          data={data}
          ctx={ctx}
          view={selected}
          link={link}
          onLink={(l) => setLink(selected.id, l)}
          onSaved={(v) => views.upsert(v)}
          onBack={() => go(null)}
        />
      );
    const form = selected.config.form ?? { fields: [] };
    const state = formState(form, ctx.now, Number(stats.data?.get(selected.id)?.responses ?? 0));
    return (
      <div className="flex flex-col gap-4 py-2">
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => go(null)}>
            <ArrowLeft aria-hidden /> All forms
          </Button>
        </div>
        <div className="border-line bg-surface mx-auto w-full max-w-[560px] rounded-lg border p-5">
          {canEdit && state === 'open' ? (
            <FillForm
              org={org}
              viewId={selected.id}
              ctx={ctx}
              form={form}
              fields={data.fields}
              title={form.title?.trim() || selected.name}
              nameLabel={form.nameLabel?.trim() || data.sheet.itemLabel}
              canSend
              onSent={() => void qc.invalidateQueries({ queryKey: formStatsKey(sheetId) })}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <h2 className="text-panel-title">{form.title?.trim() || selected.name}</h2>
              <p className="text-13 text-muted-foreground">
                {!canEdit
                  ? 'Viewers cannot send forms. Ask an editor or admin.'
                  : state === 'draft'
                    ? 'This form is a draft. It takes answers once an owner or admin opens it.'
                    : 'This form does not take answers right now.'}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <FormsList
      org={org}
      data={data}
      ctx={ctx}
      forms={forms}
      loading={views.query.isPending}
      links={links.data}
      stats={stats.data}
      statsLoading={stats.isPending}
      isAdmin={isAdmin}
      onOpen={go}
      onCreated={(v) => {
        views.upsert(v);
        go(v.id);
      }}
      onChanged={(v) => views.upsert(v)}
      onDeleted={(id) => {
        qc.setQueryData<SavedView[]>(viewsKey(sheetId), (l) => l?.filter((v) => v.id !== id));
        setLink(id, null);
      }}
    />
  );
}

function FormsList({
  org,
  data,
  ctx,
  forms,
  loading,
  links,
  stats,
  statsLoading,
  isAdmin,
  onOpen,
  onCreated,
  onChanged,
  onDeleted,
}: {
  org: string;
  data: SheetData;
  ctx: Ctx;
  forms: SavedView[];
  loading: boolean;
  links?: Map<string, FormLinkRow>;
  stats?: Map<string, { responses: number; last_at: string }>;
  statsLoading: boolean;
  isAdmin: boolean;
  onOpen(id: string): void;
  onCreated(v: SavedView): void;
  onChanged(v: SavedView): void;
  onDeleted(id: string): void;
}) {
  // ?newform=1 (Create › Form, docs/05 §4 Create): "New form" opens at once for owners and admins
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('newform') !== '1') return;
    url.searchParams.delete('newform');
    window.history.replaceState(window.history.state, '', url);
    if (isAdmin) setCreating(true);
  }, [isAdmin]);
  const [copying, setCopying] = useState<SavedView | null>(null);
  const [deleting, setDeleting] = useState<SavedView | null>(null);

  const setStatus = async (v: SavedView, status: 'open' | 'closed') => {
    const r = await saveFormAction({
      org,
      viewId: v.id,
      form: { ...(v.config.form ?? { fields: [] }), status },
    });
    if (!r.ok) return void toast.error(r.error.message);
    onChanged(r.data.view);
    toast(status === 'closed' ? 'Form closed. It no longer takes answers.' : 'Form reopened.');
  };

  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-panel-title">Forms</h2>
          <p className="text-13 text-muted-foreground">
            Each form adds {itemsWord(data.sheet.itemLabel)} to this sheet.
          </p>
        </div>
        {isAdmin ? (
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New form
          </Button>
        ) : null}
      </div>
      {loading ? (
        <ul
          aria-busy="true"
          aria-label="Loading forms"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          {[0, 1, 2].map((i) => (
            <li key={i} className="bg-soft h-[148px] animate-pulse rounded-lg" />
          ))}
        </ul>
      ) : forms.length === 0 ? (
        <div className="border-line flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
          <FileText className="text-muted-foreground size-5" aria-hidden />
          <p className="text-14">No forms yet. Collect items from people without sheet access.</p>
          {isAdmin ? (
            <Button type="button" onClick={() => setCreating(true)}>
              <Plus aria-hidden /> New form
            </Button>
          ) : (
            <p className="text-13 text-muted-foreground">Ask an owner or admin to create one.</p>
          )}
        </div>
      ) : (
        <ul aria-label="Forms" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {forms.map((v) => {
            const form = v.config.form ?? { fields: [] };
            const access = formAccess(form);
            const st = stats?.get(v.id);
            const responses = Number(st?.responses ?? 0);
            const state = formState(form, ctx.now, responses);
            const link = links?.get(v.id);
            const url =
              access === 'internal'
                ? internalUrl(org, data.sheet.id, v.id)
                : link
                  ? publicUrl(link.token)
                  : null;
            return (
              <li
                key={v.id}
                className="border-line bg-surface hover:border-line-strong relative flex flex-col gap-3 rounded-lg border p-4"
              >
                <div className="flex items-start gap-2">
                  <h3 className="text-16 min-w-0 flex-1 font-semibold">
                    <button
                      type="button"
                      onClick={() => onOpen(v.id)}
                      className="focus-visible:outline-focus text-left after:absolute after:inset-0 after:rounded-lg focus-visible:outline-2"
                    >
                      {v.name}
                    </button>
                  </h3>
                  {isAdmin ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          className="relative z-10"
                          aria-label={`Actions for ${v.name}`}
                        >
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={async () => {
                            const r = await duplicateFormAction({
                              org,
                              viewId: v.id,
                              name: `${v.name} (copy)`.slice(0, 60),
                            });
                            if (!r.ok) return void toast.error(r.error.message);
                            onChanged(r.data.view);
                            toast('Form duplicated as a draft.');
                          }}
                        >
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setCopying(v)}>
                          Copy to another sheet
                        </DropdownMenuItem>
                        {formStatus(form) === 'closed' ? (
                          <DropdownMenuItem onSelect={() => void setStatus(v, 'open')}>
                            Reopen
                          </DropdownMenuItem>
                        ) : formStatus(form) === 'open' ? (
                          <DropdownMenuItem onSelect={() => void setStatus(v, 'closed')}>
                            Close
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-crit" onSelect={() => setDeleting(v)}>
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusChip status={state} />
                  <span className="border-line text-12 inline-flex items-center gap-1 rounded-full border px-2 py-0.5">
                    {access === 'public' ? (
                      <Globe className="size-3" aria-hidden />
                    ) : (
                      <Lock className="size-3" aria-hidden />
                    )}
                    {access === 'public' ? 'Public' : 'Internal'}
                  </span>
                </div>
                <p className="text-13 text-muted-foreground min-h-5">
                  {statsLoading
                    ? 'Counting answers…'
                    : responses === 0
                      ? 'No answers yet'
                      : `${responses} ${responses === 1 ? 'answer' : 'answers'} · last ${formatDateTime(st!.last_at, ctx.timeZone)}`}
                </p>
                <div className="relative z-10 flex min-h-8 items-center gap-1.5">
                  {url ? (
                    <>
                      <span className="text-12 text-muted-foreground min-w-0 flex-1 truncate font-mono">
                        {url.replace(/^https?:\/\//, '')}
                      </span>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Copy the link to ${v.name}`}
                        onClick={() => void copyText(url, 'Link copied.')}
                      >
                        <Copy aria-hidden />
                      </Button>
                    </>
                  ) : (
                    <span className="text-12 text-muted-foreground">No public link yet</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <NewFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        org={org}
        sheetId={data.sheet.id}
        onCreated={(v) => {
          setCreating(false);
          onCreated(v);
          toast('Form created as a draft.');
        }}
      />
      <CopyFormDialog
        org={org}
        orgId={data.sheet.orgId}
        sheetId={data.sheet.id}
        form={copying}
        onClose={() => setCopying(null)}
      />
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="w-[min(440px,calc(100vw-32px))]">
          <DialogTitle className="text-panel-title">Delete {deleting?.name}</DialogTitle>
          <DialogDescription className="text-13">
            The form and its link go. People who open the link see that the form is not available.
            Items it added stay in the sheet.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={async () => {
                const v = deleting!;
                const r = await deleteFormAction({ org, viewId: v.id });
                setDeleting(null);
                if (!r.ok) return void toast.error(r.error.message);
                onDeleted(v.id);
                toast('Form deleted. Its link no longer works.');
              }}
            >
              Delete form
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function NewFormDialog({
  open,
  onClose,
  org,
  sheetId,
  onCreated,
}: {
  open: boolean;
  onClose(): void;
  org: string;
  sheetId: string;
  onCreated(v: SavedView): void;
}) {
  const [name, setName] = useState('');
  const [access, setAccess] = useState<FormAccess>('public');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(440px,calc(100vw-32px))]">
        <DialogTitle className="text-panel-title">New form</DialogTitle>
        <DialogDescription className="text-13 text-muted-foreground">
          It starts as a draft. Open it when it is ready.
        </DialogDescription>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await createFormAction({ org, sheetId, name, access });
            setBusy(false);
            if (!r.ok) return setError(r.error.fieldErrors?.name ?? r.error.message);
            setName('');
            setError(null);
            onCreated(r.data.view);
          }}
        >
          <label className="text-13 flex flex-col gap-1 font-semibold">
            Name
            <input
              className={cn(inputClass, 'h-9 font-normal')}
              value={name}
              maxLength={60}
              aria-invalid={!!error}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-13 mb-1 font-semibold">Who fills it in</legend>
            <label className="text-13 flex items-center gap-2">
              <input
                type="radio"
                name="new-form-access"
                checked={access === 'public'}
                onChange={() => setAccess('public')}
              />
              Public: anyone with the link
            </label>
            <label className="text-13 flex items-center gap-2">
              <input
                type="radio"
                name="new-form-access"
                checked={access === 'internal'}
                onChange={() => setAccess('internal')}
              />
              Internal only: signed-in members
            </label>
          </fieldset>
          {error ? (
            <p role="alert" className="text-crit text-13">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Create form
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CopyFormDialog({
  org,
  orgId,
  sheetId,
  form,
  onClose,
}: {
  org: string;
  orgId: string;
  sheetId: string;
  form: SavedView | null;
  onClose(): void;
}) {
  // this workspace's other sheets, not archived and not sub-item sheets; every page, not just the API's first 1000 rows
  const sheets = useQuery({
    queryKey: ['form-copy-sheets', orgId, sheetId],
    enabled: !!form,
    queryFn: () => {
      const db = createClient();
      return fetchAllPages((from, to) =>
        db
          .from('sheets')
          .select('id, name')
          .eq('org_id', orgId)
          .is('archived_at', null)
          .is('parent_sheet_id', null)
          .neq('id', sheetId)
          .order('name')
          .order('id')
          .range(from, to),
      );
    },
  });
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const choices = useMemo(() => sheets.data ?? [], [sheets.data]);
  return (
    <Dialog open={!!form} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(440px,calc(100vw-32px))]">
        <DialogTitle className="text-panel-title">Copy {form?.name} to another sheet</DialogTitle>
        <DialogDescription className="text-13 text-muted-foreground">
          Questions are matched by field key. Fields the other sheet does not have are left out. The
          copy is a draft without a link.
        </DialogDescription>
        {sheets.isPending ? (
          <div aria-busy="true" className="bg-soft h-9 animate-pulse rounded" />
        ) : sheets.isError ? (
          <div role="alert" className="text-13 flex items-center gap-2">
            The sheets could not be loaded.
            <Button type="button" size="sm" variant="outline" onClick={() => void sheets.refetch()}>
              Retry
            </Button>
          </div>
        ) : choices.length === 0 ? (
          <p className="text-13">There is no other sheet in this workspace.</p>
        ) : (
          <label className="text-13 flex flex-col gap-1 font-semibold">
            Sheet
            <select
              className={cn(inputClass, 'h-9 font-normal')}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">Choose a sheet</option>
              {choices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!target || busy}
            onClick={async () => {
              setBusy(true);
              const r = await copyFormToSheetAction({
                org,
                viewId: form!.id,
                targetSheetId: target,
                name: form!.name,
              });
              setBusy(false);
              if (!r.ok) return void toast.error(r.error.message);
              const sheet = choices.find((s) => s.id === target)?.name ?? 'the sheet';
              toast(`Copied to ${sheet}.`, {
                description: r.data.missing.length
                  ? `Left out (not on ${sheet}): ${r.data.missing.join(', ')}.`
                  : 'Every question was copied.',
              });
              setTarget('');
              onClose();
            }}
          >
            Copy form
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
