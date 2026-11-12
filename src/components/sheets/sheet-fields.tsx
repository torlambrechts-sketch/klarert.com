'use client';

import { useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Lock, Plus } from 'lucide-react';
import { resolveFieldType } from '@/engine/fields/resolve';
import { sheetCtx } from '@/engine/sheet-data';
import { fieldUI } from '@/components/fields/registry';
import type { ConfigEnv } from '@/components/fields/types';
import { FieldPicker } from '@/components/grid/field-picker';
import { FieldSettings } from '@/components/grid/field-settings';
import {
  createGridStore,
  GridStoreContext,
  useGrid,
  useGridStore,
} from '@/components/grid/grid-store';
import { mayEditField } from '@/components/grid/use-commit';
import { useSheetActions, useSheetQuery, useSheetsList } from '@/components/grid/use-sheet';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

// The Fields section of the sheet settings page: every field with its type, a lock for fields the app keeps, and
// "Edit" for the same field settings sheet the column menus open (options of label types live there). "Add field"
// uses the add-field picker of the sheet.

export interface SheetFieldsProps {
  org: string;
  sheetId: string;
  userId: string;
  timeZone: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  /** Archived sheets take no new fields. */
  archived: boolean;
}

export function SheetFields(props: SheetFieldsProps) {
  const [client] = useState(
    () =>
      new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: 1 } } }),
  );
  const [store] = useState(() => createGridStore());
  return (
    <QueryClientProvider client={client}>
      <GridStoreContext.Provider value={store}>
        <FieldsBody {...props} />
      </GridStoreContext.Provider>
    </QueryClientProvider>
  );
}

function FieldsBody({ org, sheetId, userId, timeZone, role, archived }: SheetFieldsProps) {
  const query = useSheetQuery(sheetId);
  const actions = useSheetActions(org, sheetId);
  const store = useGridStore();
  const settingsFor = useGrid((s) => s.settingsFor);
  const [adding, setAdding] = useState(false);
  const canEdit = role !== 'viewer';
  const isAdmin = role === 'owner' || role === 'admin';
  const data = query.data;
  const sheets = useSheetsList(data?.sheet.orgId);
  const [now] = useState(() => new Date());
  const ctx = useMemo(
    () =>
      data
        ? sheetCtx(data, {
            now,
            timeZone,
            userId,
            isAdmin,
            newId: (p) => `${p}${Math.random().toString(36).slice(2, 8)}`,
          })
        : null,
    [data, now, timeZone, userId, isAdmin],
  );
  const env: ConfigEnv | null = useMemo(
    () =>
      data && ctx
        ? {
            sheet: data.sheet,
            fields: data.fields,
            sheets: sheets.data ?? [],
            ctx,
            firstItemId: data.items[0]?.id,
          }
        : null,
    [data, ctx, sheets.data],
  );

  if (query.isError)
    return (
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="text-sm font-semibold">The fields could not be loaded.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    );
  if (!data || !ctx || !env)
    return (
      <div aria-busy="true" aria-label="Loading the fields" className="flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="bg-soft h-9 animate-pulse rounded" />
        ))}
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      {data.fields.length === 0 ? (
        <p className="text-muted-foreground text-sm">No fields yet.</p>
      ) : (
        <ul className="divide-line flex flex-col divide-y" aria-label="Fields">
          {data.fields.map((f) => {
            const Icon = fieldUI(f.type).icon;
            const editable = mayEditField(f, { canEdit, isAdmin });
            return (
              <li key={f.id} className="flex items-center gap-3 py-2">
                <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5 font-semibold">
                    <span className="truncate">{f.name}</span>
                    {f.locked ? (
                      <span title="Kept by the app. Only owners and admins can change it.">
                        <Lock className="size-3.5" aria-hidden />
                        <span className="sr-only">(kept by the app)</span>
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    {resolveFieldType(f.type)?.label ?? f.type}{' '}
                    <span className="font-mono">{`{${f.key}}`}</span>
                  </span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`${editable ? 'Edit' : 'View'} ${f.name}`}
                  onClick={() => store.getState().openSettings(f.id)}
                >
                  {editable ? 'Edit' : 'View'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && !archived ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setAdding(true)}
        >
          <Plus aria-hidden /> Add field
        </Button>
      ) : null}
      <FieldSettings
        field={data.fields.find((f) => f.id === settingsFor) ?? null}
        ctx={ctx}
        env={env}
        canEdit={canEdit}
        isAdmin={isAdmin}
        actions={actions}
        onClose={() => store.getState().openSettings(null)}
      />
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="w-[min(380px,calc(100vw-32px))]">
          <DialogTitle className="text-lg font-bold">Add a field</DialogTitle>
          <DialogDescription className="sr-only">
            Choose the type of the new field.
          </DialogDescription>
          <FieldPicker
            onPick={(type, name) => {
              setAdding(false);
              void actions.addField(type, undefined, name);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
