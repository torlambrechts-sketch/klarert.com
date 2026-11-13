'use client';

import { useMemo, useState } from 'react';
import { EyeOff, X } from 'lucide-react';
import {
  hiddenWithCollapsed,
  liveCollapsed,
  parseColumnGroups,
} from '@/engine/views/column-groups';
import {
  emptyConfig,
  sameLayout,
  showsAll,
  withLayout,
  type SavedView,
} from '@/engine/views/config';
import type { Field, Sheet } from '@/engine/types';
import { useGridStore } from '@/components/grid/grid-store';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { ViewsState } from './use-views';
import { ViewDialog } from './view-tabs';

// The Table's view bar (docs/05 §3.1): chips for the sheet's saved Table views ("Essentials" first), "Show all", an
// unsaved-changes dot when the columns differ from the chosen chip, "Save as view…" and "Update “…”", and
// "Hidden · N", which opens the Columns menu at its hidden list. At 390 px the chips scroll sideways and the save
// actions move into the Columns menu.

const SHOW_ALL = '__all';

/** The view bar's model: which chips, which one is chosen and whether the columns differ from it. Pure. */
export function viewBarModel(input: {
  views: SavedView[];
  userId: string;
  active: { id: string; type: string; saved: SavedView | null };
  config: ReturnType<typeof emptyConfig>;
}) {
  const tableViews = input.views
    .filter((v) => v.type === 'table' && (v.ownerId === null || v.ownerId === input.userId))
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  const isEssentials = (v: SavedView) => v.name.trim().toLowerCase() === 'essentials';
  const chips: { id: string; name: string; view: SavedView | null }[] = [
    ...tableViews.filter(isEssentials).map((v) => ({ id: v.id, name: v.name, view: v })),
    { id: SHOW_ALL, name: 'Show all', view: null },
    ...tableViews.filter((v) => !isEssentials(v)).map((v) => ({ id: v.id, name: v.name, view: v })),
  ];
  const saved = input.active.type === 'table' ? input.active.saved : null;
  const all = showsAll(input.config);
  const chosen =
    saved && tableViews.some((v) => v.id === saved.id)
      ? all && !showsAll(saved.config)
        ? SHOW_ALL
        : saved.id
      : SHOW_ALL;
  const dirty = chosen === SHOW_ALL ? !all : !!saved && !sameLayout(input.config, saved.config);
  return { chips, chosen, dirty, saved };
}

export function ViewBar({
  views,
  sheet,
  fields,
  userId,
  isAdmin,
}: {
  views: ViewsState;
  sheet: Sheet;
  fields: Field[];
  userId: string;
  isAdmin: boolean;
}) {
  const store = useGridStore();
  const { active, config } = views;
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<SavedView | null>(null);
  const m = useMemo(
    () => viewBarModel({ views: views.views, userId, active, config }),
    [views.views, userId, active, config],
  );
  const hiddenCount = useMemo(() => {
    const groups = parseColumnGroups(
      sheet.columnGroups ?? [],
      fields.map((f) => f.key),
    );
    const hidden = new Set(fields.filter((f) => config.hidden.includes(f.key)).map((f) => f.id));
    return hiddenWithCollapsed(
      fields,
      hidden,
      groups,
      liveCollapsed(groups, config.collapsedGroups),
    ).size;
  }, [sheet.columnGroups, fields, config.hidden, config.collapsedGroups]);
  const canUpdate = !!m.saved && active.canWrite && views.layoutDirty;
  // the tab bar's "Save view" already offers it for a draft of a view I cannot change
  const canSaveAs = m.dirty && !views.unsaved;
  const canDelete = (v: SavedView) => v.ownerId === userId || (v.ownerId === null && isAdmin);

  const pick = (id: string) => {
    if (id === SHOW_ALL) {
      views.setConfig((c) => withLayout(c, { hidden: [], collapsedGroups: [] }));
      return;
    }
    views.choose(id);
  };

  return (
    <div data-keep-selection className="mb-3 flex min-w-0 items-center gap-2.5">
      <div
        role="tablist"
        aria-label="Saved views of this table"
        className="flex min-w-0 flex-1 [scrollbar-width:none] items-center gap-1 overflow-x-auto"
      >
        {m.chips.map((c) => {
          const on = m.chosen === c.id;
          const deletable = c.view && canDelete(c.view);
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={on}
              data-chip={c.name}
              title={deletable ? 'Press Delete to remove this view' : undefined}
              onClick={() => pick(c.id)}
              onKeyDown={(e) => {
                if ((e.key === 'Delete' || e.key === 'Backspace') && deletable) {
                  e.preventDefault();
                  setRemoving(c.view);
                }
              }}
              className={cn(
                'group/chip text-label-13 focus-visible:outline-focus inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-full border px-3 font-medium whitespace-nowrap focus-visible:outline-2',
                on
                  ? 'border-line bg-background-100 text-ink shadow-[0_1px_2px_var(--gray-alpha-100)]'
                  : 'text-muted-foreground hover:text-ink border-transparent',
              )}
            >
              {c.name}
              {on && m.dirty ? (
                <>
                  <span aria-hidden className="size-1.5 rounded-full bg-[var(--amber-800)]" />
                  <span className="sr-only">(unsaved changes)</span>
                </>
              ) : null}
              {deletable ? (
                <span
                  aria-hidden
                  onClick={(e) => {
                    e.stopPropagation();
                    setRemoving(c.view);
                  }}
                  className={cn(
                    'hover:bg-soft hover:text-ink -mr-1.5 hidden size-[22px] place-items-center rounded-full text-[var(--muted)] group-hover/chip:grid group-focus-visible/chip:grid',
                    on && 'grid',
                  )}
                >
                  <X className="size-3" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="hidden shrink-0 items-center gap-2 sm:flex">
        {canSaveAs ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-label-12.5 h-[30px] rounded-full border-dashed"
            onClick={() => setSaving(true)}
          >
            Save as view…
          </Button>
        ) : null}
        {canUpdate ? (
          <Button
            type="button"
            size="sm"
            className="text-label-12.5 h-[30px] rounded-full"
            onClick={() => void views.updateLayout()}
          >
            Update “{m.saved!.name}”
          </Button>
        ) : null}
      </div>
      {hiddenCount > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-ink text-label-12.5 h-[30px] shrink-0 gap-1.5 px-2.5"
          onClick={() => store.getState().openColumns('hidden')}
        >
          <EyeOff aria-hidden className="size-3.5" />
          Hidden · {hiddenCount}
        </Button>
      ) : null}
      <ViewDialog
        open={saving}
        onClose={() => setSaving(false)}
        title="Save as a new view"
        submit="Save view"
        initialName={m.saved ? `${m.saved.name} (copy)` : 'My table'}
        canShare={views.canShare}
        onSubmit={({ name, shared }) =>
          views.create({ name, type: 'table', shared, config }).then(() => undefined)
        }
      />
      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent className="w-[min(400px,calc(100vw-32px))]">
          <DialogTitle className="text-heading-16">Delete {removing?.name}?</DialogTitle>
          <DialogDescription className="text-muted-foreground text-label-13">
            {removing?.ownerId === null
              ? 'Everyone loses this view. Items are not changed.'
              : 'Only the view goes. Items are not changed.'}
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                const v = removing;
                setRemoving(null);
                if (v) void views.remove(v);
              }}
            >
              Delete view
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The view bar's save actions inside the Columns menu (phones, where the bar has no room for them). */
export function ViewBarActions({ views, userId }: { views: ViewsState; userId: string }) {
  const [saving, setSaving] = useState(false);
  const m = viewBarModel({
    views: views.views,
    userId,
    active: views.active,
    config: views.config,
  });
  const canUpdate = !!m.saved && views.active.canWrite && views.layoutDirty;
  const canSaveAs = m.dirty && !views.unsaved;
  if (!canUpdate && !canSaveAs) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {canUpdate ? (
        <Button type="button" size="sm" onClick={() => void views.updateLayout()}>
          Update “{m.saved!.name}”
        </Button>
      ) : null}
      {canSaveAs ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setSaving(true)}>
          Save as view…
        </Button>
      ) : null}
      <ViewDialog
        open={saving}
        onClose={() => setSaving(false)}
        title="Save as a new view"
        submit="Save view"
        initialName={m.saved ? `${m.saved.name} (copy)` : 'My table'}
        canShare={views.canShare}
        onSubmit={({ name, shared }) =>
          views.create({ name, type: 'table', shared, config: views.config }).then(() => undefined)
        }
      />
    </div>
  );
}
