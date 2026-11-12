'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  createDashboardAction,
  deleteDashboardAction,
  updateDashboardAction,
} from '@/app/[org]/dashboards/actions';
import { WIDGET_TYPES, type WidgetConfig } from '@/engine/dashboards';
import { inputClass } from '@/components/fields/shared';
import { PageHeader, PageTabs } from '@/components/shell/page-header';
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
import { WidgetBody } from './widget-card';
import { WidgetDialog, type WidgetEditorData } from './widget-dialog';

// One dashboard (docs/05 §4, mockup "Compliance overview"): header with Add widget and a menu (Rename, New dashboard,
// Delete), tabs for the workspace's dashboards, then the widgets as cards in a responsive grid. Each card has a menu
// to edit, move or remove it. Every change is one updateDashboard command; the page then renders again.

export function DashboardScreen({
  org,
  dashboards,
  dashboard,
  view,
  canEdit,
  editor,
}: {
  org: string;
  dashboards: { id: string; name: string }[];
  dashboard: Dashboard;
  view: DashboardView | null;
  canEdit: boolean;
  editor: WidgetEditorData | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [widgetDialog, setWidgetDialog] = useState<{ widget?: WidgetConfig } | null>(null);
  const [nameDialog, setNameDialog] = useState<'rename' | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const widgets = dashboard.widgets;
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
          <Button type="button" variant="outline" size="icon" aria-label="Dashboard options">
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
      className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-7 sm:pt-[26px]"
      aria-busy={pending}
    >
      <PageHeader
        crumb="Insights"
        title={dashboard.name}
        description="Widgets that read from your sheets, the evidence library and the run log. Figures are worked out each time the page opens."
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

      {!view ? (
        <div
          role="alert"
          className="border-line flex flex-col items-start gap-2 rounded-xl border bg-white p-5 shadow-xs"
        >
          <p className="m-0">The widgets could not be loaded.</p>
          <Button type="button" variant="outline" onClick={refresh}>
            <RotateCcw aria-hidden /> Retry
          </Button>
        </div>
      ) : widgets.length === 0 ? (
        <div className="border-line flex flex-col items-start gap-2 rounded-xl border border-dashed bg-white p-6">
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
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-4 p-0">
          {widgets.map((w, i) => (
            <WidgetCard
              key={w.id}
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
          <DialogTitle className="text-lg font-semibold">Delete this dashboard?</DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
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

function WidgetCard({
  widget,
  view,
  canEdit,
  first,
  last,
  onEdit,
  onMove,
  onRemove,
}: {
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
  const sheetName = widget.sheetId ? view.sheetNames[widget.id] : null;
  const scope = widget.sheetId ? (sheetName ?? 'Sheet removed') : 'All sheets';
  return (
    <li
      aria-labelledby={headingId}
      className="border-line flex min-w-0 flex-col rounded-xl border bg-white shadow-xs"
    >
      <div className="flex items-start gap-2 px-5 pt-4 pb-1">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="m-0 text-[15px] font-semibold tracking-[-0.01em]">
            {widget.title}
          </h2>
          <p className="text-muted-foreground m-0 mt-0.5 text-[12.5px]">
            {def?.label ?? 'Widget'} · {scope}
          </p>
        </div>
        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
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
        ) : null}
      </div>
      <div className="flex-1 px-5 pt-2 pb-4">
        <WidgetBody result={view.results[widget.id]} />
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
      <DialogTitle className="text-lg font-semibold">
        {mode === 'rename' ? 'Rename dashboard' : 'New dashboard'}
      </DialogTitle>
      <DialogDescription className="text-muted-foreground text-sm">
        {mode === 'rename'
          ? 'Everyone in the workspace sees the new name.'
          : 'A new dashboard starts empty. Add widgets to it next.'}
      </DialogDescription>
      <label htmlFor={id} className="text-sm font-medium">
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
