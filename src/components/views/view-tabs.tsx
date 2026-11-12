'use client';

import { useEffect, useId, useState } from 'react';
import {
  CalendarDays,
  ChevronDown,
  Columns3,
  FileText,
  LayoutList,
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

// The view tab bar (docs/05 §3, FR-26): List, Grid, saved views, then "More ▾" with Kanban, Calendar, Form and
// "+ New view"; and the active view's menu (rename, duplicate, delete, save as a view, make default).

const ICONS: Record<ViewType, typeof Table2> = {
  list: LayoutList,
  grid: Table2,
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
        'flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold whitespace-nowrap',
        active ? 'bg-ink text-white' : 'hover:bg-soft',
      )}
    >
      <Icon className="size-4" aria-hidden />
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

export function ViewTabs({ views, fields }: { views: ViewsState; fields: Field[] }) {
  const { tabs, active, open, defaultViewId } = views;
  const [newOpen, setNewOpen] = useState(false);
  const shown = [tabs.list, tabs.grid, ...tabs.others];
  const extra = shown.some((v) => v.id === active.id) ? null : active;
  const isDefault = (v: ActiveView) =>
    v.id === defaultViewId || (v === tabs.list && defaultViewId === 'list');
  return (
    <nav aria-label="Views" className="min-w-0">
      <ul className="flex flex-wrap items-center gap-1">
        <li>
          <TabLink
            view={tabs.list}
            label="List"
            active={active.id === tabs.list.id}
            isDefault={isDefault(tabs.list)}
            open={open}
          />
        </li>
        <li>
          <TabLink
            view={tabs.grid}
            label="Grid"
            active={active.id === tabs.grid.id}
            isDefault={isDefault(tabs.grid)}
            open={open}
          />
        </li>
        {tabs.others.map((v) => (
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
              <Button type="button" variant="ghost" className="h-9 px-2.5">
                More <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {(['kanban', 'calendar', 'form'] as const).map((t) => {
                const Icon = ICONS[t];
                return (
                  <DropdownMenuItem key={t} onSelect={() => open(tabs.more[t].id)}>
                    <Icon aria-hidden /> {VIEW_TYPE_LABEL[t]}
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setNewOpen(true)}>
                <Plus aria-hidden /> New view
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
      </ul>
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
    (active.id === views.tabs.list.id && views.defaultViewId === 'list');
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
  const [type, setType] = useState<ViewType>(initialType ?? 'list');
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setType(initialType ?? 'list');
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
