'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronRight, FileDown, Network, Pencil, Plus } from 'lucide-react';
import {
  deriveSheetFlow,
  flowSteps,
  type FlowGroup,
  type FlowStep,
  type FlowViewer,
  type StepEdit,
} from '@/engine/flow';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Role } from '@/engine/types';
import type { ConfigEnv } from '@/components/fields/types';
import type { SheetActions } from '@/components/grid/use-sheet';
import { Segmented } from '@/components/shell/data-list';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogTitle, SideSheetContent } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NewFormDialog } from '@/components/views/form-view';
import type { ViewsState } from '@/components/views/use-views';
import { cn } from '@/lib/utils';
import { ComingLaterChip, HealthLine, PackChip, STEP_TOP, StepIcon } from './flow-bits';
import { SheetMap } from './sheet-map';
import { ownsTitle, StepEditor, type CreateKind, type EditorEnv } from './step-editor';
import { useDesign, useRefreshDesign } from './use-design';

// The Design tab of a sheet (docs/05 §3.8; owner decision 15 Nov 2026, the board's option 2a): the sheet's flow as an
// ordered list in four groups (inputs, sheet, logic, outputs), derived from configuration, never stored. Each row says
// what the step is, its health in words with a symbol, and where it came from (a pack, changed or not, or added here).
// A row opens the side window with the existing editor for it; "+ Add" opens the same editors in create mode. The
// Map toggle draws the same steps (read-only). Keyboard: rows are buttons in one list, arrow keys move between them,
// Enter opens, Escape closes and focus returns to the row. Viewers and auditors read; nothing to drag.

type Open = { edit: StepEdit | null; create: CreateKind | null; stepId: string | null };

const ADD_LABEL: Record<FlowGroup['id'], string> = {
  inputs: 'Add input',
  sheet: '',
  logic: 'Add logic',
  outputs: 'Add output',
};

function useShow(): ['list' | 'map', (v: 'list' | 'map') => void] {
  const [show, setShow] = useState<'list' | 'map'>('list');
  useEffect(() => {
    const v = new URL(window.location.href).searchParams.get('show');
    if (v === 'map') setShow('map');
  }, []);
  const set = useCallback((v: 'list' | 'map') => {
    setShow(v);
    const url = new URL(window.location.href);
    if (v === 'map') url.searchParams.set('show', 'map');
    else url.searchParams.delete('show');
    window.history.replaceState(window.history.state, '', url.toString());
  }, []);
  return [show, set];
}

export function DesignView(props: {
  org: string;
  data: SheetData;
  ctx: Ctx;
  env: ConfigEnv;
  actions: SheetActions;
  views: ViewsState;
  role: Role;
  canEdit: boolean;
  isAdmin: boolean;
  archived: boolean;
  timeZone: string;
  userId: string;
}) {
  const { org, data } = props;
  const sheetId = data.sheet.id;
  const design = useDesign(org, sheetId);
  const refresh = useRefreshDesign(org);
  const [show, setShow] = useShow();
  const [open, setOpen] = useState<Open | null>(null);
  const [newForm, setNewForm] = useState(false);
  const lastRow = useRef<string | null>(null);
  const viewer: FlowViewer = useMemo(
    () => ({ userId: props.userId, role: props.role, now: new Date(), timeZone: props.timeZone }),
    [props.userId, props.role, props.timeZone],
  );
  const flow = useMemo(
    () => (design.data ? deriveSheetFlow(design.data.world, sheetId, viewer) : null),
    [design.data, sheetId, viewer],
  );
  const steps = useMemo(() => (flow ? flowSteps(flow) : []), [flow]);

  // ?step=<id> (from another sheet's Design tab or the workspace map) opens that step once the flow is there
  const wanted = useRef<string | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const s = url.searchParams.get('step');
    if (!s) return;
    wanted.current = s;
    url.searchParams.delete('step');
    window.history.replaceState(window.history.state, '', url.toString());
  }, []);
  useEffect(() => {
    if (!wanted.current || !steps.length) return;
    const step =
      steps.find((s) => s.id === wanted.current) ??
      steps.find((s) => s.id.startsWith(`${wanted.current}:`));
    wanted.current = null;
    if (step?.edit) {
      lastRow.current = step.id;
      setOpen({ edit: step.edit, create: null, stepId: step.id });
    }
  }, [steps]);

  const openStep = (step: FlowStep) => {
    if (!step.edit) return;
    lastRow.current = step.id;
    setOpen({ edit: step.edit, create: null, stepId: step.id });
  };
  const close = () => {
    setOpen(null);
    void refresh();
  };
  const openForm = (id: string) => {
    setOpen(null);
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'form');
    url.searchParams.set('form', id);
    url.searchParams.delete('show');
    window.history.pushState(null, '', url.toString());
  };

  // arrow keys move between the rows of the whole list (groups are headings in between)
  const listRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const rows = [
      ...(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-step-row]') ?? []),
    ];
    const i = rows.findIndex((r) => r === document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? rows.length - 1
          : Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    rows[next]?.focus();
  };

  const editorEnv: EditorEnv | null =
    design.data && flow
      ? {
          org,
          data,
          ctx: props.ctx,
          env: props.env,
          actions: props.actions,
          views: props.views,
          world: design.data.world,
          viewer,
          detail: design.data.sheet,
          canEdit: props.canEdit,
          isAdmin: props.isAdmin,
          archived: props.archived,
        }
      : null;
  const openedStep = open?.stepId ? (steps.find((s) => s.id === open.stepId) ?? null) : null;
  const titleOf = (o: Open): { title: string; description: string } => {
    if (o.create?.kind === 'automation')
      return { title: 'New automation', description: `Runs on ${data.sheet.name}.` };
    if (o.create?.kind === 'approval')
      return { title: 'Approval workflows', description: `Of ${data.sheet.name}.` };
    if (o.create?.kind === 'new_item' || o.edit?.editor === 'new_item')
      return { title: 'Manual entry', description: 'What + New asks when someone adds an item.' };
    if (openedStep) return { title: openedStep.name, description: openedStep.subline };
    if (o.edit?.editor === 'form') return { title: 'Form', description: `On ${data.sheet.name}.` };
    return { title: 'Step', description: data.sheet.name };
  };

  const addMenu = (group: FlowGroup['id']) => {
    if (!props.canEdit || props.archived || group === 'sheet') return null;
    const item = (label: string, on: () => void, testId?: string) => (
      <DropdownMenuItem key={label} onSelect={on} data-testid={testId}>
        {label}
      </DropdownMenuItem>
    );
    const create = (c: CreateKind) => () => setOpen({ edit: null, create: c, stepId: null });
    const items =
      group === 'inputs'
        ? [
            ...(props.isAdmin ? [item('New form', () => setNewForm(true))] : []),
            item('Manual entry and the New item form', create({ kind: 'new_item' })),
          ]
        : group === 'logic'
          ? [
              item('New automation', create({ kind: 'automation' })),
              ...(props.isAdmin ? [item('Approval workflow', create({ kind: 'approval' }))] : []),
            ]
          : [
              item(
                'Create an item on another sheet',
                create({ kind: 'automation', action: 'create_item' }),
              ),
              item('Notify people', create({ kind: 'automation', action: 'notify' })),
              item('Send a webhook', create({ kind: 'automation', action: 'webhook' })),
              item('Link to another sheet', async () => {
                const f = await props.actions.addField('link', undefined, 'Linked items');
                if (f)
                  setOpen({
                    edit: { editor: 'field', id: f.id, sheetId },
                    create: null,
                    stepId: null,
                  });
              }),
            ];
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="border-line-strong text-muted-foreground hover:text-ink hover:bg-surface focus-visible:outline-focus text-13 flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed focus-visible:outline-2"
          >
            <Plus className="size-4" aria-hidden /> {ADD_LABEL[group]}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          {items}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  if (design.isError)
    return (
      <div
        role="alert"
        className="border-line flex flex-col items-start gap-2 rounded-lg border p-4"
      >
        <p className="m-0 font-semibold">The design of this sheet could not be loaded.</p>
        <p className="text-muted-foreground text-13 m-0">{design.error.message}</p>
        <Button type="button" variant="outline" onClick={() => void design.refetch()}>
          Retry
        </Button>
      </div>
    );

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-6" data-testid="design-view">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="Show the flow as"
          value={show}
          options={[
            { id: 'list', label: 'List' },
            { id: 'map', label: 'Map' },
          ]}
          onChange={setShow}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/${org}/design?focus=${sheetId}`}>
              <Network aria-hidden /> Workspace design
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/${org}/design/print?sheet=${sheetId}`} data-testid="design-export">
              <FileDown aria-hidden /> Export
            </Link>
          </Button>
        </div>
      </div>
      {!props.canEdit ? (
        <p className="text-muted-foreground text-13 m-0">
          You can read this sheet’s design. Ask an editor or admin to change it.
        </p>
      ) : null}
      {!flow || !design.data ? (
        <DesignSkeleton />
      ) : show === 'map' ? (
        <SheetMap flow={flow} />
      ) : (
        <div
          ref={listRef}
          onKeyDown={onKeyDown}
          className="relative flex max-w-[760px] flex-col gap-6"
          data-testid="design-list"
        >
          {flow.groups.map((g) => (
            <section
              key={g.id}
              aria-labelledby={`design-${g.id}`}
              className="flex flex-col gap-1.5"
            >
              <div className="flex h-[26px] items-center justify-between">
                <h2
                  id={`design-${g.id}`}
                  className="text-muted-foreground text-12 m-0 font-mono tracking-[0.08em] uppercase"
                >
                  {g.number} · {g.title}
                </h2>
                {g.id !== 'sheet' ? (
                  <span className="text-muted-foreground text-12">
                    {g.steps.filter((s) => !s.comingLater).length}
                    <span className="sr-only"> steps</span>
                  </span>
                ) : null}
              </div>
              {addMenu(g.id)}
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {g.steps.length === 0 ? (
                  <li className="border-line text-muted-foreground text-13 rounded-lg border border-dashed px-3 py-3">
                    {g.id === 'logic'
                      ? 'No automations or approval workflows yet.'
                      : 'Nothing goes out of this sheet yet.'}
                  </li>
                ) : (
                  g.steps.map((s) => (
                    <li key={s.id}>
                      <StepRow step={s} canEdit={props.canEdit} onOpen={() => openStep(s)} />
                    </li>
                  ))
                )}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Dialog open={!!open} onOpenChange={(o) => !o && close()}>
        {open && editorEnv ? (
          <SideSheetContent
            aria-describedby={undefined}
            className={cn(
              'max-[759px]:w-screen max-[759px]:border-l-0',
              open.edit?.editor === 'form' ? 'w-[min(1120px,100vw)]' : 'w-[min(820px,100vw)]',
            )}
            onCloseAutoFocus={(ev) => {
              const id = lastRow.current;
              if (!id) return;
              ev.preventDefault();
              listRef.current
                ?.querySelector<HTMLButtonElement>(`[data-step-row="${CSS.escape(id)}"]`)
                ?.focus();
            }}
          >
            <div className="border-line flex h-12 shrink-0 items-center border-b px-2 min-[760px]:hidden">
              <Button type="button" variant="ghost" size="sm" onClick={close}>
                <ArrowLeft aria-hidden /> Back
              </Button>
            </div>
            {ownsTitle(open.edit, sheetId) ? (
              <StepEditor
                e={editorEnv}
                edit={open.edit}
                create={open.create}
                step={openedStep}
                onDone={close}
                onSaved={() => undefined}
                onOpenForm={openForm}
              />
            ) : (
              <>
                <div className="flex flex-col gap-0.5 px-5 pt-4 pr-12 pb-3">
                  <DialogTitle className="text-panel-title">{titleOf(open).title}</DialogTitle>
                  <DialogDescription className="text-muted-foreground text-13 m-0">
                    {titleOf(open).description}
                  </DialogDescription>
                  {openedStep?.pack ? (
                    <div className="mt-1">
                      <PackChip pack={openedStep.pack} />
                    </div>
                  ) : null}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
                  <StepEditor
                    e={editorEnv}
                    edit={open.edit}
                    create={open.create}
                    step={openedStep}
                    onDone={close}
                    onSaved={() => undefined}
                    onOpenForm={openForm}
                  />
                </div>
              </>
            )}
          </SideSheetContent>
        ) : null}
      </Dialog>
      {props.isAdmin ? (
        <NewFormDialog
          open={newForm}
          onClose={() => setNewForm(false)}
          org={org}
          sheetId={sheetId}
          onCreated={(v) => {
            setNewForm(false);
            props.views.upsert(v);
            setOpen({ edit: { editor: 'form', id: v.id, sheetId }, create: null, stepId: null });
          }}
        />
      ) : null}
    </div>
  );
}

function StepRow({ step, canEdit, onOpen }: { step: FlowStep; canEdit: boolean; onOpen(): void }) {
  if (step.comingLater)
    return (
      <div
        aria-disabled="true"
        data-testid="step-coming-later"
        className="border-line bg-page text-muted-foreground flex min-h-[52px] items-center gap-3 rounded-lg border border-dashed px-2.5 py-2"
      >
        <StepIcon kind={step.kind} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-14 font-medium">{step.name}</span>
          <span className="text-12">{step.subline}</span>
        </span>
        <ComingLaterChip />
      </div>
    );
  const inverted = step.kind === 'sheet';
  return (
    <button
      type="button"
      data-step-row={step.id}
      onClick={onOpen}
      className={cn(
        'group focus-visible:outline-focus rounded-card flex min-h-[78px] w-full items-center gap-3 border border-t-4 px-3 py-2 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2',
        inverted
          ? 'bg-navy border-navy text-surface'
          : cn('border-line-soft bg-surface hover:border-line-strong', STEP_TOP[step.kind]),
      )}
    >
      <StepIcon kind={step.kind} inverted={inverted} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-14 truncate font-medium">{step.name}</span>
        <span
          className={cn('text-12 truncate', inverted ? 'text-brand-soft' : 'text-muted-foreground')}
        >
          {step.subline}
        </span>
        {step.health || step.pack ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 sm:hidden">
            {step.health ? <HealthLine health={step.health} /> : null}
            {step.pack ? <PackChip pack={step.pack} /> : null}
          </span>
        ) : null}
      </span>
      <span className="hidden max-w-[45%] shrink-0 flex-col items-end gap-1 sm:flex">
        {step.health ? <HealthLine health={step.health} /> : null}
        {step.pack ? (
          <PackChip
            pack={step.pack}
            className={inverted ? 'border-line-strong text-faint' : undefined}
          />
        ) : null}
      </span>
      <span
        aria-hidden
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-md',
          inverted ? 'text-faint' : 'text-muted-foreground group-hover:text-ink',
        )}
      >
        {canEdit ? <Pencil className="size-[15px]" /> : <ChevronRight className="size-4" />}
      </span>
      <span className="sr-only">{canEdit ? ', edit' : ', read'}</span>
    </button>
  );
}

function DesignSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading the design"
      className="flex max-w-[760px] flex-col gap-2"
    >
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="bg-soft h-[52px] animate-pulse rounded-lg" />
      ))}
    </div>
  );
}
