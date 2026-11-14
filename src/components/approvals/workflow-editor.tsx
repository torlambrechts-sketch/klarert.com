'use client';

import { useId, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { saveApprovalWorkflowsAction } from '@/app/[org]/approval-actions';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { inputClass } from '@/components/fields/shared';
import {
  approverFields,
  requirableFields,
  slaWords,
  statusFields,
  stepFields,
  workflowIdFor,
  workflowProblems,
  type ApprovalStep,
  type ApprovalWorkflow,
  type ApproverRule,
} from '@/engine/approvals';
import type { Field } from '@/engine/types';
import { cn } from '@/lib/utils';

// Sheet settings › Approval workflows (docs/05 §4): the sheet's approval workflows as data. Owners and admins add
// ordered steps (who approves, any one or all, a time limit, what a rejection does), the fields to fill before
// submitting, the step field that shows where an item is, the status it sets and the lock on approval.

export interface EditorField {
  key: string;
  name: string;
  type: string;
  options?: { id: string; label: string; done?: boolean }[];
  restricted?: boolean;
}

interface Named {
  id: string;
  name: string;
}

const KIND_LABEL: Record<ApproverRule['kind'], string> = {
  field: 'The people in a field',
  people: 'Named people',
  jobRole: 'Everyone with a job role',
  team: 'Anyone in a team',
};

const asField = (f: EditorField): Field =>
  ({
    id: f.key,
    sheetId: '',
    key: f.key,
    name: f.name,
    type: f.type,
    position: '',
    required: false,
    locked: false,
    config: { options: f.options ?? [] },
    validation: {},
    rules: [],
    restrictedTo: f.restricted ? { userIds: [], roles: [] } : null,
  }) as Field;

function newStep(n: number, fields: Field[], taken: string[]): ApprovalStep {
  const people = approverFields(fields)[0];
  let id = `step-${n}`;
  for (let i = n + 1; taken.includes(id); i += 1) id = `step-${i}`;
  return {
    id,
    name: n === 1 ? 'Review' : n === 2 ? 'Approval' : `Step ${n}`,
    approvers: people ? { kind: 'field', fieldKey: people.key } : { kind: 'people', userIds: [] },
    mode: 'any',
    sla: { amount: 2, unit: 'days' },
    onReject: { to: 'draft' },
    optionId: null,
  };
}

function blank(fields: Field[]): ApprovalWorkflow {
  return {
    id: '',
    name: '',
    enabled: true,
    steps: [newStep(1, fields, [])],
    requiredFields: [],
    allowSelfApproval: false,
    lockOnApproval: true,
    stepField: stepFields(fields)[0] ? { fieldKey: stepFields(fields)[0]!.key } : null,
    statusField: null,
  };
}

function approverWords(
  rule: ApproverRule,
  fields: Field[],
  people: Named[],
  roles: Named[],
  teams: Named[],
) {
  switch (rule.kind) {
    case 'field':
      return `the people in ${fields.find((f) => f.key === rule.fieldKey)?.name ?? rule.fieldKey}`;
    case 'people': {
      const names = rule.userIds.map(
        (id) => people.find((p) => p.id === id)?.name ?? 'a former member',
      );
      return names.length ? names.join(', ') : 'nobody yet';
    }
    case 'jobRole':
      return `${roles.find((r) => r.id === rule.roleId)?.name ?? rule.roleName} (job role)`;
    case 'team':
      return `${teams.find((t) => t.id === rule.teamId)?.name ?? rule.teamName} (team)`;
  }
}

function rejectWords(step: ApprovalStep, steps: ApprovalStep[]) {
  const r = step.onReject;
  if (r.to === 'draft') return 'a rejection sends it back to draft';
  if (r.to === 'close') return 'a rejection closes it as rejected';
  const i = steps.findIndex((s) => s.id === r.stepId);
  return `a rejection sends it back to step ${i + 1}`;
}

export function WorkflowEditor({
  org,
  sheetId,
  initial,
  fields: rawFields,
  people,
  jobRoles,
  teams,
  canEdit,
}: {
  org: string;
  sheetId: string;
  initial: ApprovalWorkflow[];
  fields: EditorField[];
  people: Named[];
  jobRoles: Named[];
  teams: Named[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const ids = useId();
  const fields = useMemo(() => rawFields.map(asField), [rawFields]);
  const [list, setList] = useState<ApprovalWorkflow[]>(initial);
  const [draft, setDraft] = useState<{ index: number | null; w: ApprovalWorkflow } | null>(null);
  const [pending, start] = useTransition();

  function save(next: ApprovalWorkflow[], done?: () => void) {
    start(async () => {
      const r = await saveApprovalWorkflowsAction({ org, sheetId, workflows: next });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      setList(r.data.workflows);
      toast('Approval workflows saved.');
      done?.();
      router.refresh();
    });
  }

  const w = draft?.w;
  const set = (patch: Partial<ApprovalWorkflow>) =>
    setDraft((d) => (d ? { ...d, w: { ...d.w, ...patch } } : d));
  const setStep = (i: number, patch: Partial<ApprovalStep>) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            w: { ...d.w, steps: d.w.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) },
          }
        : d,
    );
  const moveStep = (i: number, by: -1 | 1) =>
    setDraft((d) => {
      if (!d) return d;
      const steps = [...d.w.steps];
      const [s] = steps.splice(i, 1);
      steps.splice(i + by, 0, s!);
      // a rejection may only go back: one that would now go forward goes to this step instead
      const fixed = steps.map((x, k) =>
        x.onReject.to === 'step' &&
        steps.findIndex((y) => y.id === (x.onReject as { stepId: string }).stepId) > k
          ? { ...x, onReject: { to: 'step' as const, stepId: x.id } }
          : x,
      );
      return { ...d, w: { ...d.w, steps: fixed } };
    });

  const others = list.filter((_, i) => i !== draft?.index);
  const problems = w
    ? w.name.trim()
      ? workflowProblems({ ...w, id: w.id || 'new' }, fields, others)
      : ['Name the workflow.']
    : [];
  // the step field's options are added when it saves
  const shown = problems.filter(
    (p) => !p.includes('no longer has every option the workflow shows'),
  );
  const statusField = w?.statusField
    ? fields.find((f) => f.key === w.statusField!.fieldKey)
    : undefined;
  const statusOptions =
    (statusField?.config as { options?: { id: string; label: string }[] })?.options ?? [];

  function commit() {
    if (!draft || !w) return;
    if (shown.length) return toast.error(shown[0]!);
    const name = w.name.trim();
    const id =
      w.id ||
      workflowIdFor(
        name,
        others.map((x) => x.id),
      );
    const next = { ...w, id, name };
    save(
      draft.index === null ? [...list, next] : list.map((x, i) => (i === draft.index ? next : x)),
      () => setDraft(null),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {list.length === 0 ? (
        <p className="text-copy-13 text-muted-foreground m-0">
          No approval workflow yet. Add one to send items through review and approval steps, with
          every decision in the activity log.
        </p>
      ) : (
        <ul
          className="divide-line m-0 flex list-none flex-col divide-y p-0"
          aria-label="Approval workflows"
        >
          {list.map((x, i) => (
            <li
              key={x.id}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-label-14 font-semibold">{x.name}</span>
                <ol className="text-copy-13 m-0 flex list-none flex-col gap-0.5 p-0">
                  {x.steps.map((s, k) => (
                    <li key={s.id}>
                      <span className="text-label-12-mono text-muted-foreground mr-1.5">
                        {k + 1}
                      </span>
                      <span className="font-medium">{s.name}</span>:{' '}
                      {approverWords(s.approvers, fields, people, jobRoles, teams)},{' '}
                      {s.mode === 'all' ? 'all must approve' : 'any one approves'},{' '}
                      {slaWords(s.sla).toLowerCase()}; {rejectWords(s, x.steps)}
                    </li>
                  ))}
                </ol>
                <span className="text-label-12 text-muted-foreground">
                  {[
                    x.lockOnApproval ? 'Locks the item when approved' : null,
                    x.allowSelfApproval
                      ? 'The submitter may approve'
                      : 'The submitter cannot approve',
                    x.requiredFields.length
                      ? `Needs ${x.requiredFields.map((k) => fields.find((f) => f.key === k)?.name ?? k).join(', ')}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <label className="text-label-13 flex items-center gap-1.5">
                  <Switch
                    checked={x.enabled}
                    disabled={!canEdit || pending}
                    aria-label={`${x.name} on`}
                    onCheckedChange={(on) =>
                      save(list.map((y, j) => (j === i ? { ...y, enabled: on } : y)))
                    }
                  />
                  {x.enabled ? 'On' : 'Off'}
                </label>
                {canEdit ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Edit ${x.name}`}
                      onClick={() => setDraft({ index: i, w: structuredClone(x) })}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      aria-label={`Delete ${x.name}`}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete ${x.name}? Items waiting for it keep their approval to the end.`,
                          )
                        )
                          save(list.filter((_, j) => j !== i));
                      }}
                    >
                      Delete
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canEdit && !draft ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => setDraft({ index: null, w: blank(fields) })}
        >
          <Plus aria-hidden /> New approval workflow
        </Button>
      ) : null}
      {!canEdit ? (
        <p className="text-muted-foreground text-copy-13 m-0">
          Only owners and admins can change approval workflows.
        </p>
      ) : null}

      {draft && w ? (
        <form
          aria-label={draft.index === null ? 'New approval workflow' : `Edit ${w.name}`}
          className="border-line flex flex-col gap-4 rounded-lg border p-3 sm:p-4"
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-label-13 font-semibold">Name</span>
            <input
              className={inputClass}
              value={w.name}
              maxLength={80}
              required
              placeholder="Document approval"
              onChange={(e) => set({ name: e.target.value })}
            />
          </label>

          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="text-label-13 mb-1 p-0 font-semibold">Steps, in order</legend>
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {w.steps.map((s, i) => (
                <li
                  key={s.id}
                  aria-label={`Step ${i + 1}`}
                  className="border-line bg-subtle flex flex-col gap-2 rounded-md border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-label-13 font-semibold">Step {i + 1}</span>
                    <span className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Move step ${i + 1} up`}
                        disabled={i === 0}
                        onClick={() => moveStep(i, -1)}
                      >
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Move step ${i + 1} down`}
                        disabled={i === w.steps.length - 1}
                        onClick={() => moveStep(i, 1)}
                      >
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Remove step ${i + 1}`}
                        disabled={w.steps.length === 1}
                        onClick={() =>
                          set({
                            steps: w.steps
                              .filter((_, j) => j !== i)
                              .map((x) =>
                                x.onReject.to === 'step' && x.onReject.stepId === s.id
                                  ? { ...x, onReject: { to: 'draft' as const } }
                                  : x,
                              ),
                          })
                        }
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-label-13">Step name</span>
                      <input
                        className={inputClass}
                        value={s.name}
                        maxLength={80}
                        required
                        onChange={(e) => setStep(i, { name: e.target.value })}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-label-13">Who approves</span>
                      <select
                        className={inputClass}
                        value={s.approvers.kind}
                        onChange={(e) => {
                          const kind = e.target.value as ApproverRule['kind'];
                          const f = approverFields(fields)[0];
                          const rule: ApproverRule =
                            kind === 'field'
                              ? { kind, fieldKey: f?.key ?? '' }
                              : kind === 'people'
                                ? { kind, userIds: [] }
                                : kind === 'jobRole'
                                  ? {
                                      kind,
                                      roleId: jobRoles[0]?.id ?? null,
                                      roleName: jobRoles[0]?.name ?? '',
                                    }
                                  : {
                                      kind,
                                      teamId: teams[0]?.id ?? null,
                                      teamName: teams[0]?.name ?? '',
                                    };
                          setStep(i, { approvers: rule });
                        }}
                      >
                        {(Object.keys(KIND_LABEL) as ApproverRule['kind'][]).map((k) => (
                          <option key={k} value={k}>
                            {KIND_LABEL[k]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <ApproverPicker
                      rule={s.approvers}
                      label={`Step ${i + 1} approvers`}
                      fields={approverFields(fields)}
                      people={people}
                      jobRoles={jobRoles}
                      teams={teams}
                      onChange={(rule) => setStep(i, { approvers: rule })}
                    />
                    <label className="flex flex-col gap-1">
                      <span className="text-label-13">How many must approve</span>
                      <select
                        className={inputClass}
                        value={s.mode}
                        onChange={(e) =>
                          setStep(i, { mode: e.target.value as ApprovalStep['mode'] })
                        }
                      >
                        <option value="any">Any one of them</option>
                        <option value="all">All of them</option>
                      </select>
                    </label>
                    <div className="flex flex-col gap-1">
                      <span className="text-label-13" id={`${ids}-sla-${i}`}>
                        Time limit
                      </span>
                      <div className="flex gap-2" role="group" aria-labelledby={`${ids}-sla-${i}`}>
                        <input
                          type="number"
                          min={1}
                          max={8760}
                          aria-label={`Step ${i + 1} time limit`}
                          className={cn(inputClass, 'w-24')}
                          value={s.sla?.amount ?? ''}
                          placeholder="None"
                          onChange={(e) => {
                            const n = Math.trunc(Number(e.target.value));
                            setStep(i, {
                              sla:
                                e.target.value === '' || !n
                                  ? null
                                  : {
                                      amount: Math.min(8760, Math.max(1, n)),
                                      unit: s.sla?.unit ?? 'days',
                                    },
                            });
                          }}
                        />
                        <select
                          aria-label={`Step ${i + 1} time limit unit`}
                          className={inputClass}
                          value={s.sla?.unit ?? 'days'}
                          disabled={!s.sla}
                          onChange={(e) =>
                            s.sla &&
                            setStep(i, {
                              sla: { ...s.sla, unit: e.target.value as 'hours' | 'days' },
                            })
                          }
                        >
                          <option value="hours">Hours</option>
                          <option value="days">Days</option>
                        </select>
                      </div>
                    </div>
                    <label className="flex flex-col gap-1">
                      <span className="text-label-13">If rejected</span>
                      <select
                        className={inputClass}
                        value={
                          s.onReject.to === 'step' ? `step:${s.onReject.stepId}` : s.onReject.to
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          setStep(i, {
                            onReject: v.startsWith('step:')
                              ? { to: 'step', stepId: v.slice(5) }
                              : { to: v as 'draft' | 'close' },
                          });
                        }}
                      >
                        {w.steps.slice(0, i + 1).map((x, k) => (
                          <option key={x.id} value={`step:${x.id}`}>
                            Back to step {k + 1}, {x.name || 'unnamed'}
                          </option>
                        ))}
                        <option value="draft">Back to draft</option>
                        <option value="close">Close as rejected</option>
                      </select>
                    </label>
                  </div>
                </li>
              ))}
            </ol>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={w.steps.length >= 10}
              onClick={() =>
                set({
                  steps: [
                    ...w.steps,
                    newStep(
                      w.steps.length + 1,
                      fields,
                      w.steps.map((x) => x.id),
                    ),
                  ],
                })
              }
            >
              <Plus aria-hidden /> Add a step
            </Button>
          </fieldset>

          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="text-label-13 mb-1 p-0 font-semibold">
              Fill in before submitting
            </legend>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {requirableFields(fields).map((f) => (
                <label key={f.key} className="text-label-13 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={w.requiredFields.includes(f.key)}
                    onChange={(e) =>
                      set({
                        requiredFields: e.target.checked
                          ? [...w.requiredFields, f.key]
                          : w.requiredFields.filter((k) => k !== f.key),
                      })
                    }
                  />
                  {f.name}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-label-13 font-semibold">Show the step in</span>
              <select
                className={inputClass}
                value={w.stepField?.fieldKey ?? ''}
                onChange={(e) =>
                  set({ stepField: e.target.value ? { fieldKey: e.target.value } : null })
                }
              >
                <option value="">Do not show it in a field</option>
                {stepFields(fields).map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name}
                  </option>
                ))}
              </select>
              <span className="text-label-12 text-muted-foreground">
                {stepFields(fields).length
                  ? 'A workflow step field, read-only to people. Its options follow the step names.'
                  : 'Add a Workflow step field to the sheet to show the step in a column.'}
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-label-13 font-semibold">Set a status as it moves</span>
              <select
                className={inputClass}
                value={w.statusField?.fieldKey ?? ''}
                onChange={(e) =>
                  set({ statusField: e.target.value ? { fieldKey: e.target.value } : null })
                }
              >
                <option value="">Leave the fields as they are</option>
                {statusFields(fields).map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {w.statusField ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(
                [
                  ['onSubmit', 'When submitted'],
                  ['onApproved', 'When approved'],
                  ['onRejected', 'When rejected'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex flex-col gap-1">
                  <span className="text-label-13">{label}</span>
                  <select
                    className={inputClass}
                    value={w.statusField?.[k] ?? ''}
                    onChange={(e) =>
                      set({ statusField: { ...w.statusField!, [k]: e.target.value || null } })
                    }
                  >
                    <option value="">Leave as it is</option>
                    {statusOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          ) : null}

          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="text-label-13 mb-1 p-0 font-semibold">Rules</legend>
            <label className="text-label-13 flex items-center gap-2">
              <input
                type="checkbox"
                checked={w.lockOnApproval}
                onChange={(e) => set({ lockOnApproval: e.target.checked })}
              />
              Lock the item when it is approved (only owners and admins can change it afterwards)
            </label>
            <label className="text-label-13 flex items-center gap-2">
              <input
                type="checkbox"
                checked={w.allowSelfApproval}
                onChange={(e) => set({ allowSelfApproval: e.target.checked })}
              />
              Let the person who submits an item approve it
            </label>
            {w.allowSelfApproval ? (
              <p className="text-label-12 text-warn m-0">
                ⚠ Approvals are usually made by someone other than the person who submits. Leave
                this off unless one person may approve their own work.
              </p>
            ) : null}
          </fieldset>

          {shown.length ? (
            <ul role="alert" className="text-crit text-copy-13 m-0 flex flex-col gap-0.5 pl-4">
              {shown.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Saving…' : 'Save workflow'}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function ApproverPicker({
  rule,
  label,
  fields,
  people,
  jobRoles,
  teams,
  onChange,
}: {
  rule: ApproverRule;
  label: string;
  fields: Field[];
  people: Named[];
  jobRoles: Named[];
  teams: Named[];
  onChange(rule: ApproverRule): void;
}) {
  switch (rule.kind) {
    case 'field':
      return (
        <label className="flex flex-col gap-1">
          <span className="text-label-13">People field</span>
          <select
            aria-label={label}
            className={inputClass}
            value={rule.fieldKey}
            onChange={(e) => onChange({ kind: 'field', fieldKey: e.target.value })}
          >
            {!fields.some((f) => f.key === rule.fieldKey) ? (
              <option value={rule.fieldKey}>Choose a field</option>
            ) : null}
            {fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      );
    case 'jobRole':
      return (
        <label className="flex flex-col gap-1">
          <span className="text-label-13">Job role</span>
          <select
            aria-label={label}
            className={inputClass}
            value={rule.roleId ?? ''}
            onChange={(e) => {
              const r = jobRoles.find((x) => x.id === e.target.value);
              if (r) onChange({ kind: 'jobRole', roleId: r.id, roleName: r.name });
            }}
          >
            {!rule.roleId || !jobRoles.some((r) => r.id === rule.roleId) ? (
              <option value="">
                {rule.roleName ? `${rule.roleName} (not in this workspace)` : 'Choose a job role'}
              </option>
            ) : null}
            {jobRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      );
    case 'team':
      return (
        <label className="flex flex-col gap-1">
          <span className="text-label-13">Team</span>
          <select
            aria-label={label}
            className={inputClass}
            value={rule.teamId ?? ''}
            onChange={(e) => {
              const t = teams.find((x) => x.id === e.target.value);
              if (t) onChange({ kind: 'team', teamId: t.id, teamName: t.name });
            }}
          >
            {!rule.teamId || !teams.some((t) => t.id === rule.teamId) ? (
              <option value="">
                {rule.teamName ? `${rule.teamName} (not in this workspace)` : 'Choose a team'}
              </option>
            ) : null}
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      );
    case 'people':
      return (
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0 sm:col-span-2">
          <legend className="text-label-13 mb-1 p-0">{label}</legend>
          <div className="border-line bg-background-100 grid max-h-40 grid-cols-1 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
            {people.map((p) => (
              <label key={p.id} className="text-label-13 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={rule.userIds.includes(p.id)}
                  onChange={(e) =>
                    onChange({
                      kind: 'people',
                      userIds: e.target.checked
                        ? [...rule.userIds, p.id]
                        : rule.userIds.filter((x) => x !== p.id),
                    })
                  }
                />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>
      );
  }
}
