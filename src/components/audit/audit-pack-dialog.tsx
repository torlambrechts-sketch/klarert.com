'use client';

import { useId, useState } from 'react';
import { Check, FileArchive, Loader2, RotateCcw } from 'lucide-react';
import { inputClass } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { AUDIT_FILE_LIMITS, formatBytes } from '@/engine/audit/pack';

// The audit pack dialog (docs/11 Audit outputs): scope (whole workspace, a folder or a pack), the period and whether
// to put the evidence files in. Posts to /[org]/audit/pack and saves the zip; the server does the work and says no
// in words when it refuses.

export interface ScopeChoice {
  value: string;
  label: string;
}

type State =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; filename: string };

function filenameOf(res: Response, fallback: string) {
  const cd = res.headers.get('content-disposition') ?? '';
  const star = cd.match(/filename\*=UTF-8''([^;]+)/);
  if (star) return decodeURIComponent(star[1]!);
  return cd.match(/filename="([^"]+)"/)?.[1] ?? fallback;
}

export function AuditPackDialog({
  org,
  folders,
  installs,
  defaultFrom,
  defaultTo,
  defaultScope = 'workspace',
  trigger = 'Make an audit pack',
}: {
  org: string;
  folders: ScopeChoice[];
  installs: ScopeChoice[];
  defaultFrom: string;
  defaultTo: string;
  defaultScope?: string;
  trigger?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState(defaultScope);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [files, setFiles] = useState(false);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const busy = state.kind === 'busy';
  const periodError = from && to && from > to ? 'The period ends before it starts.' : null;

  const run = async () => {
    if (periodError || !from || !to) return;
    setState({ kind: 'busy' });
    try {
      const body = new FormData();
      body.set('scope', scope);
      body.set('from', from);
      body.set('to', to);
      if (files) body.set('files', '1');
      const res = await fetch(`/${org}/audit/pack`, { method: 'POST', body });
      if (!res.ok) {
        const text = (await res.text()).slice(0, 300);
        setState({ kind: 'error', message: text || 'The audit pack could not be made.' });
        return;
      }
      const filename = filenameOf(res, 'Audit pack.zip');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState({ kind: 'done', filename });
    } catch {
      setState({
        kind: 'error',
        message: 'The audit pack could not be made. Check your connection.',
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next) setState({ kind: 'idle' });
      }}
    >
      <Button type="button" onClick={() => setOpen(true)} data-testid="audit-pack-open">
        <FileArchive aria-hidden /> {trigger}
      </Button>
      <DialogContent className="flex max-h-[85vh] w-[min(560px,calc(100vw-32px))] flex-col gap-4 overflow-y-auto">
        <div className="flex flex-col gap-1 pr-8">
          <DialogTitle className="text-heading-20">Audit pack</DialogTitle>
          <DialogDescription className="text-copy-14 text-muted-foreground">
            A zip with the statement of applicability, every sheet in scope as CSV, an index of
            the evidence, and the activity log of the period with its hash chains checked. Only what
            you can see goes in.
          </DialogDescription>
        </div>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-scope`} className="text-label-13 font-medium">
              Scope
            </label>
            <select
              id={`${id}-scope`}
              className={inputClass}
              value={scope}
              disabled={busy}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="workspace">Whole workspace</option>
              {folders.length ? (
                <optgroup label="Folders">
                  {folders.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {installs.length ? (
                <optgroup label="Installed packs">
                  {installs.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </div>
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="text-label-13 mb-1.5 p-0 font-medium">Period</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-label-12 text-muted-foreground">From</span>
                <input
                  type="date"
                  className={inputClass}
                  value={from}
                  required
                  disabled={busy}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-label-12 text-muted-foreground">To</span>
                <input
                  type="date"
                  className={inputClass}
                  value={to}
                  required
                  disabled={busy}
                  aria-invalid={!!periodError}
                  aria-describedby={periodError ? `${id}-period` : undefined}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </div>
            {periodError ? (
              <p id={`${id}-period`} className="text-crit-ink text-label-12 m-0">
                {periodError}
              </p>
            ) : (
              <p className="text-label-12 text-muted-foreground m-0">
                The activity log extract covers these days. Sheets and evidence are as they are
                now.
              </p>
            )}
          </fieldset>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={files}
              disabled={busy}
              onChange={(e) => setFiles(e.target.checked)}
            />
            <span className="flex flex-col">
              <span className="text-label-13 font-medium">Include the evidence files</span>
              <span className="text-label-12 text-muted-foreground">
                Files up to {formatBytes(AUDIT_FILE_LIMITS.perFile)} each,{' '}
                {formatBytes(AUDIT_FILE_LIMITS.total)} in all. Larger ones are listed in the index
                only. Each one counts as a download.
              </span>
            </span>
          </label>

          {state.kind === 'busy' ? (
            <p role="status" className="text-copy-14 m-0 flex items-center gap-1.5">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Making the pack and checking
              the hash chains. This can take a minute.
            </p>
          ) : null}
          {state.kind === 'error' ? (
            <div role="alert" className="flex flex-col items-start gap-2">
              <p className="m-0">{state.message}</p>
              <Button type="submit" variant="outline" size="sm">
                <RotateCcw aria-hidden /> Retry
              </Button>
            </div>
          ) : null}
          {state.kind === 'done' ? (
            <p role="status" className="text-copy-14 m-0 flex items-center gap-1.5">
              <Check className="text-good size-4" aria-hidden /> Saved {state.filename}. The export
              is in the activity log.
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              {state.kind === 'done' ? 'Done' : 'Cancel'}
            </Button>
            <Button
              type="submit"
              disabled={busy || !!periodError}
              data-testid="audit-pack-download"
            >
              {busy ? 'Making the pack…' : 'Download zip'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
