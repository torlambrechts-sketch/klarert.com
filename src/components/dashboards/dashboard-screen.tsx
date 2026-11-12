'use client';

import { useId, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  ChartColumn,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  createDashboardAction,
  deleteDashboardAction,
  updateDashboardAction,
} from '@/app/[org]/dashboards/actions';
import { PERIODS, WIDGET_TYPES, type WidgetConfig } from '@/engine/dashboards';
import { inputClass } from '@/components/fields/shared';
import { PageHeader, PageTabs } from '@/components/shell/page-header';
import { ShellCrumb } from '@/components/shell/shell-crumb';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Dashboard } from '@/lib/sheet-rows';
import { cn } from '@/lib/utils';
import type { DashboardView } from '@/server/repositories/dashboards';
import { KeyFigures } from './key-figures';
import { WidgetBody, resultMeta } from './widget-card';
import { WidgetDialog, type WidgetEditorData } from './widget-dialog';

// One dashboard (docs/05 §4, design "Compliance overview"): the crumb in the top bar, the header with Add widget and
// a menu (Rename, New dashboard, Delete), tabs for the workspace's dashboards, the period switch when a widget
// follows it, then the widgets as cards in a grid of columns at least 320 px wide (key figures take the whole row).
// Each card has a menu to edit, move or remove it. Every change is one updateDashboard command; the page then
// renders again. The period is a view setting in the URL (?months=), not a write.

export function DashboardScreen({
  org,
  dashboards,
  dashboard,
  view,
  months,
  canEdit,
  editor,
}: {
  org: string;
  dashboards: { id: string; name: string }[];
  dashboard: Dashboard;
  view: DashboardView | null;
  months: number;
  canEdit: boolean;
  editor: WidgetEditorData | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [widgetDialog, setWidgetDialog] = useState<{ widget?: WidgetConfig } | null>(null);
  const [nameDialog, setNameDialog] = useState<'rename' | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const widgets = dashboard.widgets;
  const usesPeriod = widgets.some((w) => WIDGET_TYPES[w.type]?.usesPeriod);
  const refresh = () => startTransition(() => router.refresh());

  const saveWidgets = async (next: WidgetConfig[]) => {
    const r = await updateDashboardAction({ org, dashboardId: dashboard.id, widgets: next });
    if (!r.ok) {
      toast.error(r.error.message);
      return false;
    }
    refresh();
    return true;
  };
  const move = (i: number, by: -1 | 1) => {
    const next = [...widgets];
    const [w] = next.splice(i, 1);
    next.splice(i + by, 0, w!);
    void saveWidgets(next);
  };

  const actions = canEdit ? (
    <>
      <Button type="button" onClick={() => setWidgetDialog({})} disabled={!editor}>
        <Plus aria-hidden /> Add widget
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-[40px]"
            aria-label="Dashboard options"
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setNameDialog('rename')}>
            <Pencil aria-hidden /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setNameDialog('new')}>
            <Plus aria-hidden /> New dashboard
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden /> Delete dashboard
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  ) : null;

  return (
    <main
      className="mx-auto flex w-full max-w-[1184px] flex-col gap-4 px-4 pt-6 pb-8 sm:px-7 sm:pt-[42px]"
      aria-busy={pending}
    >
      <ShellCrumb>
        <nav aria-label="Breadcrumb" className="text-label-14 flex min-w-0 items-center gap-2.5">
          <span className="text-muted-foreground flex items-center gap-2">
            <ChartColumn className="size-[15px] shrink-0" aria-hidden />
            Insights
          </span>
          <span aria-hidden className="text-line-strong text-label-20 leading-none font-light">
            /
          </span>
          <span className="text-ink flex min-w-0 items-center gap-2" aria-current="page">
            <LayoutGrid className="size-[15px] shrink-0" aria-hidden />
            <span className="truncate font-medium">{dashboard.name}</span>
          </span>
          <span className="bg-soft text-muted-foreground text-label-12 shrink-0 rounded-full px-[9px] py-0.5 font-medium">
            Dashboard
          </span>
        </nav>
      </ShellCrumb>
      <PageHeader
        className="pb-0.5"
        title={dashboard.name}
        description="Widgets read live from your sheets, the evidence library and the run log."
        actions={actions}
      />
      {dashboards.length > 1 ? (
        <PageTabs
          label="Dashboards"
          active={dashboard.id}
          tabs={dashboards.map((d) => ({
            id: d.id,
            label: d.name,
            href: `/${org}/dashboards/${d.id}`,
          }))}
        />
      ) : null}
      {usesPeriod && view ? <PeriodSwitch months={months} /> : null}

      {!view ? (
        <div
          role="alert"
          className="border-line bg-background-100 flex flex-col items-start gap-2 rounded-lg border p-5"
        >
          <p className="m-0">The widgets could not be loaded.</p>
          <Button type="button" variant="outline" onClick={refresh}>
            <RotateCcw aria-hidden /> Retry
          </Button>
        </div>
      ) : widgets.length === 0 ? (
        <div className="border-line bg-background-100 flex flex-col items-start gap-2 rounded-lg border border-dashed p-6">
          <p className="text-muted-foreground m-0">
            No widgets yet.{canEdit ? ' Add the first one.' : ''}
          </p>
          {canEdit && editor ? (
            <Button type="button" variant="outline" onClick={() => setWidgetDialog({})}>
              <Plus aria-hidden /> Add widget
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-x-4 gap-y-8 p-0">
          {widgets.map((w, i) => (
            <WidgetCard
              key={w.id}
              org={org}
              widget={w}
              view={view}
              canEdit={canEdit && !!editor}
              first={i === 0}
              last={i === widgets.length - 1}
              onEdit={() => setWidgetDialog({ widget: w })}
              onMove={(by) => move(i, by)}
              onRemove={() => void saveWidgets(widgets.filter((x) => x.id !== w.id))}
            />
          ))}
        </ul>
      )}

      {editor ? (
        <WidgetDialog
          open={!!widgetDialog}
          initial={widgetDialog?.widget}
          editor={editor}
          onCancel={() => setWidgetDialog(null)}
          onSave={async (w) => {
            const exists = widgets.some((x) => x.id === w.id);
            const ok = await saveWidgets(
              exists ? widgets.map((x) => (x.id === w.id ? w : x)) : [...widgets, w],
            );
            if (ok) {
              setWidgetDialog(null);
              toast(exists ? 'Widget saved.' : 'Widget added.');
            }
            return ok;
          }}
        />
      ) : null}
      <NameDialog
        mode={nameDialog}
        initial={nameDialog === 'rename' ? dashboard.name : ''}
        onCancel={() => setNameDialog(null)}
        onSubmit={async (name) => {
          if (nameDialog === 'rename') {
            const r = await updateDashboardAction({ org, dashboardId: dashboard.id, name });
            if (!r.ok) return void toast.error(r.error.message);
            setNameDialog(null);
            refresh();
          } else {
            const r = await createDashboardAction({ org, name });
            if (!r.ok) return void toast.error(r.error.message);
            setNameDialog(null);
            router.push(`/${org}/dashboards/${r.data.dashboard.id}`);
          }
        }}
      />
      <Dialog open={confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(false)}>
        <DialogContent>
          <DialogTitle className="text-heading-16">Delete this dashboard?</DialogTitle>
          <DialogDescription className="text-muted-foreground text-label-13">
            {dashboard.name} and its widgets are removed for everyone. Your sheets and items stay as
            they are.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={async () => {
                const r = await deleteDashboardAction({ org, dashboardId: dashboard.id });
                if (!r.ok) return void toast.error(r.error.message);
                setConfirmDelete(false);
                toast('Dashboard deleted.');
                router.push(`/${org}/dashboards`);
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}

/** 3, 6 or 12 months: links that set ?months= (keyboard reachable, the current one marked). */
function PeriodSwitch({ months }: { months: number }) {
  return (
    <nav aria-label="Period" className="mt-[19px] mb-5 flex flex-wrap items-center gap-2">
      <ul className="border-line bg-background-100 m-0 inline-flex h-[40px] list-none gap-0.5 rounded-md border p-0.5">
        {PERIODS.map((p) => (
          <li key={p} className="flex">
            <Link
              href={`?months=${p}`}
              scroll={false}
              aria-current={p === months ? 'true' : undefined}
              className="text-muted-foreground hover:text-ink aria-[current=true]:bg-soft aria-[current=true]:text-ink text-label-14 inline-flex items-center rounded px-3 whitespace-nowrap no-underline aria-[current=true]:font-medium"
            >
              {p} months
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function WidgetCard({
  org,
  widget,
  view,
  canEdit,
  first,
  last,
  onEdit,
  onMove,
  onRemove,
}: {
  org: string;
  widget: WidgetConfig;
  view: DashboardView;
  canEdit: boolean;
  first: boolean;
  last: boolean;
  onEdit(): void;
  onMove(by: -1 | 1): void;
  onRemove(): void;
}) {
  const headingId = useId();
  const def = WIDGET_TYPES[widget.type];
  const result = view.results[widget.id];
  const sheetName = widget.sheetId ? view.sheetNames[widget.id] : null;
  const scope = widget.sheetId ? (sheetName ?? 'Sheet removed') : 'All sheets';
  const menu = canEdit ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="-mr-1.5"
          aria-label={`Options for ${widget.title}`}
        >
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil aria-hidden /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem disabled={first} onSelect={() => onMove(-1)}>
          <ArrowUp aria-hidden /> Move earlier
        </DropdownMenuItem>
        <DropdownMenuItem disabled={last} onSelect={() => onMove(1)}>
          <ArrowDown aria-hidden /> Move later
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onRemove}>
          <Trash2 aria-hidden /> Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  if (result?.kind === 'figures')
    return (
      <li className="col-span-full min-w-0">
        <KeyFigures result={result} title={widget.title} org={org} menu={menu} />
      </li>
    );
  const meta = resultMeta(result) ?? `${def?.label ?? 'Widget'} · ${scope}`;
  return (
    <li
      aria-labelledby={headingId}
      className={cn(
        'border-line bg-background-100 flex min-w-0 flex-col rounded-lg border',
        def?.wide && 'col-span-full',
      )}
    >
      <div className="border-line flex min-h-[52px] items-center justify-between gap-2.5 border-b px-[16px] py-2">
        <h2 id={headingId} className="text-heading-14 m-0 min-w-0">
          {widget.title}
        </h2>
        <span className="flex min-w-0 shrink items-center gap-1.5">
          <span className="text-muted-foreground text-label-13 truncate text-right">{meta}</span>
          {menu}
        </span>
      </div>
      <div className="flex-1">
        <WidgetBody result={result} org={org} />
      </div>
    </li>
  );
}

function NameDialog({
  mode,
  initial,
  onCancel,
  onSubmit,
}: {
  mode: 'rename' | 'new' | null;
  initial: string;
  onCancel(): void;
  onSubmit(name: string): Promise<void>;
}) {
  return (
    <Dialog open={!!mode} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        {mode ? (
          <NameForm
            key={mode}
            mode={mode}
            initial={initial}
            onCancel={onCancel}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NameForm({
  mode,
  initial,
  onCancel,
  onSubmit,
}: {
  mode: 'rename' | 'new';
  initial: string;
  onCancel(): void;
  onSubmit(name: string): Promise<void>;
}) {
  const id = useId();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        await onSubmit(name.trim());
        setBusy(false);
      }}
    >
      <DialogTitle className="text-heading-16">
        {mode === 'rename' ? 'Rename dashboard' : 'New dashboard'}
      </DialogTitle>
      <DialogDescription className="text-muted-foreground text-label-13">
        {mode === 'rename'
          ? 'Everyone in the workspace sees the new name.'
          : 'A new dashboard starts empty. Add widgets to it next.'}
      </DialogDescription>
      <label htmlFor={id} className="text-label-13 font-medium">
        Name
      </label>
      <input
        id={id}
        autoFocus
        maxLength={80}
        className={cn(inputClass, 'h-9')}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !name.trim()}>
          {mode === 'rename' ? 'Rename' : 'Create'}
        </Button>
      </div>
    </form>
  );
}
