'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { markNotificationsReadAction } from '@/app/[org]/shell-actions';
import { formatDateTime } from '@/engine/fields/helpers';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useShell } from './shell-context';

// The inbox (docs/01 FR-36, docs/05 §2.3): unread count on the button, the latest 10 notifications in a popover,
// mark one or all read, open the item. Reads under the person's RLS (only their own notifications) and listens to
// realtime inserts and updates of their notifications; marking read goes through a command.

export const INBOX_LATEST = 10;
const POLL_MS = 30_000;

const KIND_LABEL: Record<string, string> = {
  notify: 'Notification',
  request: 'Request',
  mention: 'Mention',
  system: 'Automation problem',
};

type Row = {
  id: string;
  kind: string;
  body: string;
  readAt: string | null;
  doneAt: string | null;
  createdAt: string;
  item: { sheetId: string; displayId: string } | null;
};

type State =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; rows: Row[]; unread: number };

function useInbox(orgId: string, userId: string) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const load = useCallback(async () => {
    const db = createClient();
    const [list, unread] = await Promise.all([
      db
        .from('notifications')
        .select('id, kind, body, read_at, done_at, created_at, items(sheet_id, display_id)')
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(INBOX_LATEST),
      db
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .is('read_at', null),
    ]);
    if (list.error || unread.error) {
      setState((s) => (s.status === 'ready' ? s : { status: 'error' }));
      return;
    }
    setState({
      status: 'ready',
      unread: unread.count ?? 0,
      rows: (list.data ?? []).map((n) => ({
        id: n.id,
        kind: n.kind,
        body: n.body,
        readAt: n.read_at,
        doneAt: n.done_at,
        createdAt: n.created_at,
        item: n.items ? { sheetId: n.items.sheet_id, displayId: n.items.display_id } : null,
      })),
    });
  }, [orgId, userId]);

  useEffect(() => {
    let cancelled = false;
    const db = createClient();
    let channel: ReturnType<typeof db.channel> | null = null;
    void load();
    (async () => {
      const { data } = await db.auth.getSession();
      if (cancelled) return;
      if (data.session) db.realtime.setAuth(data.session.access_token);
      channel = db
        .channel(`inbox:${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
          () => void load(),
        )
        // anything that arrived between the first load and the subscription is fetched once it is live
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') void load();
        });
    })();
    // realtime is the fast path; a slow poll and focus catch events lost while its connection was down
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(poll);
      window.removeEventListener('focus', onFocus);
      if (channel) void db.removeChannel(channel);
    };
  }, [load, userId]);

  return { state, reload: load, setState };
}

export function Inbox({
  org,
  orgId,
  userId,
  timeZone,
}: {
  org: string;
  orgId: string;
  userId: string;
  timeZone: string;
}) {
  const { inboxOpen, setInboxOpen } = useShell();
  const { state, reload, setState } = useInbox(orgId, userId);
  const router = useRouter();
  const unread = state.status === 'ready' ? state.unread : 0;

  // opening the inbox (top bar or phone bottom bar) shows the latest
  useEffect(() => {
    if (inboxOpen) void reload();
  }, [inboxOpen, reload]);

  const markRead = async (ids?: string[]) => {
    // optimistic: the badge and the dots change at once; a failure reloads the truth
    if (state.status === 'ready') {
      const marked = state.rows.filter((r) => !r.readAt && (!ids || ids.includes(r.id))).length;
      const now = new Date().toISOString();
      setState({
        status: 'ready',
        unread: ids ? Math.max(0, state.unread - marked) : 0,
        rows: state.rows.map((r) =>
          !r.readAt && (!ids || ids.includes(r.id)) ? { ...r, readAt: now } : r,
        ),
      });
    }
    const r = await markNotificationsReadAction(ids ? { org, ids } : { org });
    if (!r.ok) toast.error(r.error.message);
    void reload();
  };

  const open = (row: Row) => {
    if (!row.readAt) void markRead([row.id]);
    setInboxOpen(false);
    if (row.item)
      router.push(`/${org}/s/${row.item.sheetId}?item=${encodeURIComponent(row.item.displayId)}`);
  };

  return (
    <Popover open={inboxOpen} onOpenChange={setInboxOpen}>
      <PopoverTrigger
        className="hover:bg-soft text-label-14 relative flex h-8 items-center gap-1.5 rounded-md px-2.5 font-medium"
        aria-label={unread > 0 ? `Inbox ${unread > 99 ? '99+' : unread} unread` : 'Inbox'}
        data-testid="inbox-button"
        data-state-loaded={state.status === 'ready' ? '' : undefined}
      >
        <Bell className="size-4" aria-hidden />
        <span className="desk-only">Inbox</span>
        {/* the visible words read "Inbox 4", the start of the name (WCAG 2.5.3, label in name); flex drops the space */}
        {unread > 0 ? ' ' : null}
        {unread > 0 ? (
          <span
            className="bg-crit text-label-12 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 font-bold text-white"
            data-testid="inbox-count"
            aria-hidden
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-[min(380px,calc(100vw-24px))] flex-col gap-2 p-0"
      >
        <div className="flex items-center justify-between gap-2 px-3 pt-3">
          <h2 className="text-heading-16">Inbox</h2>
          <button
            type="button"
            className="text-info text-label-13 inline-flex items-center gap-1 rounded px-1 font-semibold disabled:text-[var(--muted)] disabled:opacity-60"
            disabled={unread === 0}
            onClick={() => void markRead()}
          >
            <CheckCheck className="size-4" aria-hidden /> Mark all read
          </button>
        </div>
        <div className="max-h-[min(60vh,440px)] overflow-y-auto px-1">
          {state.status === 'loading' ? (
            <div
              aria-busy="true"
              aria-label="Loading the inbox"
              className="flex flex-col gap-1 p-2"
            >
              {[0, 1, 2].map((i) => (
                <div key={i} className="bg-soft h-12 animate-pulse rounded" />
              ))}
            </div>
          ) : state.status === 'error' ? (
            <div role="alert" className="text-label-13 flex flex-col items-start gap-2 p-2">
              <p className="m-0">The inbox could not be loaded.</p>
              <button
                type="button"
                className="border-line rounded-md border px-2 py-1 font-semibold"
                onClick={() => void reload()}
              >
                Retry
              </button>
            </div>
          ) : state.rows.length === 0 ? (
            <p className="text-muted-foreground text-copy-13 m-0 p-2">
              Nothing here yet. Notifications and requests for you will show here.
            </p>
          ) : (
            <ul className="flex flex-col" aria-label="Latest notifications">
              {state.rows.map((row) => (
                <li
                  key={row.id}
                  className={cn(
                    'flex items-start gap-1 rounded-md',
                    !row.readAt && 'bg-[var(--sel)]',
                  )}
                >
                  <button
                    type="button"
                    className="hover:bg-subtle flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left"
                    onClick={() => open(row)}
                    disabled={!row.item}
                  >
                    <span className="text-muted-foreground text-label-12 flex items-center gap-1.5 font-medium">
                      {!row.readAt ? (
                        <span className="bg-info size-2 shrink-0 rounded-full" aria-hidden />
                      ) : null}
                      {KIND_LABEL[row.kind] ?? 'Notification'}
                      {!row.readAt ? <span className="sr-only">, unread</span> : null}
                      {row.kind === 'request' && row.doneAt ? (
                        <span className="text-good inline-flex items-center gap-0.5 normal-case">
                          <Check className="size-3" aria-hidden /> Done
                        </span>
                      ) : null}
                    </span>
                    <span className="text-label-13 line-clamp-3 break-words">{row.body}</span>
                    <span className="text-muted-foreground text-label-12">
                      {formatDateTime(row.createdAt, timeZone)}
                    </span>
                  </button>
                  {!row.readAt ? (
                    <button
                      type="button"
                      className="hover:bg-soft mt-1.5 mr-1 flex size-8 shrink-0 items-center justify-center rounded-md"
                      aria-label="Mark read"
                      title="Mark read"
                      onClick={() => void markRead([row.id])}
                    >
                      <Check className="size-4" aria-hidden />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-line border-t px-3 py-2">
          <Link
            href={`/${org}/my-work`}
            className="text-info text-label-13 font-semibold"
            onClick={() => setInboxOpen(false)}
          >
            Open My work
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
