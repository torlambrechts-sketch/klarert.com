'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  Calendar,
  ChartColumn,
  FileText,
  Lock,
  MoreHorizontal,
  Plus,
  SlidersHorizontal,
  Network,
  SquareKanban,
  Table,
  User,
} from 'lucide-react';
import {
  emptyConfig,
  SAVED_VIEW_TYPES,
  toSavedViewType,
  VIEW_TYPE_LABEL,
  type SavedViewType,
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { OverflowTabs, underlineTab } from '@/components/ui/overflow-tabs';
import { TabsEditor } from './tabs-editor';
import { toTabRows } from './tabs-model';
import type { ActiveView, ViewsState } from './use-views';

// The view tab bar (docs/05 §3, FR-26): icon and label tabs with an ink underline on the active one, in the sheet's tab
// order (settings.tabs; default Table, Insights, Board, Calendar, Form, shared views), my personal views last, then
// "More ▾" with "+ New view", the hidden tabs and "Customise tabs"; the page's view options sit at the right end. And the active view's menu (rename, duplicate, delete, save as a view, make default).

const ICONS: Record<ViewType, typeof Table> = {
  table: Table,
  insights: ChartColumn,
  kanban: SquareKanban,
  design: Network,
  calendar: Calendar,
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
      // the focus ring shows for keyboard focus only (focus-visible), never as a box around the active tab
      className={underlineTab(active)}
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

/** Esc in a tab's name field cancels the rename (tabs-editor), not the whole editor. */
const keepWhileRenaming = (e: KeyboardEvent) => {
  if (e.target instanceof HTMLElement && e.target.closest('[data-tab-rename]')) e.preventDefault();
};

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 759px)');
    const set = () => setNarrow(mq.matches);
    set();
    mq.addEventListener('change', set);
    return () => mq.removeEventListener('change', set);
  }, []);
  return narrow;
}

export function ViewTabs({
  views,
  fields,
  canCustomise,
  end,
  className,
}: {
  views: ViewsState;
  fields: Field[];
  /** Owners and admins change the sheet's tab set. */
  canCustomise: boolean;
  className?: string;
  /** Controls at the right end of the tab bar (view options, settings). */
  end?: React.ReactNode;
}) {
  const { tabs, layout, active, open, defaultViewId } = views;
  const [newOpen, setNewOpen] = useState(false);
  const [customise, setCustomise] = useState(false);
  const customiseFocus = useRef(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const narrow = useNarrow();
  const tipId = useId();
  const bar = [...layout.shown, ...layout.personal];
  const extra = bar.some((t) => t.view.id === active.id) ? null : active;
  const isDefault = (v: ActiveView) =>
    v.id === defaultViewId ||
    (v === tabs.table && defaultViewId === 'table') ||
    layout.all.some((t) => t.view.id === v.id && t.entryId === defaultViewId);
  const editor = (
    <TabsEditor
      rows={toTabRows(layout.all)}
      defaultViewId={defaultViewId}
      templateDefault={views.tabsDefault}
      canEdit={canCustomise}
      onSave={views.saveTabs}
      onCancel={() => setCustomise(false)}
    />
  );
  return (
    <div
      className={cn('border-line mt-[18px] flex min-w-0 items-center gap-2 border-b', className)}
    >
      <nav aria-label="Views" className="flex min-w-0 flex-1">
        <Popover open={customise && !narrow} onOpenChange={setCustomise}>
          <PopoverAnchor asChild>
            <div className="flex min-w-0 flex-1">
              <OverflowTabs
                label="Views"
                className="min-w-0 flex-1 [scrollbar-width:none] overflow-x-auto"
                tabs={[
                  ...bar,
                  ...(extra
                    ? [
                        {
                          view: extra,
                          label: layout.hidden.find((t) => t.view.id === extra.id)?.label,
                        },
                      ]
                    : []),
                ].map((t) => ({
                  id: t.view.id,
                  label: t.label ?? t.view.name,
                  icon: ICONS[t.view.type],
                  view: t.view,
                }))}
                active={active.id}
                onSelect={open}
                triggerRef={moreRef}
                renderTab={(t, on) => (
                  <TabLink
                    view={t.view}
                    label={t.label}
                    active={on}
                    isDefault={isDefault(t.view)}
                    open={open}
                  />
                )}
                menuExtra={
                  <>
                    <DropdownMenuItem onSelect={() => setNewOpen(true)}>
                      <Plus aria-hidden /> New view
                    </DropdownMenuItem>
                    {layout.hidden.length ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup aria-label="Hidden tabs">
                          <DropdownMenuLabel>Hidden tabs</DropdownMenuLabel>
                          {layout.hidden.map((t) => {
                            const Icon = ICONS[t.view.type];
                            return (
                              <DropdownMenuItem key={t.view.id} onSelect={() => open(t.view.id)}>
                                <Icon aria-hidden /> {t.label}
                              </DropdownMenuItem>
                            );
                          })}
                        </DropdownMenuGroup>
                      </>
                    ) : null}
                    <DropdownMenuSeparator />
                    {canCustomise ? (
                      <DropdownMenuItem
                        onSelect={() => {
                          customiseFocus.current = true;
                          // after the menu has closed and given focus back
                          setTimeout(() => setCustomise(true), 0);
                        }}
                      >
                        <SlidersHorizontal aria-hidden /> Customise tabs
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        aria-disabled="true"
                        aria-describedby={tipId}
                        className="group/tip text-muted-foreground"
                        onSelect={(e) => e.preventDefault()}
                      >
                        <Lock aria-hidden /> Customise tabs
                        <span
                          id={tipId}
                          role="tooltip"
                          className="bg-ink text-label-12 pointer-events-none absolute top-full left-2 z-20 mt-1 hidden w-48 rounded px-2 py-1 text-white group-hover/tip:block group-data-[highlighted]/tip:block"
                        >
                          Only owners and admins can change tabs
                        </span>
                      </DropdownMenuItem>
                    )}
                  </>
                }
              />
            </div>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            className="max-h-[min(640px,calc(100dvh-120px))] w-[min(440px,calc(100vw-32px))] overflow-y-auto"
            aria-label="Customise tabs"
            onEscapeKeyDown={keepWhileRenaming}
            // rows move under the keyboard: focus passing through the page does not close the editor
            onFocusOutside={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              moreRef.current?.focus();
            }}
          >
            <h2 className="text-heading-16 mb-3">Customise tabs</h2>
            {editor}
          </PopoverContent>
        </Popover>
      </nav>
      {end ? <div className="flex shrink-0 items-center gap-1.5">{end}</div> : null}
      <Dialog open={customise && narrow} onOpenChange={setCustomise}>
        <DialogContent
          onEscapeKeyDown={keepWhileRenaming}
          className="top-auto bottom-0 left-0 max-h-[88dvh] w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-t-xl rounded-b-none p-4"
        >
          <DialogTitle className="text-heading-16">Customise tabs</DialogTitle>
          <DialogDescription className="sr-only">
            Choose which tabs everyone sees, their order and names.
          </DialogDescription>
          {editor}
        </DialogContent>
      </Dialog>
      <ViewDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New view"
        submit="Create view"
        initialName=""
        chooseType
        initialType={toSavedViewType(active.type) ?? 'table'}
        canShare={views.canShare}
        onSubmit={async ({ name, type, shared }) => {
          const config: ViewConfig = type === active.type ? views.config : { ...emptyConfig() };
          if (type === 'form' && !config.form) config.form = defaultFormLayout(fields);
          await views.create({ name, type, shared, config });
        }}
      />
    </div>
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
        <Button type="button" variant="outline" size="sm" onClick={() => setDialog('save')}>
          Save view
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon-sm" aria-label="View options">
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
          {canEdit &&
          (!saved || saved.ownerId === null) &&
          !views.layout.hidden.some((t) => t.view.id === active.id) ? (
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
          <DialogTitle className="text-heading-16">Delete {saved?.name}?</DialogTitle>
          <DialogDescription className="text-muted-foreground text-label-13">
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

export function ViewDialog({
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
  initialType?: SavedViewType;
  /** Undefined: no share choice (rename). */
  canShare?: boolean;
  onSubmit(v: { name: string; type: SavedViewType; shared: boolean }): Promise<void>;
}) {
  const id = useId();
  const [name, setName] = useState(initialName);
  const [type, setType] = useState<SavedViewType>(initialType ?? 'table');
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
        <DialogTitle className="text-heading-16">{title}</DialogTitle>
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
          <label htmlFor={`${id}-name`} className="text-label-13 flex flex-col gap-1 font-semibold">
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
              <legend className="text-label-13 mb-1 font-semibold">Type</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {SAVED_VIEW_TYPES.map((t) => (
                  <label key={t} className="text-label-13 flex items-center gap-1.5">
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
            <label className="text-label-13 flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={shared}
                disabled={!canShare}
                onChange={(e) => setShared(e.target.checked)}
              />
              <span>
                Share with everyone in the workspace
                <span className="text-muted-foreground text-label-12 block">
                  {canShare
                    ? 'Unticked, only you see this view.'
                    : 'Viewers save personal views only. Only you will see it.'}
                </span>
              </span>
            </label>
          ) : null}
          {error ? <p className="text-crit text-copy-13">{error}</p> : null}
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
