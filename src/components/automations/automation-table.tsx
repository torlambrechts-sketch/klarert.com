'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { Copy, FlaskConical, Lock, Plus, Sheet as SheetIcon, Trash2, Zap } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { describeAutomation } from '@/engine/automations';
import { formatDateTime } from '@/engine/fields/helpers';
import type { Ctx } from '@/engine/types';
import { ListHeader, RowCaret, RowDrawer, RowIcon } from '@/components/shell/data-list';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  deleteAutomationAction,
  duplicateAutomationAction,
  setAutomationModeAction,
  toggleAutomationAction,
} from '@/app/[org]/automations/actions';
import { sourceLabel, type ListPermissions } from './automation-list';
import { automationsKey, type AutomationSummary } from './queries';

// The Automations page's list in the board design (docs/04 §10, FR-32): one row per automation with a caret that
// opens the builder in place (?edit=), its sentence, sheet, source, version, runs, an on/off switch with its state
// word and duplicate / delete. A new automation is a row at the top (?new=1). Locked automations: admins only. An
// automation in test mode (docs/04 §14) says so under its sentence; owners and admins turn it live there.

export const AUTOMATION_GRID =
  'grid-cols-[32px_minmax(0,1fr)_80px_62px] md:grid-cols-[40px_minmax(240px,2.4fr)_minmax(140px,1.1fr)_96px_56px_96px_88px_72px]';

export function AutomationTableHeader() {
  return (
    <ListHeader className={AUTOMATION_GRID}>
      <span />
      <span>Name</span>
      <span className="hidden md:block">Sheet</span>
      <span className="hidden md:block">Source</span>
      <span className="hidden md:block">Version</span>
      <span className="hidden md:block">Runs</span>
      <span>Active</span>
      <span />
    </ListHeader>
  );
}

function SourcePill({ source }: { source: string }) {
  const label = sourceLabel(source);
  return (
    <span
      className={cn(
        'text-label-12 inline-block max-w-full truncate rounded-full px-[9px] py-0.5 font-medium whitespace-nowrap',
        label === 'Custom' ? 'bg-info-soft text-info' : 'bg-soft text-ink',
      )}
    >
      {label}
    </span>
  );
}

/** The "New automation" row at the top of the list, open, with the builder (or the sheet choice) inside. */
export function NewAutomationRow({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose(): void;
  children: React.ReactNode;
}) {
  const drawer = useId();
  return (
    <li className="border-line border-b last:border-b-0">
      <div
        className={cn('bg-subtle grid min-h-14 items-center gap-x-3 pr-3 pl-1.5', AUTOMATION_GRID)}
      >
        <RowCaret open onClick={onClose} controls={drawer} label="Close the new automation" />
        <span className="col-span-3 flex min-w-0 items-center gap-3 md:col-span-7">
          <RowIcon icon={Plus} />
          <span className="flex min-w-0 flex-col">
            <h2 className="text-label-14 m-0 truncate font-medium">{title}</h2>
            <span className="text-muted-foreground text-label-13">Not saved yet</span>
          </span>
        </span>
      </div>
      <RowDrawer id={drawer} className="pt-3.5 pb-4">
        {children}
      </RowDrawer>
    </li>
  );
}

export function AutomationRows({
  org,
  orgId,
  automations,
  perms,
  ctxOf,
  sheetName,
  openId,
  onOpen,
  editor,
  timeZone,
}: {
  timeZone: string;
  org: string;
  orgId: string;
  automations: AutomationSummary[];
  perms: ListPermissions;
  /** The Ctx of an automation's sheet, for its sentence (null while loading). */
  ctxOf(sheetId: string): Ctx | null;
  sheetName(sheetId: string): string | undefined;
  /** The automation open in the builder. */
  openId: string | null;
  onOpen(id: string | null): void;
  /** The builder of the open row. */
  editor: React.ReactNode;
}) {
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState<AutomationSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: automationsKey(orgId) });
  const patch = (id: string, change: Partial<AutomationSummary>) =>
    qc.setQueryData<AutomationSummary[]>(automationsKey(orgId), (list) =>
      list?.map((a) => (a.id === id ? { ...a, ...change } : a)),
    );

  const toggle = async (a: AutomationSummary, enabled: boolean) => {
    patch(a.id, { enabled });
    setBusy(a.id);
    const r = await toggleAutomationAction({ org, automationId: a.id, enabled });
    setBusy(null);
    if (!r.ok) {
      patch(a.id, { enabled: !enabled });
      toast.error(r.error.message);
      return;
    }
    toast.success(enabled ? `“${a.name}” is on.` : `“${a.name}” is off. It will not run.`);
    void refresh();
  };

  const goLive = async (a: AutomationSummary) => {
    patch(a.id, { mode: 'live' });
    setBusy(a.id);
    const r = await setAutomationModeAction({ org, automationId: a.id, mode: 'live' });
    setBusy(null);
    if (!r.ok) {
      patch(a.id, { mode: 'test' });
      toast.error(r.error.message);
      return;
    }
    toast.success(`“${a.name}” is live. It now notifies people and changes items.`);
    void refresh();
  };

  const duplicate = async (a: AutomationSummary) => {
    setBusy(a.id);
    const r = await duplicateAutomationAction({ org, automationId: a.id });
    setBusy(null);
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    toast.success('Copy saved. It is off until you turn it on.');
    await refresh();
  };

  const remove = async (a: AutomationSummary) => {
    setBusy(a.id);
    const r = await deleteAutomationAction({ org, automationId: a.id });
    setBusy(null);
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    setDeleting(null);
    if (openId === a.id) onOpen(null);
    toast.success(`“${a.name}” deleted. Its runs stay in the run log.`);
    void refresh();
  };

  return (
    <>
      {automations.map((a) => {
        const ctx = ctxOf(a.sheetId);
        const mayChange = perms.canEdit && (!a.locked || perms.isAdmin);
        const open = openId === a.id && mayChange;
        const drawer = `automation-${a.id}-builder`;
        return (
          <li key={a.id} className="border-line border-b last:border-b-0">
            <div
              className={cn(
                'hover:bg-subtle grid min-h-14 items-center gap-x-3 py-1.5 pr-3 pl-1.5',
                AUTOMATION_GRID,
                open && 'bg-subtle',
              )}
            >
              {mayChange ? (
                <RowCaret
                  open={open}
                  onClick={() => onOpen(open ? null : a.id)}
                  controls={open ? drawer : undefined}
                  label={`Edit ${a.name}`}
                />
              ) : (
                <span />
              )}
              <span className="flex min-w-0 items-center gap-3">
                <RowIcon icon={Zap} dim={!a.enabled} />
                <span className="flex min-w-0 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="text-label-14 line-clamp-2 font-medium break-words md:line-clamp-1">
                      {a.name}
                    </span>
                    {a.locked ? (
                      <Lock className="text-muted-foreground size-3 shrink-0" aria-label="Locked" />
                    ) : null}
                  </span>
                  <span className="text-muted-foreground text-label-13 truncate">
                    {ctx ? describeAutomation(a, ctx, sheetName) : 'Loading…'}
                  </span>
                  {a.mode === 'test' ? (
                    <span
                      className="text-label-12 flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5"
                      data-testid="automation-test-mode"
                    >
                      <span className="border-warn/40 bg-warn-soft text-warn inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium">
                        <FlaskConical className="size-3" aria-hidden />
                        Test mode
                      </span>
                      <span className="text-muted-foreground">Logs what it would do</span>
                      {perms.isAdmin ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Switch
                            checked={false}
                            disabled={busy === a.id}
                            aria-label={`Live: ${a.name}`}
                            onCheckedChange={(v) => v && void goLive(a)}
                            className="data-[state=checked]:bg-ink"
                          />
                          <span className="text-muted-foreground">Live</span>
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                  <span className="text-muted-foreground text-label-12 truncate md:hidden">
                    {sheetName(a.sheetId) ?? 'Archived sheet'} · {sourceLabel(a.source)} · v
                    {a.version}
                  </span>
                </span>
              </span>
              <span className="text-ink text-label-14 hidden min-w-0 items-center gap-[7px] md:flex">
                <SheetIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{sheetName(a.sheetId) ?? 'Archived sheet'}</span>
              </span>
              <span className="hidden min-w-0 md:block">
                <SourcePill source={a.source} />
              </span>
              <span className="text-ink text-label-13-mono hidden md:block">v{a.version}</span>
              <span className="hidden min-w-0 flex-col md:flex">
                {a.runCount > 0 ? (
                  <Link
                    href={`/${org}/automations?tab=runs&automation=${a.id}`}
                    className="text-ink hover:text-ink text-label-13-mono underline-offset-4 hover:underline"
                    aria-label={`${a.runCount.toLocaleString('en-GB')} runs of ${a.name}`}
                  >
                    {a.runCount.toLocaleString('en-GB')}
                  </Link>
                ) : (
                  <span className="text-muted-foreground text-label-13-mono">0</span>
                )}
                <span
                  className="text-muted-foreground text-label-12 truncate"
                  title={
                    a.lastRunAt ? `Last run ${formatDateTime(a.lastRunAt, timeZone)}` : undefined
                  }
                >
                  <span className="sr-only">Last run </span>
                  {a.lastRunAt ? formatDateTime(a.lastRunAt, timeZone).split(',')[0] : 'never'}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Switch
                  checked={a.enabled}
                  disabled={!mayChange || busy === a.id}
                  aria-label={a.name}
                  onCheckedChange={(v) => void toggle(a, v)}
                  className="data-[state=checked]:bg-ink"
                />
                <span className="text-muted-foreground text-label-12 w-6">
                  {a.enabled ? 'On' : 'Off'}
                </span>
              </span>
              <span className="flex justify-end gap-0.5">
                {perms.canEdit ? (
                  <button
                    type="button"
                    className="text-muted-foreground hover:bg-soft hover:text-ink focus-visible:outline-focus grid size-[30px] place-items-center rounded-md focus-visible:outline-2 disabled:opacity-30"
                    aria-label={`Duplicate ${a.name}`}
                    disabled={busy === a.id}
                    onClick={() => void duplicate(a)}
                  >
                    <Copy className="size-[15px]" aria-hidden />
                  </button>
                ) : null}
                {mayChange ? (
                  <button
                    type="button"
                    className="text-muted-foreground hover:bg-soft hover:text-ink focus-visible:outline-focus grid size-[30px] place-items-center rounded-md focus-visible:outline-2 disabled:opacity-30"
                    aria-label={`Delete ${a.name}`}
                    disabled={busy === a.id}
                    onClick={() => setDeleting(a)}
                  >
                    <Trash2 className="size-[15px]" aria-hidden />
                  </button>
                ) : null}
              </span>
            </div>
            {open ? (
              <RowDrawer id={drawer} className="pt-3.5 pb-4">
                <h2 className="sr-only">Edit automation</h2>
                {editor}
              </RowDrawer>
            ) : null}
          </li>
        );
      })}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="w-[min(420px,calc(100vw-32px))]">
          <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
          <DialogDescription>
            It stops running on every item. Its runs stay in the run log and the change is logged.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!deleting || busy === deleting.id}
              onClick={() => deleting && void remove(deleting)}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
