'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BookOpen, ListChecks, Plus, Zap } from 'lucide-react';
import type { Ctx } from '@/engine/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  SideSheetContent,
} from '@/components/ui/dialog';
import { AutomationList } from './automation-list';
import { useAutomations } from './queries';
import { ErrorBox, ListSkeleton } from './states';

// The ⚡ n button of the sheet header (docs/05 §3): this sheet's automations in a side sheet, with the on/off switch
// and links into the builder.

export function SheetAutomations({
  org,
  sheetId,
  sheetName,
  ctx,
  role,
  timeZone,
}: {
  org: string;
  sheetId: string;
  sheetName: string;
  ctx: Ctx | null;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  timeZone: string;
}) {
  const [open, setOpen] = useState(false);
  const orgId = ctx?.sheet.orgId;
  const autos = useAutomations(orgId);
  const list = (autos.data ?? []).filter((a) => a.sheetId === sheetId);
  const perms = { canEdit: role !== 'viewer', isAdmin: role === 'owner' || role === 'admin' };
  const base = `/${org}/automations`;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="h-[38px] shadow-none" disabled={!ctx}>
          <Zap aria-hidden />
          Automations{' '}
          <span
            className="bg-soft text-ink-2 rounded px-1.5 font-mono text-[11px] leading-[18px] font-normal tabular-nums empty:hidden"
            aria-hidden={autos.isPending}
          >
            {autos.isPending ? '' : list.length}
          </span>
        </Button>
      </DialogTrigger>
      <SideSheetContent className="w-[min(560px,100vw)] overflow-y-auto">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1 pr-8">
            <DialogTitle className="text-[19px] font-extrabold">Automations</DialogTitle>
            <DialogDescription className="text-muted-foreground m-0 text-sm">
              On {sheetName}. They run on every matching change; each run is logged.
            </DialogDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {perms.canEdit ? (
              <>
                <Button asChild size="sm">
                  <Link href={`${base}?new=1&sheet=${sheetId}`}>
                    <Plus aria-hidden /> New automation
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href={`${base}?recipes=1&sheet=${sheetId}`}>
                    <BookOpen aria-hidden /> Start from a recipe
                  </Link>
                </Button>
              </>
            ) : null}
            <Button asChild size="sm" variant="outline">
              <Link href={`${base}?tab=runs&sheet=${sheetId}`}>
                <ListChecks aria-hidden /> Run log
              </Link>
            </Button>
          </div>
          {!perms.canEdit ? (
            <p className="text-muted-foreground m-0 text-sm">
              You can see this sheet’s automations. Ask an editor or admin to change them.
            </p>
          ) : null}
          {autos.isError ? (
            <ErrorBox text="Automations could not be loaded." retry={() => void autos.refetch()} />
          ) : autos.isPending || !orgId ? (
            <ListSkeleton />
          ) : list.length === 0 ? (
            <p className="text-muted-foreground border-line m-0 rounded-[var(--radius-card)] border border-dashed p-4 text-sm">
              No automations on this sheet yet.
              {perms.canEdit ? ' Start from a recipe or build a new one.' : ''}
            </p>
          ) : (
            <AutomationList
              org={org}
              orgId={orgId}
              automations={list}
              perms={perms}
              ctxOf={() => ctx}
              timeZone={timeZone}
              editHref={(a) => `${base}?edit=${a.id}`}
            />
          )}
        </div>
      </SideSheetContent>
    </Dialog>
  );
}
