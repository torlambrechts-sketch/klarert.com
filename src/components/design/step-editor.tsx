'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import {
  defaultAction,
  describeAutomation,
  type ActionId,
  type AutomationDraft,
} from '@/engine/automations';
import { emptyDraft } from '@/engine/automations';
import {
  flowCtx,
  type FlowStep,
  type FlowViewer,
  type FlowWorld,
  type StepEdit,
} from '@/engine/flow';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx } from '@/engine/types';
import {
  newItemFormChoices,
  newItemPlan,
  chosenIntake,
  planQuestions,
} from '@/engine/views/new-item';
import { AutomationEditor } from '@/components/automations/automation-editor';
import { WorkflowEditor } from '@/components/approvals/workflow-editor';
import type { ConfigEnv } from '@/components/fields/types';
import { FieldSettingsBody } from '@/components/grid/field-settings';
import type { SheetActions } from '@/components/grid/use-sheet';
import { NewItemFormSetting } from '@/components/sheets/new-item-form-setting';
import { SheetSettingsForm } from '@/components/sheets/sheet-settings';
import { Button } from '@/components/ui/button';
import { FormBuilder } from '@/components/views/form-builder';
import { useFormLinks, useSetFormLink } from '@/components/views/form-view';
import type { ViewsState } from '@/components/views/use-views';
import type { DesignSheetDetail } from '@/server/design/read';
import { HealthLine, PackChip } from './flow-bits';

// The side window's body (docs/05 §3.8): the EXISTING editor for the step, so there is one editor and one copy of each
// setting. Automations: the builder; forms: the form builder; approval workflows: the workflow editor; link and
// lifecycle fields: field settings; the sheet: sheet settings; manual entry: the New item form setting. Every save goes
// through that editor's command (audit log, RLS, loop guard). People who may not change a step read it here.

/** What "+ Add" opens: an editor in create mode. */
export type CreateKind =
  { kind: 'automation'; action?: ActionId } | { kind: 'approval' } | { kind: 'new_item' };

export interface EditorEnv {
  org: string;
  data: SheetData;
  ctx: Ctx;
  env: ConfigEnv;
  actions: SheetActions;
  views: ViewsState;
  world: FlowWorld;
  viewer: FlowViewer;
  detail: DesignSheetDetail | null;
  canEdit: boolean;
  isAdmin: boolean;
  archived: boolean;
}

/** The step's own title and description come from the editor itself (field settings has its own). */
export const ownsTitle = (edit: StepEdit | null, sheetId: string) =>
  !!edit && (edit.editor === 'field' || edit.editor === 'lifecycle') && edit.sheetId === sheetId;

/** The sheet the step's object lives on, when it is another one: it is edited on that sheet's Design tab. */
const elsewhere = (edit: StepEdit, sheetId: string) => edit.sheetId !== sheetId;

function OtherSheet({ org, edit, step }: { org: string; edit: StepEdit; step: FlowStep | null }) {
  const prefix =
    edit.editor === 'automation'
      ? 'automation'
      : edit.editor === 'field'
        ? 'link_out'
        : edit.editor;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-copy-14 m-0">
        This step lives on {step?.other?.name ?? 'another sheet'}. Open it there to change it: the
        same editor, on the sheet it belongs to.
      </p>
      {step?.other?.sheetId ? (
        <div>
          <Button asChild variant="outline">
            <Link
              href={`/${org}/s/${edit.sheetId}?view=design&step=${encodeURIComponent(`${prefix}:${edit.id}`)}`}
            >
              Open in {step.other.name} <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ReadOnlyNote({ text }: { text: string }) {
  return (
    <p className="border-line bg-subtle text-copy-13 text-muted-foreground m-0 rounded-md border px-3 py-2">
      {text}
    </p>
  );
}

/** The step as words: what it is, its health and where it came from. Shown above a read-only body. */
function StepSummary({ step }: { step: FlowStep }) {
  return (
    <dl className="text-copy-13 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2">
      <dt className="text-muted-foreground">What</dt>
      <dd className="m-0">{step.subline}</dd>
      {step.health ? (
        <>
          <dt className="text-muted-foreground">Health</dt>
          <dd className="m-0">
            <HealthLine health={step.health} />
            {step.health.problems.length > 1 ? (
              <ul className="text-muted-foreground mt-1 mb-0 list-disc pl-5">
                {step.health.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : null}
          </dd>
        </>
      ) : null}
      {step.pack ? (
        <>
          <dt className="text-muted-foreground">Source</dt>
          <dd className="m-0">
            <PackChip pack={step.pack} />
          </dd>
        </>
      ) : null}
    </dl>
  );
}

const viewerText = (isEditorRole: boolean) =>
  isEditorRole
    ? 'Only owners and admins change this. You can read it here.'
    : 'You can read this step. Ask an editor or admin to change it.';

export function StepEditor({
  e,
  edit,
  create,
  step,
  onDone,
  onSaved,
  onOpenForm,
}: {
  e: EditorEnv;
  edit: StepEdit | null;
  create: CreateKind | null;
  step: FlowStep | null;
  onDone(): void;
  onSaved(): void;
  onOpenForm(id: string): void;
}) {
  const sheetId = e.data.sheet.id;
  const orgId = e.data.sheet.orgId;
  const perms = { canEdit: e.canEdit, isAdmin: e.isAdmin };
  const sheetHead = (
    <div className="border-soft flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b py-2 last:border-b-0">
      <span className="text-muted-foreground text-label-12 w-full font-medium sm:w-24">Sheet</span>
      <span className="text-ink text-label-14">{e.data.sheet.name}</span>
    </div>
  );

  // ── create mode ("+ Add")
  if (create?.kind === 'automation') {
    const start = create.action
      ? (ctx: Ctx): AutomationDraft => ({
          ...emptyDraft(ctx),
          actions: [defaultAction(create.action!, ctx)],
        })
      : undefined;
    return (
      <AutomationEditor
        org={e.org}
        orgId={orgId}
        timeZone={e.viewer.timeZone}
        userId={e.viewer.userId}
        perms={perms}
        editId={null}
        sheetId={sheetId}
        recipe={null}
        head={sheetHead}
        sheetData={e.data}
        startWith={start}
        onSaved={onSaved}
        onDone={onDone}
      />
    );
  }
  const kind = create?.kind ?? edit?.editor;
  if (!kind) return null;

  if (edit && elsewhere(edit, sheetId)) return <OtherSheet org={e.org} edit={edit} step={step} />;

  switch (kind) {
    case 'automation': {
      const a = e.world.automations.find((x) => x.id === edit!.id);
      if (!e.canEdit) {
        const ctx = flowCtx(e.world, sheetId, e.viewer);
        return (
          <div className="flex flex-col gap-4">
            <ReadOnlyNote text={viewerText(false)} />
            {step ? <StepSummary step={step} /> : null}
            {a && ctx ? <p className="text-copy-14 m-0">{describeAutomation(a, ctx)}</p> : null}
            <div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/${e.org}/automations?tab=runs&sheet=${sheetId}`}>Run log</Link>
              </Button>
            </div>
          </div>
        );
      }
      return (
        <AutomationEditor
          org={e.org}
          orgId={orgId}
          timeZone={e.viewer.timeZone}
          userId={e.viewer.userId}
          perms={perms}
          editId={edit!.id}
          sheetId={sheetId}
          recipe={null}
          head={sheetHead}
          sheetData={e.data}
          onSaved={onSaved}
          onDone={onDone}
        />
      );
    }
    case 'form':
      return (
        <FormStep
          e={e}
          id={edit!.id}
          step={step}
          onDone={onDone}
          onSaved={onSaved}
          onOpenForm={onOpenForm}
        />
      );
    case 'approval': {
      const sheet = e.world.sheets.find((s) => s.id === sheetId);
      return (
        <div className="flex flex-col gap-4">
          {!e.isAdmin ? <ReadOnlyNote text={viewerText(e.canEdit)} /> : null}
          <WorkflowEditor
            org={e.org}
            sheetId={sheetId}
            initial={sheet?.workflows ?? e.data.sheet.workflows ?? []}
            fields={e.data.fields.map((f) => ({
              key: f.key,
              name: f.hidden ? 'Restricted field' : f.name,
              type: f.type,
              options: Array.isArray((f.config as { options?: unknown } | null)?.options)
                ? (f.config as { options: { id: string; label: string; done?: boolean }[] }).options
                : [],
              restricted: !!f.restrictedTo,
            }))}
            people={e.data.people.map((p) => ({ id: p.id, name: p.name }))}
            jobRoles={e.data.jobRoles.map((r) => ({ id: r.id, name: r.name }))}
            teams={e.data.teams.map((t) => ({ id: t.id, name: t.name }))}
            canEdit={e.isAdmin && !e.archived}
          />
        </div>
      );
    }
    case 'field':
    case 'lifecycle': {
      const field = e.data.fields.find((f) => f.id === edit!.id);
      if (!field) return <p className="text-copy-14 m-0 p-5">This field no longer exists.</p>;
      return (
        <FieldSettingsBody
          key={field.id}
          field={field}
          ctx={e.ctx}
          env={e.env}
          canEdit={e.canEdit && (!field.locked || e.isAdmin)}
          isAdmin={e.isAdmin}
          actions={e.actions}
          onClose={() => {
            onSaved();
            onDone();
          }}
        />
      );
    }
    case 'sheet': {
      const d = e.detail;
      if (!d) return null;
      if (!e.canEdit)
        return (
          <div className="flex flex-col gap-4">
            <ReadOnlyNote text={viewerText(false)} />
            <dl className="text-label-13 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
              <dt className="text-muted-foreground">Name</dt>
              <dd className="m-0">{d.name}</dd>
              <dt className="text-muted-foreground">Items are called</dt>
              <dd className="m-0">{d.itemLabel}</dd>
              <dt className="text-muted-foreground">ID prefix</dt>
              <dd className="m-0 font-mono">{d.idPrefix}</dd>
            </dl>
          </div>
        );
      return (
        <div className="flex flex-col gap-4">
          <SheetSettingsForm
            org={e.org}
            folders={e.world.folders
              .filter((f) => !f.domain)
              .map((f) => ({ id: f.id, name: f.name }))}
            sheet={d}
          />
          <Link
            href={`/${e.org}/s/${sheetId}/settings`}
            className="text-label-13 text-info w-fit underline-offset-2 hover:underline"
          >
            All sheet settings
          </Link>
        </div>
      );
    }
    case 'new_item': {
      const forms = e.views.tabs.forms.flatMap((f) =>
        f.saved?.config.form
          ? [{ id: f.saved.id, name: f.saved.name, form: f.saved.config.form }]
          : [],
      );
      const setting = e.data.sheet.newItemForm;
      const plan = newItemPlan(e.data.fields, chosenIntake(setting, forms), e.viewer.now);
      return (
        <div className="flex flex-col gap-4">
          <section aria-labelledby="new-item-asks" className="flex flex-col gap-2">
            <h3 id="new-item-asks" className="text-heading-14 m-0">
              What + New asks now
            </h3>
            <p className="text-copy-13 text-muted-foreground m-0">
              {plan.form
                ? `The form “${plan.form.name}”${plan.steps.length > 1 ? `, in ${plan.steps.length} steps` : ''}.`
                : 'The standard dialog: the name, required fields and fields marked Ask when adding; the rest under More fields.'}
            </p>
            <ol className="text-copy-13 m-0 flex list-decimal flex-col gap-0.5 pl-5">
              <li>{plan.nameLabel}</li>
              {planQuestions(plan)
                .filter((q) => !plan.more.includes(q))
                .map((q) => (
                  <li key={q.field.id}>
                    {q.label}
                    {q.required ? <span className="text-muted-foreground"> · Required</span> : null}
                  </li>
                ))}
            </ol>
          </section>
          <section aria-labelledby="new-item-form" className="flex flex-col gap-2">
            <h3 id="new-item-form" className="text-heading-14 m-0">
              New item form
            </h3>
            <NewItemFormSetting
              org={e.org}
              sheetId={sheetId}
              setting={setting === false || typeof setting === 'string' ? setting : null}
              forms={newItemFormChoices(forms, e.data.fields, e.viewer.now)}
              canChange={e.isAdmin && !e.archived}
            />
          </section>
        </div>
      );
    }
    default:
      return null;
  }
}

function FormStep({
  e,
  id,
  step,
  onDone,
  onSaved,
  onOpenForm,
}: {
  e: EditorEnv;
  id: string;
  step: FlowStep | null;
  onDone(): void;
  onSaved(): void;
  onOpenForm(id: string): void;
}) {
  const sheetId = e.data.sheet.id;
  const links = useFormLinks(sheetId);
  const setLink = useSetFormLink(sheetId);
  const view = e.views.tabs.forms.find((f) => f.id === id)?.saved ?? null;
  if (!view) return <p className="text-copy-14 m-0">This form no longer exists.</p>;
  if (!e.isAdmin)
    return (
      <div className="flex flex-col gap-4">
        <ReadOnlyNote text={viewerText(e.canEdit)} />
        {step ? <StepSummary step={step} /> : null}
        {e.canEdit ? (
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenForm(view.id)}>
              Open the form
            </Button>
          </div>
        ) : null}
      </div>
    );
  return (
    <FormBuilder
      key={view.id}
      org={e.org}
      data={e.data}
      ctx={e.ctx}
      view={view}
      link={links.data?.get(view.id) ?? null}
      onLink={(l) => setLink(view.id, l)}
      onSaved={(v) => {
        e.views.upsert(v);
        onSaved();
      }}
      onBack={onDone}
    />
  );
}
