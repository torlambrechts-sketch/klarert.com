'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Link2, Lock, Maximize2, Minimize2, Pencil, X } from 'lucide-react';
import { Dialog as DialogPrimitive, Tabs } from 'radix-ui';
import { toast } from 'sonner';
import { neighbours } from '@/engine/item-panel';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Field, FileRow, Item } from '@/engine/types';
import { Button } from '@/components/ui/button';
import { useValueCommit } from '@/components/grid/use-commit';
import type { SheetActions } from '@/components/grid/use-sheet';
import { cn } from '@/lib/utils';
import { ActivityTab } from './activity-tab';
import { DetailsTab } from './details-tab';
import { panelKeys, useActivity, useFileVersions, useIncoming, useUpdates } from './queries';
import { UpdatesTab } from './updates-tab';

// The item panel (docs/05 §3.4, FR-27…FR-29): a 470 px drawer from the right (Expand: min(1080px, 100vw − 100px),
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
  isAdmin: boolean;
  onClose(): void;
  /** Show another item of this sheet (J/K, linked items). */
  onNavigate(item: Item): void;
}

export function ItemPanel(props: ItemPanelProps) {
  const { org, data, ctx, actions, item, order, canEdit, isAdmin, onClose, onNavigate } = props;
  const router = useRouter();
  const qc = useQueryClient();
  const [wide, setWide] = useState(false);
  const [tab, setTab] = useState('details');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(item.name);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // where focus was when the panel opened (a name in the grid, a deep link: the page); restored on close
  const [opener] = useState(() =>
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  );
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
  const activityCount = (activity.data?.entries ?? []).length;
  const stateOf = (q: { isPending: boolean; isError: boolean }) =>
    q.isPending ? 'loading' : q.isError ? 'error' : 'ready';

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          ref={contentRef}
          aria-describedby={undefined}
          data-wide={wide}
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
            'group/panel fixed top-0 right-0 bottom-0 z-40 flex w-[min(470px,100vw)] flex-col border-l border-[var(--line)] bg-white shadow-[-10px_0_30px_rgba(10,20,30,0.16)] outline-none',
            'data-[wide=true]:w-[min(1080px,calc(100vw-100px))]',
            'max-[759px]:bottom-[64px] max-[759px]:w-full max-[759px]:data-[wide=true]:w-full',
          )}
        >
          <Tabs.Root value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
            <header
              className="border-line flex flex-col gap-1 border-t-[5px] border-b px-4 pt-3 sm:px-[18px]"
              style={{
                borderTopColor: `var(--label-${group?.color ?? 'grey'}, var(--label-grey))`,
              }}
            >
              <div className="flex items-center gap-1">
                <p className="text-muted-foreground m-0 min-w-0 flex-1 truncate text-xs">
                  {ctx.sheet.name} › {group?.name ?? '—'}
                </p>
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
                    className="border-input focus-visible:border-focus min-w-0 flex-1 rounded-md border px-2 py-1 text-lg font-extrabold outline-none"
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
                      'm-0 min-w-0 flex-1 text-lg leading-snug font-extrabold break-words outline-none focus-visible:underline',
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
              <p className="m-0 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground font-mono">{item.displayId}</span>
                {item.locked ? (
                  <span className="border-warn/40 text-warn inline-flex items-center gap-1 rounded-full border bg-[#FFF8E6] px-2 py-0.5 font-semibold">
                    <Lock className="size-3" aria-hidden />
                    {item.lockReason ? `Locked: ${item.lockReason}` : 'Locked'}
                  </span>
                ) : null}
              </p>
              <Tabs.List aria-label="Item sections" className="-mb-px flex gap-4 pt-2">
                {[
                  ['details', 'Details'],
                  ['updates', `Updates · ${updatesCount}`],
                  ['activity', `Activity log · ${activityCount}`],
                ].map(([v, label]) => (
                  <Tabs.Trigger
                    key={v}
                    value={v!}
                    className="data-[state=active]:border-ink data-[state=active]:text-ink text-muted-foreground focus-visible:outline-focus border-b-2 border-transparent pb-2 text-[13px] font-semibold focus-visible:outline-2"
                  >
                    {label}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-[18px]">
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
              <Tabs.Content value="updates" className="outline-none">
                <UpdatesTab
                  org={org}
                  item={item}
                  ctx={ctx}
                  canEdit={canEdit}
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
