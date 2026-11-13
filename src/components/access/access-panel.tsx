'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/engine/fields/helpers';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  GRANT_LEVELS,
  LEVEL_LABEL,
  ROLE_LABEL,
  isReadOnlyRole,
  whoCanSee,
  type GrantLevel,
  type SheetAccessMode,
} from '@/engine/access';
import type { AccessInfo, AccessPerson } from '@/server/commands/access';
import type { Result } from '@/server/result';
import {
  getFolderAccessAction,
  getSheetAccessAction,
  setAccessGrantAction,
  setFolderAccessAction,
  setSheetAccessAction,
} from '@/app/[org]/access-actions';

// The Access panel (docs/02 §16, docs/05 §2.1): who can see a folder or a sheet, and with which level. Owners and
// admins who have access change it; everyone else who can read it sees the summary. Every change is logged by the
// database on the sheet's or the workspace's chain.

export type AccessTarget = { kind: 'sheet' | 'folder'; id: string; name: string };

const MODES: { id: SheetAccessMode; label: string; hint: string }[] = [
  { id: 'inherit', label: 'Same as its folder', hint: 'Follows the folder’s access.' },
  { id: 'open', label: 'Everyone in the workspace', hint: 'By their workspace role.' },
  { id: 'restricted', label: 'Only people I choose', hint: 'And the workspace owners.' },
];

export function AccessDialog({
  org,
  target,
  onClose,
  timeZone,
}: {
  org: string;
  target: AccessTarget | null;
  onClose(): void;
  timeZone?: string;
}) {
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-32px)] w-[min(560px,calc(100vw-32px))] overflow-y-auto">
        <DialogTitle className="text-heading-16 pr-8">Access to {target?.name ?? ''}</DialogTitle>
        <DialogDescription className="text-copy-13 text-muted-foreground -mt-2">
          {target?.kind === 'folder'
            ? 'Its sheets follow the folder unless a sheet has its own setting.'
            : 'Who can see, comment on and edit this sheet and its sub-items.'}
        </DialogDescription>
        {target ? (
          <AccessPanel
            key={`${target.kind}:${target.id}`}
            org={org}
            target={target}
            timeZone={timeZone}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function AccessPanel({
  org,
  target,
  timeZone = 'Europe/London',
}: {
  org: string;
  target: AccessTarget;
  timeZone?: string;
}) {
  const router = useRouter();
  const [info, setInfo] = useState<AccessInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const modeName = useId();

  const load = useCallback(async () => {
    setError(null);
    const r =
      target.kind === 'sheet'
        ? await getSheetAccessAction({ org, sheetId: target.id })
        : await getFolderAccessAction({ org, folderId: target.id });
    if (r.ok) setInfo(r.data);
    else setError(r.error.message);
  }, [org, target.id, target.kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async <T,>(p: Promise<Result<T>>, done: string) => {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (!r.ok) return toast.error(r.error.message);
    toast(done);
    await load();
    router.refresh();
  };

  if (error)
    return (
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="m-0">{error}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  if (!info)
    return (
      <div aria-busy="true" aria-label="Loading access" className="flex flex-col gap-2">
        <div className="bg-soft h-9 animate-pulse rounded" />
        <div className="bg-soft h-9 animate-pulse rounded" />
        <div className="bg-soft h-24 animate-pulse rounded" />
      </div>
    );

  const listed = info.people.filter((p) => p.grant).length;
  const owners = info.people.filter((p) => p.role === 'owner').length;
  // the list that decides: the sheet's own, or (a sheet following a restricted folder) the folder's
  const ownList = info.kind === 'folder' || info.source === 'sheet';
  const mode = info.mode;

  const setMode = (next: SheetAccessMode) =>
    run(
      setSheetAccessAction({ org, sheetId: info.id, mode: next }),
      next === 'restricted'
        ? 'Sheet restricted. Choose who can see it.'
        : next === 'open'
          ? 'Everyone in the workspace can see this sheet.'
          : 'This sheet follows its folder.',
    );
  const setFolder = (restricted: boolean) =>
    run(
      setFolderAccessAction({ org, folderId: info.id, restricted }),
      restricted ? 'Folder restricted. Choose who can see it.' : 'Everyone can see this folder.',
    );
  const setLevel = (p: AccessPerson, level: GrantLevel | null) =>
    run(
      setAccessGrantAction({
        org,
        kind: info.kind === 'folder' ? 'folder' : 'sheet',
        targetId: info.id,
        userId: p.userId,
        level,
      }),
      level ? `${p.name}: ${LEVEL_LABEL[level].toLowerCase()}.` : `${p.name} no longer has access.`,
    );

  return (
    <div className="flex flex-col gap-4" aria-busy={busy || undefined}>
      <p
        role="status"
        className="bg-subtle border-line text-copy-13 flex items-start gap-2 rounded-lg border p-3"
      >
        {info.restricted ? (
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        ) : (
          <Users className="mt-0.5 size-4 shrink-0" aria-hidden />
        )}
        <span>
          <strong className="font-semibold">{info.restricted ? 'Restricted. ' : 'Open. '}</strong>
          {whoCanSee({
            restricted: info.restricted,
            listed,
            owners,
            source: info.source,
            folderName: info.folder?.name,
          })}
          {info.myLevel !== 'none' ? ` You: ${LEVEL_LABEL[info.myLevel].toLowerCase()}.` : null}
        </span>
      </p>

      {info.kind === 'sheet' && mode ? (
        <fieldset className="flex flex-col gap-1.5" disabled={!info.canManage || busy}>
          <legend className="text-label-13 mb-1 font-semibold">Who can see this sheet</legend>
          {MODES.filter((m) => m.id !== 'inherit' || info.folder).map((m) => (
            <label
              key={m.id}
              className="has-[:checked]:border-focus border-line text-label-14 flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 has-[:disabled]:cursor-default"
            >
              <input
                type="radio"
                name={modeName}
                value={m.id}
                checked={mode === m.id}
                onChange={() => void setMode(m.id)}
                className="mt-1"
              />
              <span className="flex flex-col">
                <span>
                  {m.id === 'inherit' && info.folder
                    ? `Same as ${info.folder.name} (${info.folder.restricted ? 'restricted' : 'everyone'})`
                    : m.label}
                </span>
                <span className="text-muted-foreground text-label-12">{m.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {info.kind === 'folder' ? (
        <fieldset className="flex flex-col gap-1.5" disabled={!info.canManage || busy}>
          <legend className="text-label-13 mb-1 font-semibold">Who can see this folder</legend>
          {[
            { v: false, label: 'Everyone in the workspace', hint: 'By their workspace role.' },
            { v: true, label: 'Only people I choose', hint: 'And the workspace owners.' },
          ].map((m) => (
            <label
              key={String(m.v)}
              className="has-[:checked]:border-focus border-line text-label-14 flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2"
            >
              <input
                type="radio"
                name={modeName}
                checked={info.restricted === m.v}
                onChange={() => void setFolder(m.v)}
                className="mt-1"
              />
              <span className="flex flex-col">
                <span>{m.label}</span>
                <span className="text-muted-foreground text-label-12">{m.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {!info.canManage ? (
        <p className="text-muted-foreground text-copy-13 m-0">
          Only owners, and admins who have access, can change who has access.
        </p>
      ) : null}

      {info.restricted ? (
        <section aria-labelledby={`${modeName}-people`} className="flex flex-col gap-2">
          <h3 id={`${modeName}-people`} className="text-label-13 m-0 font-semibold">
            People
          </h3>
          {!ownList ? (
            <p className="text-muted-foreground text-copy-13 m-0">
              This sheet uses the list of {info.folder?.name}. Change it on the folder, or choose
              “Only people I choose” to give the sheet its own list.
            </p>
          ) : null}
          {info.people.length === 0 ? (
            <p className="text-muted-foreground text-copy-13 m-0">No members yet.</p>
          ) : (
            <ul className="divide-line flex flex-col divide-y">
              {info.people.map((p) => (
                <PersonRow
                  key={p.userId}
                  person={p}
                  editable={info.canManage && ownList && !busy}
                  onChange={(l) => void setLevel(p, l)}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section aria-labelledby={`${modeName}-log`} className="flex flex-col gap-2">
        <h3 id={`${modeName}-log`} className="text-label-13 m-0 font-semibold">
          Access log
        </h3>
        {info.log.length === 0 ? (
          <p className="text-muted-foreground text-copy-13 m-0">No access changes yet.</p>
        ) : (
          <ol className="flex flex-col gap-1.5" data-testid="access-log">
            {info.log.map((l) => (
              <li key={l.id} className="text-copy-13 flex flex-col">
                <span>
                  <strong className="font-semibold">{l.who}</strong> · {l.text}
                </span>
                <time dateTime={l.at} className="text-muted-foreground text-label-12">
                  {formatDateTime(l.at, timeZone)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function PersonRow({
  person,
  editable,
  onChange,
}: {
  person: AccessPerson;
  editable: boolean;
  onChange(level: GrantLevel | null): void;
}) {
  const id = useId();
  // a grant never gives more than the workspace role: viewers and auditors read only
  const choices = isReadOnlyRole(person.role) ? (['viewer'] as GrantLevel[]) : [...GRANT_LEVELS];
  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      <Avatar initials={person.initials} color={person.color} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{person.name}</span>
        <span className="text-muted-foreground text-label-12">{ROLE_LABEL[person.role]}</span>
      </span>
      {person.role === 'owner' ? (
        <span className="text-muted-foreground text-label-13">Always has access</span>
      ) : editable ? (
        <>
          <label htmlFor={id} className="sr-only">
            Access for {person.name}
          </label>
          <select
            id={id}
            value={person.grant ?? ''}
            onChange={(e) => onChange((e.currentTarget.value || null) as GrantLevel | null)}
            className="border-input bg-background-100 text-label-13 h-[32px] rounded-md border px-2"
          >
            <option value="">No access</option>
            {choices.map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABEL[l]}
              </option>
            ))}
          </select>
        </>
      ) : (
        <span className="text-label-13">{LEVEL_LABEL[person.level]}</span>
      )}
    </li>
  );
}

function Avatar({ initials, color }: { initials: string; color: string }) {
  return (
    <span
      className="text-label-12 flex size-8 shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ background: `var(--label-${color}, var(--label-blue))` }}
      aria-hidden
    >
      {initials}
    </span>
  );
}
