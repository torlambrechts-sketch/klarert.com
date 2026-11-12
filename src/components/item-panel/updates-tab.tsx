'use client';

import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Users, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  deleteUpdateAction,
  editUpdateAction,
  postUpdateAction,
} from '@/app/[org]/s/panel-actions';
import { formatDateTime } from '@/engine/fields/helpers';
import {
  activeMention,
  insertMention,
  parseMentions,
  suggestMentions,
  type MentionCandidate,
} from '@/engine/mentions';
import type { Ctx, Item } from '@/engine/types';
import { Avatar } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { panelKeys, type UpdateRow } from './queries';

// Updates (docs/05 §3.4, FR-28): a composer with @mention autocomplete for people and job roles, and the feed newest
// first. Authors may edit or delete their own update for 15 minutes (the database enforces the window and logs both).

const EDIT_WINDOW_MS = 15 * 60 * 1000;

export function mentionCandidates(ctx: Ctx): MentionCandidate[] {
  return [
    ...[...ctx.people.values()].map((p) => ({ kind: 'person' as const, id: p.id, name: p.name })),
    ...[...ctx.jobRoles.values()].map((r) => ({ kind: 'role' as const, id: r.id, name: r.name })),
  ];
}

/** A textarea with an @mention list under it (combobox pattern: arrows, Enter or Tab picks, Esc closes). */
function MentionTextarea({
  value,
  onChange,
  candidates,
  label,
  placeholder,
  onSubmit,
  autoFocus,
}: {
  value: string;
  onChange(v: string): void;
  candidates: MentionCandidate[];
  label: string;
  placeholder?: string;
  onSubmit(): void;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const mention = activeMention(value, caret);
  const open = !!mention && dismissed !== mention.start;
  const options = open ? suggestMentions(mention!.query, candidates) : [];
  const show = open && options.length > 0;

  // the caret after inserting a name, applied once the new text is in the textarea (before the next keystroke)
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const at = pendingCaret.current;
    if (at === null || !ref.current) return;
    pendingCaret.current = null;
    ref.current.focus();
    ref.current.setSelectionRange(at, at);
  }, [value]);

  const choose = (c: MentionCandidate) => {
    if (!mention) return;
    const next = insertMention(value, mention.start, caret, c.name);
    pendingCaret.current = next.caret;
    onChange(next.text);
    setCaret(next.caret);
    setActive(0);
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        aria-label={label}
        placeholder={placeholder}
        autoFocus={autoFocus}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={show}
        aria-controls={listId}
        aria-activedescendant={show ? `${listId}-${active}` : undefined}
        className="border-input focus-visible:border-focus focus-visible:ring-focus/30 min-h-20 w-full resize-y rounded-md border bg-white px-2 py-1.5 text-sm outline-none focus-visible:ring-2"
        value={value}
        maxLength={10_000}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
          setActive(0);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (show) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              return setActive((a) => (a + 1) % options.length);
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              return setActive((a) => (a - 1 + options.length) % options.length);
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              return choose(options[active]!);
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              return setDismissed(mention!.start);
            }
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="People and job roles"
        hidden={!show}
        className="border-line absolute top-full left-0 z-10 mt-1 max-h-56 w-72 overflow-auto rounded-md border bg-white p-1 shadow-lg"
      >
        {options.map((c, i) => (
          <li
            key={`${c.kind}:${c.id}`}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm',
              i === active && 'bg-sel',
            )}
            onMouseDown={(e) => {
              e.preventDefault();
              choose(c);
            }}
          >
            {c.kind === 'role' ? <Users className="size-3.5" aria-hidden /> : null}
            <span className="flex-1">{c.name}</span>
            <span className="text-muted-foreground text-xs">
              {c.kind === 'role' ? 'Job role' : 'Person'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The body with mentions in bold. */
function Body({ text, candidates }: { text: string; candidates: MentionCandidate[] }) {
  const spans = parseMentions(text, candidates);
  const parts: React.ReactNode[] = [];
  let at = 0;
  spans.forEach((s, i) => {
    if (s.start > at) parts.push(text.slice(at, s.start));
    parts.push(
      <strong key={i} className="text-info font-semibold">
        {text.slice(s.start, s.end)}
      </strong>,
    );
    at = s.end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <p className="m-0 text-[13.5px] break-words whitespace-pre-wrap">{parts}</p>;
}

export function UpdatesTab({
  org,
  item,
  ctx,
  canEdit,
  updates,
  state,
  onRetry,
}: {
  org: string;
  item: Item;
  ctx: Ctx;
  canEdit: boolean;
  updates: UpdateRow[];
  state: 'loading' | 'error' | 'ready';
  onRetry(): void;
}) {
  const qc = useQueryClient();
  const candidates = useMemo(() => mentionCandidates(ctx), [ctx]);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: panelKeys.updates(item.id) });
    void qc.invalidateQueries({ queryKey: panelKeys.activity(item.id) });
  };

  const post = async () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    const r = await postUpdateAction({ org, itemId: item.id, body });
    setPosting(false);
    if (!r.ok) return toast.error(r.error.message);
    setDraft('');
    refresh();
    const n = r.data.notified;
    toast(
      n ? `Update posted. ${n === 1 ? '1 person' : `${n} people`} notified.` : 'Update posted.',
    );
  };

  const saveEdit = async () => {
    if (!editing) return;
    const body = editing.body.trim();
    if (!body) return;
    const r = await editUpdateAction({ org, updateId: editing.id, body });
    if (!r.ok) return toast.error(r.error.message);
    setEditing(null);
    refresh();
    toast('Update changed.');
  };

  const remove = async (id: string) => {
    setConfirmDelete(null);
    const r = await deleteUpdateAction({ org, updateId: id });
    if (!r.ok) return toast.error(r.error.message);
    refresh();
    toast('Update deleted.');
  };

  const now = ctx.now.getTime();

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void post();
          }}
        >
          <MentionTextarea
            label="Write an update"
            placeholder="Write an update, @mention a person or job role"
            value={draft}
            onChange={setDraft}
            candidates={candidates}
            onSubmit={() => void post()}
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={posting || !draft.trim()}>
              {posting ? 'Posting…' : 'Post update'}
            </Button>
            <span className="text-muted-foreground text-xs">
              Type @ to mention someone. Ctrl+Enter posts.
            </span>
          </div>
        </form>
      ) : (
        <p className="text-muted-foreground text-sm">
          You can read updates. Ask an editor or admin to post one.
        </p>
      )}
      {state === 'loading' ? (
        <div aria-busy="true" aria-label="Loading updates" className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="bg-soft h-14 animate-pulse rounded" />
          ))}
        </div>
      ) : state === 'error' ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm">
          <p>The updates could not be loaded.</p>
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : updates.length === 0 ? (
        <p className="text-muted-foreground text-sm">No updates yet. Post the first one.</p>
      ) : (
        <ol className="flex flex-col gap-3" aria-label="Updates">
          {updates.map((u) => {
            const mine =
              u.kind === 'update' &&
              u.author_id === ctx.userId &&
              now - new Date(u.created_at).getTime() < EDIT_WINDOW_MS;
            const author =
              u.kind === 'automation'
                ? 'Automation'
                : u.author_id
                  ? (ctx.people.get(u.author_id)?.name ?? 'Former member')
                  : 'System';
            return (
              <li key={u.id} className="flex gap-2">
                {u.kind === 'automation' || !u.author_id ? (
                  <span
                    className="bg-ink inline-flex size-6 shrink-0 items-center justify-center rounded-full text-white"
                    aria-hidden
                  >
                    <Zap className="size-3.5" />
                  </span>
                ) : (
                  <Avatar id={u.author_id} ctx={ctx} />
                )}
                <div className="bg-soft flex min-w-0 flex-1 flex-col gap-1 rounded-md px-3 py-2">
                  <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-xs">
                    <b className="text-[13px]">{author}</b>
                    <span className="text-muted-foreground">
                      {formatDateTime(u.created_at, ctx.timeZone)}
                    </span>
                  </p>
                  {editing?.id === u.id ? (
                    <form
                      className="flex flex-col gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveEdit();
                      }}
                    >
                      <MentionTextarea
                        label="Edit your update"
                        value={editing.body}
                        onChange={(body) => setEditing({ id: u.id, body })}
                        candidates={candidates}
                        onSubmit={() => void saveEdit()}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <Button type="submit" size="sm">
                          Save
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <Body text={u.body} candidates={candidates} />
                  )}
                  {mine && editing?.id !== u.id ? (
                    confirmDelete === u.id ? (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span>Delete this update? The activity log keeps a record.</span>
                        <Button type="button" size="sm" onClick={() => void remove(u.id)}>
                          Delete
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirmDelete(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing({ id: u.id, body: u.body })}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmDelete(u.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    )
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
