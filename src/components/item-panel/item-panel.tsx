'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Link2,
  Lock,
  Maximize2,
  Minimize2,
  Pencil,
  X,
} from 'lucide-react';
import { Dialog as DialogPrimitive, Tabs } from 'radix-ui';
import { OverflowTabs } from '@/components/ui/overflow-tabs';
import { toast } from 'sonner';
import { neighbours } from '@/engine/item-panel';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Field, FileRow, Item, ItemSource } from '@/engine/types';
import type { SavedView } from '@/engine/views/config';
import { viewsKey } from '@/components/views/use-views';
import { Button } from '@/components/ui/button';
import { useValueCommit } from '@/components/grid/use-commit';
import type { SheetActions } from '@/components/grid/use-sheet';
import { cn } from '@/lib/utils';
import { ActivityTab } from './activity-tab';
import { DetailsTab } from './details-tab';
import { isDocumentsRegister } from '@/engine/documents';
import { FilesTab } from './files-tab';
import { onPanelTab, takePanelTab } from './open-tab';
import {
  panelKeys,
  useActivity,
  useFileCategories,
  useFileVersions,
  useIncoming,
  useItemDocuments,
  useUpdates,
} from './queries';
import { UpdatesTab } from './updates-tab';
import { SubitemsTab } from '@/components/subitems/subitems-tab';
import type { SubitemsHandle } from '@/components/subitems/use-subitems';
import { subitemLabel, subitemProgress } from '@/engine/subitems';

// The item panel (docs/05 §3.4, FR-27…FR-29): a 580 px drawer from the right (Expand: min(1080px, 100vw − 100px),
// full screen above the bottom bar on phones). A modal dialog: focus stays inside while it is open and returns to
// where it was on close; Esc closes (after leaving a text field); J and K move to the next and previous item.

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

export interface ItemPanelProps {
  org: string;
  data: SheetData;
  ctx: Ctx;
  actions: SheetActions;
  /** The item to show; null while the deep-linked id is unknown. */
  item: Item;
  /** Items in view order, for J/K. */
  order: Item[];
  canEdit: boolean;
  /** Commenters post updates without editing values (docs/02 §16). Default: canEdit. */
  canComment?: boolean;
  isAdmin: boolean;
  onClose(): void;
  /** Show another item of this sheet (J/K, linked items). */
  onNavigate(item: Item): void;
  /** A parent of a sheet with sub-items: the Sub-items tab (docs/05 §3.4). */
  subitems?: { handle: SubitemsHandle; onOpen(item: Item): void } | null;
  /** A sub-item: its parent, for the breadcrumb "CA-014 / CA-014.2" and Back. */
  parent?: Item | null;
  onBack?(): void;
  /** The tab to open on (Back from a sub-item opens Sub-items). */
  initialTab?: string;
}

/** The element the first of a run of panels (moved through with J and K) was opened from. */
let panelOpener: HTMLElement | null = null;

export function ItemPanel(props: ItemPanelProps) {
  const { org, data, ctx, actions, item, order, canEdit, isAdmin, onClose, onNavigate } = props;
  const { subitems, parent } = props;
  const router = useRouter();
  const qc = useQueryClient();
  const [wide, setWide] = useState(false);
  const [tab, setTab] = useState(() => takePanelTab(item.id) ?? props.initialTab ?? 'details');
  useEffect(() => onPanelTab(item.id, setTab), [item.id]);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(item.name);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // where focus was when the panel opened (a name in the grid, a deep link: the page); restored on close. J and K
  // replace the panel with the next item's: that one returns focus where the first panel was opened from.
  const [opener] = useState(() => {
    if (typeof document === 'undefined') return null;
    const el = document.activeElement as HTMLElement | null;
    if (el?.closest('[data-item-panel]')) return panelOpener;
    panelOpener = el;
    return el;
  });
  const contentRef = useRef<HTMLDivElement>(null);
  const valueCommit = useValueCommit(data, ctx, actions, { hold: true });

  useEffect(() => {
    setRenaming(false);
    setName(item.name);
  }, [item.id, item.name]);

  const group = ctx.groups.get(item.groupId);
  const { prev, next } = neighbours(order, item.id);
  const canEditItem = canEdit && (!item.locked || isAdmin);
  const readOnlyReason = !canEdit
    ? 'You can view this item. Ask an editor or admin to change it.'
    : item.lockReason
      ? `This item is locked: ${item.lockReason}. Only owners and admins can change it.`
      : 'This item is locked. Only owners and admins can change it.';

  // the panel's reads; `version` refetches the log and files whenever the item, its links or files change
  const updates = useUpdates(item.id);
  const incoming = useIncoming(item.id);
  const filesSig = data.files
    .filter((f) => f.itemId === item.id)
    .map((f) => f.id)
    .join(',');
  const linksSig = data.links
    .filter((l) => l.fromItem === item.id)
    .map((l) => l.toItem)
    .join(',');
  const version = `${item.updatedAt}|${item.groupId}|${item.locked}|${linksSig}|${filesSig}`;
  const activity = useActivity(item.id, item.sheetId, version);
  const versions = useFileVersions(item.id, filesSig);
  // linked documents are read once the Files tab opens, or at once when the sheet links to a documents register
  const linksToRegister = data.related.sheets.some((s) => isDocumentsRegister(s));
  const [filesSeen, setFilesSeen] = useState(false);
  useEffect(() => {
    if (tab === 'files') setFilesSeen(true);
  }, [tab]);
  const documents = useItemDocuments(
    org,
    item.id,
    `${linksSig}|${filesSig}`,
    filesSeen || tab === 'files' || linksToRegister,
  );
  const categories = useFileCategories(org);

  // incoming links come from items the sheet may not have loaded: fetch them into the cache
  const { loadRelated } = actions;
  const incomingIds = useMemo(
    () => (incoming.data ?? []).map((r) => r.fromItem).join(','),
    [incoming.data],
  );
  useEffect(() => {
    if (incomingIds) void loadRelated(incomingIds.split(','));
  }, [incomingIds, loadRelated]);
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: panelKeys.incoming(item.id) });
  }, [linksSig, item.id, qc]);

  const go = (target: Item | null) => {
    if (target) onNavigate(target);
  };

  const copyLink = async () => {
    const url = new URL(`/${org}/s/${item.sheetId}`, window.location.origin);
    url.searchParams.set('item', item.displayId);
    try {
      await navigator.clipboard.writeText(url.toString());
      toast('Link copied.');
    } catch {
      toast(`Copy this link: ${url.toString()}`);
    }
  };

  const saveName = async () => {
    const n = name.trim();
    setRenaming(false);
    // keep focus on the title; otherwise the focus trap may land it in a field and swallow the next Esc
    requestAnimationFrame(() => titleRef.current?.focus());
    if (!n) {
      setName(item.name);
      return void toast.error('A name is required.');
    }
    if (n !== item.name) await valueCommit.commit(item, 'name', n);
  };

  const openLinked = (target: Item) => {
    if (target.sheetId === item.sheetId) return onNavigate(target);
    router.push(`/${org}/s/${target.sheetId}?item=${encodeURIComponent(target.displayId)}`);
  };

  const onFileSaved = (file: FileRow, replaces: string | null) => {
    actions.addFileVersion(file, replaces);
    void qc.invalidateQueries({ queryKey: panelKeys.files(item.id) });
  };

  const updatesCount = updates.data?.length ?? 0;
  const knownField = new Set(data.fields.map((f) => f.id));
  const filesCount =
    (versions.data ?? []).filter(
      (v) => !v.archivedAt && !v.replacedBy && (v.fieldId === null || knownField.has(v.fieldId)),
    ).length + (documents.data?.documents.length ?? 0);
  const filesChanged = () => {
    void qc.invalidateQueries({ queryKey: panelKeys.files(item.id) });
    void qc.invalidateQueries({ queryKey: panelKeys.documents(item.id) });
    void qc.invalidateQueries({ queryKey: panelKeys.activity(item.id) });
  };
  const subLabel = subitemLabel(ctx.sheet);
  const subCount = subitems ? subitemProgress(item, ctx).total : 0;
  const activityCount = (activity.data?.entries ?? []).length;
  const stateOf = (q: { isPending: boolean; isError: boolean }) =>
    q.isPending ? 'loading' : q.isError ? 'error' : 'ready';

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          ref={contentRef}
          data-item-panel
          aria-describedby={undefined}
          data-wide={wide}
          // drawn over the right of the top bar: the crumb ends before it (shell-crumb.tsx)
          data-covers-top-bar=""
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            titleRef.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (opener && opener.isConnected && opener !== document.body) opener.focus();
            else document.querySelector<HTMLElement>('[role="grid"]')?.focus();
          }}
          onEscapeKeyDown={(e) => {
            // first Esc leaves a text field, the next one closes the panel
            const t = document.activeElement;
            if (isEditable(t) && contentRef.current?.contains(t as Node)) {
              e.preventDefault();
              if ((t as HTMLElement).getAttribute('aria-expanded') !== 'true')
                (t as HTMLElement).blur();
            }
          }}
          onKeyDown={(e) => {
            if (e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) return;
            // keys from popovers (portalled) belong to them
            if (!contentRef.current?.contains(e.target as Node)) return;
            if (e.key === 'j' || e.key === 'J') {
              e.preventDefault();
              go(next);
            } else if (e.key === 'k' || e.key === 'K') {
              e.preventDefault();
              go(prev);
            }
          }}
          className={cn(
            'group/panel bg-surface shadow-drawer fixed top-0 right-0 bottom-0 z-40 flex w-[min(520px,100vw)] flex-col outline-none',
            'data-[wide=true]:w-[min(1080px,calc(100vw-100px))]',
            'max-[759px]:bottom-[64px] max-[759px]:w-full max-[759px]:data-[wide=true]:w-full',
          )}
        >
          <Tabs.Root value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
            <header className="on-navy flex flex-col gap-1.5 px-5 pt-[18px]">
              <div className="flex items-center gap-1">
                {parent ? (
                  <nav
                    aria-label="Breadcrumb"
                    className="text-muted-foreground text-13 m-0 flex min-w-0 flex-1 items-center gap-1.5 truncate"
                  >
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Back to ${parent.displayId}`}
                      title={`Back to ${parent.displayId}`}
                      onClick={props.onBack}
                    >
                      <ArrowLeft aria-hidden />
                    </Button>
                    <button
                      type="button"
                      className="hover:text-ink text-12 truncate font-mono hover:underline"
                      onClick={props.onBack}
                    >
                      {parent.displayId}
                    </button>
                    <span aria-hidden className="text-line-strong">
                      /
                    </span>
                    <span className="text-ink text-12 truncate font-mono" aria-current="page">
                      {item.displayId}
                    </span>
                  </nav>
                ) : (
                  <p className="text-muted-foreground text-13 m-0 flex min-w-0 flex-1 items-center gap-1.5 truncate">
                    <span className="truncate">{ctx.sheet.name}</span>
                    <span aria-hidden className="text-line-strong">
                      /
                    </span>
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{
                        background: `var(--label-${group?.color ?? 'grey'}, var(--label-grey))`,
                      }}
                    />
                    <span className="sr-only">{' › '}</span>
                    <span className="text-ink truncate">{group?.name ?? '—'}</span>
                  </p>
                )}
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Previous item (K)"
                  title="Previous item (K)"
                  disabled={!prev}
                  onClick={() => go(prev)}
                >
                  <ChevronUp aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Next item (J)"
                  title="Next item (J)"
                  disabled={!next}
                  onClick={() => go(next)}
                >
                  <ChevronDown aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="max-[759px]:hidden"
                  aria-label={wide ? 'Narrow view' : 'Expand'}
                  title={wide ? 'Narrow view' : 'Expand'}
                  aria-pressed={wide}
                  onClick={() => setWide((w) => !w)}
                >
                  {wide ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Copy link"
                  title="Copy link"
                  onClick={() => void copyLink()}
                >
                  <Link2 aria-hidden />
                </Button>
                <DialogPrimitive.Close asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Close"
                    title="Close"
                  >
                    <X aria-hidden />
                  </Button>
                </DialogPrimitive.Close>
              </div>
              {renaming ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveName();
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    autoFocus
                    aria-label={`${ctx.sheet.itemLabel} name`}
                    className="border-input focus-visible:border-focus text-panel-title focus-visible:ring-focus min-w-0 flex-1 rounded-md border px-2 py-1 outline-none focus-visible:ring-2"
                    value={name}
                    maxLength={500}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => void saveName()}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setName(item.name);
                        setRenaming(false);
                        requestAnimationFrame(() => titleRef.current?.focus());
                      }
                    }}
                  />
                </form>
              ) : (
                <div className="flex items-start gap-1">
                  <DialogPrimitive.Title
                    ref={titleRef}
                    tabIndex={-1}
                    className={cn(
                      'text-22 m-0 min-w-0 flex-1 font-semibold break-words outline-none focus-visible:underline',
                      canEditItem && 'cursor-text',
                    )}
                    onClick={() => canEditItem && setRenaming(true)}
                  >
                    {item.name}
                  </DialogPrimitive.Title>
                  {canEditItem ? (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Rename"
                      title="Rename"
                      onClick={() => setRenaming(true)}
                    >
                      <Pencil aria-hidden />
                    </Button>
                  ) : null}
                </div>
              )}
              <p className="text-12 m-0 flex flex-wrap items-center gap-2">
                <span className="bg-brand-2 text-surface text-12 rounded px-1.5 font-mono leading-[18px]">
                  {item.displayId}
                </span>
                {item.source ? <FormSource source={item.source} sheetId={item.sheetId} /> : null}
                {item.locked ? (
                  <span className="border-warn/40 text-warn bg-warn-soft inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold">
                    <Lock className="size-3" aria-hidden />
                    {item.lockReason ? `Locked: ${item.lockReason}` : 'Locked'}
                  </span>
                ) : null}
              </p>
              <Tabs.List aria-label="Item sections" className="-mb-px flex overflow-x-auto pt-2">
                {/* two tabs, then More ▾ with the rest (docs/18 §3, the menu rule) */}
                <OverflowTabs
                  label="Item sections"
                  className="max-[759px]:gap-4"
                  tabs={[
                    { id: 'details', label: 'Details' },
                    ...(subitems ? [{ id: 'subitems', label: `${subLabel} · ${subCount}` }] : []),
                    { id: 'files', label: `Files · ${filesCount}` },
                    { id: 'updates', label: `Updates · ${updatesCount}` },
                    { id: 'activity', label: `Activity log · ${activityCount}` },
                  ]}
                  active={tab}
                  onSelect={(v) => setTab(v as typeof tab)}
                  renderTab={(t) => (
                    <Tabs.Trigger
                      value={t.id}
                      className="data-[state=active]:border-surface data-[state=active]:text-surface text-brand-soft hover:text-surface text-tab h-11 shrink-0 border-b-[3px] border-transparent px-px whitespace-nowrap focus-visible:outline-2 focus-visible:outline-white"
                    >
                      {t.label}
                    </Tabs.Trigger>
                  )}
                />
              </Tabs.List>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <Tabs.Content value="details" className="outline-none">
                <DetailsTab
                  org={org}
                  data={data}
                  item={item}
                  ctx={ctx}
                  canEditItem={canEditItem}
                  canPause={canEdit}
                  readOnlyReason={readOnlyReason}
                  incoming={incoming.data ?? []}
                  incomingLoading={incoming.isPending}
                  versions={versions.data ?? []}
                  onCommit={async (it, fieldId, raw) => {
                    await valueCommit.commit(it, fieldId, raw);
                    // links on the other side and the log change with the write: read them again now
                    void qc.invalidateQueries({ queryKey: panelKeys.incoming(item.id) });
                    void qc.invalidateQueries({ queryKey: panelKeys.activity(item.id) });
                  }}
                  onButton={(f: Field) => void actions.clickButton(item, f)}
                  fieldProps={(f, close) =>
                    valueCommit.fieldProps(f, { canEdit: canEditItem, isAdmin }, close)
                  }
                  onOpenLinked={openLinked}
                  onFileSaved={onFileSaved}
                />
              </Tabs.Content>
              {subitems ? (
                <Tabs.Content value="subitems" className="outline-none">
                  <SubitemsTab
                    parent={item}
                    parentSheetId={item.sheetId}
                    handle={subitems.handle}
                    canEdit={
                      canEdit && (!item.locked || isAdmin || !ctx.sheet.subitems?.lockCascade)
                    }
                    hasTemplate={(ctx.sheet.subitems?.template.length ?? 0) > 0}
                    onOpen={subitems.onOpen}
                  />
                </Tabs.Content>
              ) : null}
              <Tabs.Content value="files" className="outline-none">
                <FilesTab
                  org={org}
                  item={item}
                  ctx={ctx}
                  fields={data.fields}
                  actions={actions}
                  versions={versions.data ?? []}
                  versionsState={stateOf(versions)}
                  onRetryVersions={() => void versions.refetch()}
                  documents={documents.data}
                  documentsState={stateOf(documents)}
                  onRetryDocuments={() => void documents.refetch()}
                  categories={categories.data ?? []}
                  canEditItem={canEditItem}
                  canEdit={canEdit}
                  isAdmin={isAdmin}
                  onChanged={filesChanged}
                />
              </Tabs.Content>
              <Tabs.Content value="updates" className="outline-none">
                <UpdatesTab
                  org={org}
                  item={item}
                  ctx={ctx}
                  canEdit={props.canComment ?? canEdit}
                  updates={updates.data ?? []}
                  state={stateOf(updates)}
                  onRetry={() => void updates.refetch()}
                />
              </Tabs.Content>
              <Tabs.Content value="activity" className="outline-none">
                <ActivityTab
                  org={org}
                  item={item}
                  ctx={ctx}
                  data={activity.data}
                  state={stateOf(activity)}
                  onRetry={() => void activity.refetch()}
                />
              </Tabs.Content>
            </div>
          </Tabs.Root>
          {valueCommit.dialog}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Where the item came from (docs/02 §8): "From form: Report an incident (v3) · Public". */
function FormSource({ source, sheetId }: { source: ItemSource; sheetId: string }) {
  const qc = useQueryClient();
  const name = source.formId
    ? qc.getQueryData<SavedView[]>(viewsKey(sheetId))?.find((v) => v.id === source.formId)?.name
    : null;
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1">
      <FileText className="size-3" aria-hidden />
      From form: {name ?? 'a deleted form'}
      {source.formVersion ? ` (v${source.formVersion})` : ''} ·{' '}
      {source.channel === 'public' ? 'Public' : 'Internal'}
    </span>
  );
}
