'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Copy, Lock, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { describeTrigger } from '@/engine/automations';
import { formatDateTime } from '@/engine/fields/helpers';
import type { Ctx } from '@/engine/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import {
  deleteAutomationAction,
  duplicateAutomationAction,
  toggleAutomationAction,
} from '@/app/[org]/automations/actions';
import { automationsKey, type AutomationSummary } from './queries';

// The list of automations (docs/04 §10, FR-32): on/off switch, name, trigger summary, runs, last run, source; edit,
// duplicate and delete for editors (locked automations: admins). Used on the Automations page and in the sheet's
// side sheet.

export function sourceLabel(source: string): string {
  if (source.startsWith('template:')) return 'Recipe';
  if (source.startsWith('pack:')) return 'Pack';
  return 'Custom';
}

export interface ListPermissions {
  canEdit: boolean;
  isAdmin: boolean;
}

export function AutomationList({
  org,
  orgId,
  automations,
  perms,
  ctxOf,
  sheetName,
  timeZone,
  editHref,
  onDuplicated,
}: {
  org: string;
  orgId: string;
  automations: AutomationSummary[];
  perms: ListPermissions;
  /** The Ctx of an automation's sheet, for the trigger summary (null while loading). */
  ctxOf(sheetId: string): Ctx | null;
  /** Set when the list spans sheets: the sheet's name is shown on each row. */
  sheetName?: (sheetId: string) => string | undefined;
  timeZone: string;
  editHref(a: AutomationSummary): string;
  onDuplicated?(id: string): void;
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

  const duplicate = async (a: AutomationSummary) => {
    const r = await duplicateAutomationAction({ org, automationId: a.id });
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    toast.success('Copy saved. It is off until you turn it on.');
    await refresh();
    onDuplicated?.(r.data.id);
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
    toast.success(`“${a.name}” deleted. Its runs stay in the run log.`);
    void refresh();
  };

  return (
    <>
      <ul
        className="border-line bg-surface m-0 flex list-none flex-col overflow-hidden rounded-lg border p-0"
        aria-label="Automations"
      >
        {automations.map((a) => {
          const ctx = ctxOf(a.sheetId);
          const mayChange = perms.canEdit && (!a.locked || perms.isAdmin);
          return (
            <li
              key={a.id}
              className="border-line hover:bg-subtle flex flex-wrap items-start gap-3 border-t px-4 py-3.5 first:border-t-0"
            >
              <div className="flex items-center gap-2 pt-0.5">
                <Switch
                  checked={a.enabled}
                  disabled={!mayChange || busy === a.id}
                  aria-label={a.name}
                  onCheckedChange={(v) => void toggle(a, v)}
                />
                <span className="text-muted-foreground text-12 w-7 font-medium">
                  {a.enabled ? 'On' : 'Off'}
                </span>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-medium break-words">
                  {mayChange ? (
                    <Link href={editHref(a)} className="hover:underline">
                      {a.name}
                    </Link>
                  ) : (
                    a.name
                  )}
                  {sheetName ? (
                    <span className="text-muted-foreground font-normal">
                      {' '}
                      · {sheetName(a.sheetId) ?? 'Archived sheet'}
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground text-13">
                  {ctx ? describeTrigger(a.trigger, ctx) : 'Loading…'}
                </span>
                <span className="text-muted-foreground text-12 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>
                    {a.runCount === 1 ? '1 run' : `${a.runCount.toLocaleString('en-GB')} runs`}
                  </span>
                  <span>
                    Last run {a.lastRunAt ? formatDateTime(a.lastRunAt, timeZone) : 'never'}
                  </span>
                  <span className="border-line bg-surface text-12 rounded-full border px-1.5 py-px font-mono">
                    {sourceLabel(a.source)} · v{a.version}
                  </span>
                  {a.locked ? (
                    <span className="inline-flex items-center gap-1">
                      <Lock className="size-3" aria-hidden /> Locked
                    </span>
                  ) : null}
                </span>
              </div>
              {perms.canEdit ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`More actions for ${a.name}`}
                    >
                      <MoreHorizontal aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {mayChange ? (
                      <DropdownMenuItem asChild>
                        <Link href={editHref(a)}>
                          <Pencil aria-hidden /> Edit
                        </Link>
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onSelect={() => void duplicate(a)}>
                      <Copy aria-hidden /> Duplicate
                    </DropdownMenuItem>
                    {mayChange ? (
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(a)}>
                        <Trash2 aria-hidden /> Delete
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          );
        })}
      </ul>
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
