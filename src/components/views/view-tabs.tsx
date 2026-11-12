'use client';

import { useEffect, useId, useState } from 'react';
import {
  CalendarDays,
  ChevronDown,
  Columns3,
  FileText,
  MoreHorizontal,
  Plus,
  Table2,
  User,
} from 'lucide-react';
import {
  emptyConfig,
  VIEW_TYPE_LABEL,
  VIEW_TYPES,
  type ViewConfig,
  type ViewType,
} from '@/engine/views/config';
import { defaultFormLayout } from '@/engine/views/form';
import type { Field } from '@/engine/types';
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
import { cn } from '@/lib/utils';
import type { ActiveView, ViewsState } from './use-views';

// The view tab bar (docs/05 §3, FR-26): icon and label tabs with an ink underline on the active one: Table, Board
// (Kanban), Calendar, Form, the other saved views, then "More ▾" with "+ New view"; the page's view options sit at the
// right end. And the active view's menu (rename, duplicate, delete, save as a view, make default).

const ICONS: Record<ViewType, typeof Table2> = {
  table: Table2,
  kanban: Columns3,
  calendar: CalendarDays,
  form: FileText,
};

function TabLink({
  view,
  label,
  active,
  isDefault,
  open,
}: {
  view: ActiveView;
  label?: string;
  active: boolean;
  isDefault: boolean;
  open(id: string): void;
}) {
  const Icon = ICONS[view.type];
  const personal = !!view.saved && view.saved.ownerId !== null;
  return (
    <a
      href={`?view=${view.id}`}
      aria-current={active ? 'page' : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        open(view.id);
      }}
      className={cn(
        // the focus ring shows for keyboard focus only (focus-visible), never as a box around the active tab
        'focus-visible:outline-focus relative flex h-[40px] items-center gap-[7px] rounded-sm px-px text-[14px] whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:-outline-offset-2',
        active
          ? 'text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-sm after:bg-[var(--ink)]'
          : 'text-muted-foreground hover:text-ink',
      )}
    >
      <Icon className="size-[15px]" aria-hidden />
      {label ?? view.name}
      {personal ? (
        <>
          <User className="size-3 opacity-70" aria-hidden />
          <span className="sr-only">(personal)</span>
        </>
      ) : null}
      {isDefault ? <span className="sr-only">(default)</span> : null}
    </a>
  );
}

/** The tab label of a built-in view type ("Board" for Kanban); saved views keep their name. */
const tabLabel = (v: ActiveView) => (v.saved ? v.name : v.type === 'kanban' ? 'Board' : v.name);

export function ViewTabs({
  views,
  fields,
  end,
  className,
}: {
  views: ViewsState;
  fields: Field[];
  className?: string;
  /** Controls at the right end of the tab bar (view options, settings). */
  end?: React.ReactNode;
}) {
  const { tabs, active, open, defaultViewId } = views;
  const [newOpen, setNewOpen] = useState(false);
  const builtins = [tabs.table, tabs.more.kanban, tabs.more.calendar, tabs.more.form];
  const others = tabs.others.filter((v) => !builtins.some((b) => b.id === v.id));
  const shown = [...builtins, ...others];
  const extra = shown.some((v) => v.id === active.id) ? null : active;
  const isDefault = (v: ActiveView) =>
    v.id === defaultViewId || (v === tabs.table && defaultViewId === 'table');
  return (
    <nav
      aria-label="Views"
      className={cn('border-line mt-[18px] flex min-w-0 items-center gap-2 border-b', className)}
    >
      <ul className="m-0 flex min-w-0 flex-1 [scrollbar-width:none] list-none items-center gap-[22px] overflow-x-auto p-0">
        <li>
          <TabLink
            view={tabs.table}
            label="Table"
            active={active.id === tabs.table.id}
            isDefault={isDefault(tabs.table)}
            open={open}
          />
        </li>
        {[tabs.more.kanban, tabs.more.calendar, tabs.more.form].map((v) => (
          <li key={v.id}>
            <TabLink
              view={v}
              label={tabLabel(v)}
              active={active.id === v.id}
              isDefault={isDefault(v)}
              open={open}
            />
          </li>
        ))}
        {others.map((v) => (
          <li key={v.id}>
            <TabLink view={v} active={active.id === v.id} isDefault={isDefault(v)} open={open} />
          </li>
        ))}
        {extra ? (
          <li>
            <TabLink view={extra} active isDefault={isDefault(extra)} open={open} />
          </li>
        ) : null}
        <li>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="text-muted-foreground hover:text-ink h-8 px-2 text-[14px] font-normal"
              >
                More <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => setNewOpen(true)}>
                <Plus aria-hidden /> New view
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
      </ul>
      {end ? <div className="flex shrink-0 items-center gap-1.5 pb-1">{end}</div> : null}
      <ViewDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New view"
        submit="Create view"
        initialName=""
        chooseType
        initialType={active.type}
        canShare={views.canShare}
        onSubmit={async ({ name, type, shared }) => {
          const config: ViewConfig = type === active.type ? views.config : { ...emptyConfig() };
          if (type === 'form' && !config.form) config.form = defaultFormLayout(fields);
          await views.create({ name, type, shared, config });
        }}
      />
    </nav>
  );
}

/** The active view's menu and the "Save as a view" button for unsaved changes. */
export function ViewMenu({ views, canEdit }: { views: ViewsState; canEdit: boolean }) {
  const { active, unsaved } = views;
  const [dialog, setDialog] = useState<'save' | 'rename' | 'duplicate' | 'delete' | null>(null);
  const saved = active.saved;
  const isDefault =
    views.defaultViewId === active.id ||
    (active.id === views.tabs.table.id && views.defaultViewId === 'table');
  return (
    <>
      {unsaved ? (
        <Button type="button" variant="outline" onClick={() => setDialog('save')}>
          Save view
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label="View options">
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog('save')}>Save as a new view</DropdownMenuItem>
          {saved && active.canWrite ? (
            <DropdownMenuItem onSelect={() => setDialog('rename')}>Rename view</DropdownMenuItem>
          ) : null}
          {saved ? (
            <DropdownMenuItem onSelect={() => setDialog('duplicate')}>
              Duplicate view
            </DropdownMenuItem>
          ) : null}
          {canEdit && (!saved || saved.ownerId === null) ? (
            <DropdownMenuItem
              disabled={isDefault}
              onSelect={() => void views.makeDefault(active.id)}
            >
              {isDefault ? 'Opens first for everyone' : 'Make this the default view'}
            </DropdownMenuItem>
          ) : null}
          {saved && active.canWrite ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDialog('delete')}>
                Delete view
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ViewDialog
        open={dialog === 'save'}
        onClose={() => setDialog(null)}
        title="Save as a new view"
        submit="Save view"
        initialName={
          saved ? `${saved.name} (copy)` : `My ${VIEW_TYPE_LABEL[active.type].toLowerCase()}`
        }
        canShare={views.canShare}
        onSubmit={({ name, shared }) =>
          views
            .create({ name, type: active.type, shared, config: views.config })
            .then(() => undefined)
        }
      />
      <ViewDialog
        open={dialog === 'rename'}
        onClose={() => setDialog(null)}
        title="Rename view"
        submit="Rename"
        initialName={saved?.name ?? ''}
        onSubmit={({ name }) => (saved ? views.rename(saved, name) : Promise.resolve())}
      />
      <ViewDialog
        open={dialog === 'duplicate'}
        onClose={() => setDialog(null)}
        title="Duplicate view"
        submit="Duplicate"
        initialName={saved ? `${saved.name} (copy)` : ''}
        canShare={views.canShare}
        onSubmit={({ name, shared }) =>
          saved ? views.duplicate(saved, name, shared) : Promise.resolve()
        }
      />
      <Dialog open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="w-[min(400px,calc(100vw-32px))]">
          <DialogTitle className="text-lg font-bold">Delete {saved?.name}?</DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            {saved?.ownerId === null
              ? 'Everyone loses this view. Items are not changed.'
              : 'Only the view goes. Items are not changed.'}
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setDialog(null);
                if (saved) void views.remove(saved);
              }}
            >
              Delete view
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ViewDialog({
  open,
  onClose,
  title,
  submit,
  initialName,
  chooseType,
  initialType,
  canShare,
  onSubmit,
}: {
  open: boolean;
  onClose(): void;
  title: string;
  submit: string;
  initialName: string;
  chooseType?: boolean;
  initialType?: ViewType;
  /** Undefined: no share choice (rename). */
  canShare?: boolean;
  onSubmit(v: { name: string; type: ViewType; shared: boolean }): Promise<void>;
}) {
  const id = useId();
  const [name, setName] = useState(initialName);
  const [type, setType] = useState<ViewType>(initialType ?? 'table');
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setType(initialType ?? 'table');
    setShared(false);
    setError(null);
  }, [open, initialName, initialType]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogTitle className="text-lg font-bold">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          Name the view and choose who sees it.
        </DialogDescription>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return setError('A name is required.');
            if (n.length > 60) return setError('A view name can be at most 60 characters.');
            setBusy(true);
            await onSubmit({ name: n, type, shared });
            setBusy(false);
            onClose();
          }}
        >
          <label htmlFor={`${id}-name`} className="flex flex-col gap-1 text-sm font-semibold">
            View name
            <input
              id={`${id}-name`}
              autoFocus
              className={cn(inputClass, 'h-9 font-normal')}
              value={name}
              maxLength={60}
              aria-invalid={!!error}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {chooseType ? (
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-sm font-semibold">Type</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {VIEW_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      name={`${id}-type`}
                      checked={type === t}
                      onChange={() => setType(t)}
                    />
                    {VIEW_TYPE_LABEL[t]}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {canShare !== undefined ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={shared}
                disabled={!canShare}
                onChange={(e) => setShared(e.target.checked)}
              />
              <span>
                Share with everyone in the workspace
                <span className="text-muted-foreground block text-xs">
                  {canShare
                    ? 'Unticked, only you see this view.'
                    : 'Viewers save personal views only. Only you will see it.'}
                </span>
              </span>
            </label>
          ) : null}
          {error ? <p className="text-crit text-sm">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {submit}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
