'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  ACTION_CATALOGUE,
  actionFields,
  autoName,
  availableActions,
  availableTriggers,
  defaultAction,
  defaultTrigger,
  describeAutomation,
  describeRecipients,
  draftProblems,
  incomingLinkFields,
  isActionId,
  linkTargetSheet,
  peopleFields,
  SELF_TRIGGER,
  selfTriggering,
  storedFields,
  testOnItem,
  TRIGGER_CATALOGUE,
  triggerFieldOf,
  triggerFields,
  type ActionId,
  type ActionJson,
  type AutomationDraft,
  type TestResult,
} from '@/engine/automations';
import type { Ctx, Item, Json, TriggerId } from '@/engine/types';
import { inputClass } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { ConditionRow, filterable, newCondition } from '@/components/views/filter-bar';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { isItemFilesSource } from '@/engine/automations/schedule';
import {
  createAutomationAction,
  revealSigningKeyAction,
  updateAutomationAction,
} from '@/app/[org]/automations/actions';
import { OutcomeChip } from './outcome';
import type { SheetRef } from './queries';
import { TemplateInput } from './template-input';
import { ValuePicker } from './value-picker';

// The automation builder (docs/04 §10): "When [trigger] [field] [value] · if [conditions] · then [actions]". Every
// picker offers only what fits (the engine's compatibility rules), values use the field's own editor, messages offer
// `{` template keys, the name is generated until someone types one, and "Test on an item" plans the steps without
// writing. The command validates the same draft with the same engine before saving.

const selectClass = cn(
  inputClass,
  'select-chevron h-8 w-auto max-w-[280px] text-label-14 shadow-none',
);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** The trigger field choice that means the item's Files tab (evidence_expiring source 'item_files'). */
const ITEM_FILES = '__files';

export interface BuilderProps {
  org: string;
  /** The sheet's Ctx with the fields of every sheet of the workspace (withWorkspaceFields). */
  ctx: Ctx;
  items: Item[];
  sheets: SheetRef[];
  roleHolders(roleId: string): string[];
  initial: AutomationDraft;
  /** The automation being edited, or null for a new one. */
  automationId: string | null;
  source: string;
  /** Version of the automation being edited: saving creates the next one. */
  version?: number;
  /** The first row of the builder (the sheet it runs on). */
  head?: React.ReactNode;
  onSaved(id: string): void | Promise<void>;
  onCancel(): void;
}

function Problem({ id, text }: { id: string; text?: string }) {
  return text ? (
    <p id={id} className="text-crit text-label-12 m-0" role="alert">
      {text}
    </p>
  ) : null;
}

/** One row of the builder: a 96 px keyword column, then its controls (docs/04 §10, the board design's builder). */
function Row({
  label,
  labelId,
  children,
  top,
}: {
  label: React.ReactNode;
  labelId?: string;
  children: React.ReactNode;
  /** Align the keyword with the first line of a tall row. */
  top?: boolean;
}) {
  return (
    <div className="border-soft flex flex-wrap gap-x-2 gap-y-1.5 border-b py-2 last:border-b-0 sm:flex-nowrap">
      <span
        id={labelId}
        className={cn(
          'text-muted-foreground text-label-12 w-full shrink-0 font-medium sm:w-24',
          top ? 'sm:pt-2' : 'self-center',
        )}
      >
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">{children}</div>
    </div>
  );
}

export function AutomationBuilder(props: BuilderProps) {
  const { ctx, sheets } = props;
  const [draft, setDraft] = useState<AutomationDraft>(props.initial);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testItemId, setTestItemId] = useState(props.items[0]?.id ?? '');
  const [testing, setTesting] = useState(false);
  const ids = useId();

  const sheetIds = useMemo(() => sheets.map((s) => s.id), [sheets]);
  const sheetName = (id: string) => sheets.find((s) => s.id === id)?.name;
  const problems = draftProblems(draft, ctx, { sheetIds });
  const loops = new Set(selfTriggering(draft));
  const shown = (key: string) => {
    const p = problems[key];
    if (!p) return undefined;
    if (tried) return p;
    return p.startsWith(SELF_TRIGGER) ? p : undefined;
  };
  const generated = autoName(draft, ctx, sheetName);

  const setTrigger = (t: AutomationDraft['trigger']) => setDraft((d) => ({ ...d, trigger: t }));
  const setAction = (i: number, a: ActionJson) =>
    setDraft((d) => ({ ...d, actions: d.actions.map((x, j) => (j === i ? a : x)) }));

  const testItem = props.items.find((i) => i.id === testItemId);
  const test: TestResult | null =
    testing && testItem
      ? testOnItem(draft, testItem, ctx, {
          appUrl: typeof window === 'undefined' ? '' : window.location.origin,
          workspace: props.org,
          automation: {
            id: props.automationId ?? 'draft',
            name: draft.name || generated,
            trigger: draft.trigger,
          },
          roleHolders: props.roleHolders,
        })
      : null;

  const save = async () => {
    setTried(true);
    const first = Object.keys(problems)[0];
    if (first) {
      toast.error('Fix the highlighted parts first.');
      document.getElementById(`${ids}-${first}`)?.scrollIntoView({ block: 'center' });
      return;
    }
    setSaving(true);
    const input = { org: props.org, draft };
    const r = props.automationId
      ? await updateAutomationAction({ ...input, automationId: props.automationId })
      : await createAutomationAction({ ...input, sheetId: ctx.sheet.id, source: props.source });
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    toast.success(props.automationId ? 'Changes saved.' : 'Automation saved and turned on.');
    await props.onSaved(r.data.id);
  };

  const triggers = availableTriggers(ctx);
  const spec = TRIGGER_CATALOGUE[draft.trigger.type];
  const tFields = triggerFields(draft.trigger.type, ctx);
  const tField = triggerFieldOf(draft.trigger, ctx);
  const conditionFields = filterable(ctx.fieldsOf(ctx.sheet.id), ctx);

  const sentence = describeAutomation(draft, ctx, sheetName);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="border-line bg-background-100 flex flex-col rounded-lg border px-3.5 py-1.5">
        {props.head}
        <Row label="When" labelId={`${ids}-when`}>
          <div role="group" aria-labelledby={`${ids}-when`} className="flex flex-col gap-1.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              <select
                aria-label="Trigger"
                className={selectClass}
                value={draft.trigger.type}
                onChange={(e) => setTrigger(defaultTrigger(e.target.value as TriggerId, ctx))}
              >
                {!triggers.includes(draft.trigger.type) ? (
                  <option value={draft.trigger.type}>{spec?.label ?? draft.trigger.type}</option>
                ) : null}
                {triggers.map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_CATALOGUE[t].label}
                  </option>
                ))}
              </select>
              {spec?.field ? (
                <select
                  aria-label="Trigger field"
                  className={selectClass}
                  value={
                    isItemFilesSource(draft.trigger) ? ITEM_FILES : str(draft.trigger.fieldKey)
                  }
                  onChange={(e) => {
                    // evidence_expiring may watch the item's Files tab instead of a field (docs/04 §8)
                    const itemFiles = e.target.value === ITEM_FILES;
                    const next: AutomationDraft['trigger'] = {
                      ...draft.trigger,
                      fieldKey: itemFiles ? null : e.target.value,
                      ...(spec.itemFiles ? { source: itemFiles ? 'item_files' : 'field' } : {}),
                    };
                    if (spec.param === 'value') next.value = null;
                    setTrigger(next);
                  }}
                >
                  {!tField && !isItemFilesSource(draft.trigger) ? (
                    <option value={str(draft.trigger.fieldKey)}>Choose a field</option>
                  ) : null}
                  {spec.itemFiles ? (
                    <option value={ITEM_FILES}>Item files (Files tab)</option>
                  ) : null}
                  {tFields.map((f) => (
                    <option key={f.id} value={f.key}>
                      {f.name}
                    </option>
                  ))}
                </select>
              ) : null}
              {spec?.param === 'value' && tField ? (
                <>
                  <span className="text-label-13">becomes</span>
                  <ValuePicker
                    field={tField}
                    ctx={ctx}
                    value={draft.trigger.value}
                    mode="key"
                    label="Trigger value"
                    invalid={!!shown('trigger')}
                    onChange={(v) => setTrigger({ ...draft.trigger, value: v })}
                  />
                </>
              ) : null}
              {draft.trigger.type === 'form_submitted' ? (
                <FormPicker
                  sheetId={ctx.sheet.id}
                  value={str(draft.trigger.formId)}
                  onChange={(id) => setTrigger({ ...draft.trigger, formId: id || null })}
                />
              ) : null}
              {spec?.workflow ? (
                <>
                  <select
                    aria-label="Approval workflow"
                    className={selectClass}
                    value={str(draft.trigger.workflowId)}
                    onChange={(e) =>
                      setTrigger({ ...draft.trigger, workflowId: e.target.value || null })
                    }
                  >
                    <option value="">Any approval workflow</option>
                    {(ctx.sheet.workflows ?? []).map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                  {draft.trigger.type === 'workflow_step_decided' ? (
                    <select
                      aria-label="Decision"
                      className={selectClass}
                      value={str(draft.trigger.decision)}
                      onChange={(e) =>
                        setTrigger({ ...draft.trigger, decision: e.target.value || null })
                      }
                    >
                      <option value="">approved or rejected</option>
                      <option value="approved">approved</option>
                      <option value="rejected">rejected</option>
                    </select>
                  ) : null}
                </>
              ) : null}
              {spec?.param === 'threshold' ? (
                <input
                  type="number"
                  aria-label="Threshold"
                  className={cn(inputClass, 'w-24')}
                  value={num(draft.trigger.threshold)}
                  onChange={(e) =>
                    setTrigger({
                      ...draft.trigger,
                      threshold: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
              ) : null}
              {spec?.param === 'offsetDays' ? (
                <OffsetInput
                  value={num(draft.trigger.offsetDays)}
                  onChange={(n) => setTrigger({ ...draft.trigger, offsetDays: n })}
                />
              ) : null}
              {spec?.param === 'hoursLeft' ? (
                <>
                  <span className="text-label-13">with less than</span>
                  <input
                    type="number"
                    min={1}
                    aria-label="Hours left"
                    className={cn(inputClass, 'w-20')}
                    value={num(draft.trigger.hoursLeft, 24)}
                    onChange={(e) =>
                      setTrigger({ ...draft.trigger, hoursLeft: Number(e.target.value) })
                    }
                  />
                  <span className="text-label-13">hours left</span>
                </>
              ) : null}
              {spec?.param === 'days' ? (
                <>
                  <span className="text-label-13">within</span>
                  <input
                    type="number"
                    min={1}
                    aria-label="Days before expiry"
                    className={cn(inputClass, 'w-20')}
                    value={num(draft.trigger.days, 30)}
                    onChange={(e) => setTrigger({ ...draft.trigger, days: Number(e.target.value) })}
                  />
                  <span className="text-label-13">days</span>
                </>
              ) : null}
            </div>
          </div>
          {spec?.scheduled ? (
            <p className="text-muted-foreground text-copy-13 m-0">
              {draft.trigger.type === 'approval_overdue'
                ? 'Date checks run on a schedule, once each time an item waits at a step past its time limit.'
                : 'Date checks run on a schedule, once per item for each date.'}
            </p>
          ) : null}
          <div id={`${ids}-trigger`}>
            <Problem id={`${ids}-trigger-problem`} text={shown('trigger')} />
          </div>
        </Row>
        <Row label="and only if" labelId={`${ids}-if`} top>
          <div role="group" aria-labelledby={`${ids}-if`} className="flex flex-col gap-2">
            {draft.conditions.length === 0 ? (
              <p className="text-muted-foreground text-copy-13 m-0 pt-1.5">
                No conditions: it runs every time the trigger fires.
              </p>
            ) : (
              <>
                <ol className="m-0 flex list-none flex-col gap-2 p-0">
                  {draft.conditions.map((c, i) => (
                    <ConditionRow
                      key={i}
                      index={i}
                      cond={c}
                      ctx={ctx}
                      fields={conditionFields}
                      onChange={(next) =>
                        setDraft((d) => ({
                          ...d,
                          conditions: d.conditions.map((x, j) => (j === i ? next : x)),
                        }))
                      }
                      onRemove={() =>
                        setDraft((d) => ({
                          ...d,
                          conditions: d.conditions.filter((_, j) => j !== i),
                        }))
                      }
                    />
                  ))}
                </ol>
                {draft.conditions.map((_, i) => (
                  <div key={i} id={`${ids}-conditions.${i}`}>
                    <Problem
                      id={`${ids}-c${i}`}
                      text={
                        shown(`conditions.${i}`) &&
                        `Condition ${i + 1}: ${shown(`conditions.${i}`)}`
                      }
                    />
                  </div>
                ))}
              </>
            )}
            <div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={draft.conditions.length >= 20}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    conditions: [...d.conditions, newCondition(conditionFields, ctx)],
                  }))
                }
              >
                <Plus aria-hidden /> Add a condition
              </Button>
            </div>
          </div>
        </Row>
        <Row label="then" labelId={`${ids}-then`} top>
          <div role="group" aria-labelledby={`${ids}-then`}>
            <ol className="m-0 flex min-w-0 flex-1 list-none flex-col gap-2 p-0">
              {draft.actions.map((a, i) => (
                <li
                  key={i}
                  id={`${ids}-actions.${i}`}
                  className={cn(
                    'border-soft flex flex-col gap-1.5 border-t pt-2 first:border-t-0 first:pt-0',
                    loops.has(i) && 'border-crit rounded-md border p-2 first:border-t first:p-2',
                  )}
                >
                  <ActionRow
                    index={i}
                    action={a}
                    ctx={ctx}
                    sheets={sheets}
                    invalid={!!shown(`actions.${i}`)}
                    onChange={(next) => setAction(i, next)}
                    onRemove={
                      draft.actions.length > 1
                        ? () =>
                            setDraft((d) => ({
                              ...d,
                              actions: d.actions.filter((_, j) => j !== i),
                            }))
                        : undefined
                    }
                  />
                  <Problem id={`${ids}-a${i}`} text={shown(`actions.${i}`)} />
                </li>
              ))}
              {draft.actions.length === 0 ? (
                <Problem id={`${ids}-actions`} text={shown('actions')} />
              ) : null}
              <li>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={draft.actions.length >= 10}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      actions: [...d.actions, defaultAction('notify', ctx)],
                    }))
                  }
                >
                  <Plus aria-hidden /> Add an action
                </Button>
              </li>
            </ol>
            {props.automationId && draft.actions.some((a) => a.type === 'webhook') ? (
              <SigningKey org={props.org} automationId={props.automationId} />
            ) : null}
          </div>
        </Row>
        <div className="border-soft border-b py-2 last:border-b-0">
          <p className="bg-soft text-ink text-copy-14 m-0 rounded-md px-3 py-2.5 leading-normal">
            <b className="text-ink font-medium">Reads as:</b> {sentence}
          </p>
        </div>
        <Row label={<label htmlFor={`${ids}-name`}>Name</label>}>
          <input
            id={`${ids}-name`}
            type="text"
            maxLength={200}
            className={cn(inputClass, 'text-label-14 h-8 shadow-none')}
            placeholder={generated}
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
          <p className="text-muted-foreground text-copy-13 m-0">
            Leave it empty to use “{generated}”.
          </p>
        </Row>
        <Row label="Test on" labelId={`${ids}-test`}>
          {props.items.length === 0 ? (
            <p className="text-muted-foreground text-copy-13 m-0">
              This sheet has no items yet. Add one to test the automation on it.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Item to test on"
                className={selectClass}
                value={testItemId}
                onChange={(e) => setTestItemId(e.target.value)}
              >
                {props.items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.displayId} {it.name}
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" onClick={() => setTesting(true)}>
                Test
              </Button>
            </div>
          )}
          {test && testItem ? <TestPanel result={test} item={testItem} /> : null}
        </Row>
        <Row label={<span className="sr-only">Save</span>}>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <Button type="button" onClick={() => void save()} disabled={saving}>
              {saving
                ? 'Saving…'
                : props.automationId
                  ? `Save as v${(props.version ?? 0) + 1}`
                  : 'Turn on automation'}
            </Button>
            <p className="text-muted-foreground text-copy-13 m-0">
              Status rules still apply to its changes, and every run is logged.
            </p>
          </div>
        </Row>
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={props.onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Which form of the sheet the trigger listens to (docs/04 form_submitted.formId); empty = any form. */
function FormPicker({
  sheetId,
  value,
  onChange,
}: {
  sheetId: string;
  value: string;
  onChange(id: string): void;
}) {
  const [forms, setForms] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    let alive = true;
    void createClient()
      .from('views')
      .select('id, name')
      .eq('sheet_id', sheetId)
      .eq('type', 'form')
      .is('owner_id', null)
      .order('position')
      .then(({ data }) => alive && setForms(data ?? []));
    return () => {
      alive = false;
    };
  }, [sheetId]);
  return (
    <select
      aria-label="Form"
      className={selectClass}
      value={value}
      disabled={forms === null}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Any form</option>
      {value && forms && !forms.some((f) => f.id === value) ? (
        <option value={value}>A deleted form</option>
      ) : null}
      {(forms ?? []).map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  );
}

function OffsetInput({ value, onChange }: { value: number; onChange(n: number): void }) {
  const dir = value < 0 ? 'before' : value > 0 ? 'after' : 'on';
  const days = Math.abs(value);
  return (
    <>
      <select
        aria-label="When, relative to the date"
        className={selectClass}
        value={dir}
        onChange={(e) => {
          const d = e.target.value;
          const n = days || 1;
          onChange(d === 'on' ? 0 : d === 'before' ? -n : n);
        }}
      >
        <option value="on">on the day</option>
        <option value="before">days before</option>
        <option value="after">days after</option>
      </select>
      {dir !== 'on' ? (
        <input
          type="number"
          min={1}
          max={3650}
          aria-label="Number of days"
          className={cn(inputClass, 'w-20')}
          value={days}
          onChange={(e) => {
            const n = Math.max(1, Math.min(3650, Number(e.target.value) || 1));
            onChange(dir === 'before' ? -n : n);
          }}
        />
      ) : null}
    </>
  );
}

function FieldSelect({
  label,
  value,
  fields,
  onChange,
}: {
  label: string;
  value: string;
  fields: { key: string; name: string; id: string }[];
  onChange(key: string): void;
}) {
  return (
    <select
      aria-label={label}
      className={selectClass}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {!fields.some((f) => f.key === value) ? <option value={value}>Choose a field</option> : null}
      {fields.map((f) => (
        <option key={f.id} value={f.key}>
          {f.name}
        </option>
      ))}
    </select>
  );
}

function ActionRow({
  index,
  action,
  ctx,
  sheets,
  invalid,
  onChange,
  onRemove,
}: {
  index: number;
  action: ActionJson;
  ctx: Ctx;
  sheets: SheetRef[];
  invalid: boolean;
  onChange(a: ActionJson): void;
  onRemove?: () => void;
}) {
  const n = index + 1;
  const label = (part: string) => `Action ${n} ${part}`;
  const available = availableActions(ctx);
  const type = action.type;
  const set = (patch: Record<string, Json>) => onChange({ ...action, ...patch });
  const fieldKey = str(action.fieldKey);
  const field = ctx.fieldsByKey.get(fieldKey);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          aria-label={label('type')}
          className={selectClass}
          value={type}
          onChange={(e) => onChange(defaultAction(e.target.value as ActionId, ctx))}
        >
          {!isActionId(type) || !available.includes(type) ? (
            <option value={type}>{isActionId(type) ? ACTION_CATALOGUE[type].label : type}</option>
          ) : null}
          {available.map((a) => (
            <option key={a} value={a}>
              {ACTION_CATALOGUE[a].label}
            </option>
          ))}
        </select>
        {type === 'set_field' ? (
          <>
            <FieldSelect
              label={label('field')}
              value={fieldKey}
              fields={actionFields('set_field', ctx)}
              onChange={(k) => set({ fieldKey: k, value: null })}
            />
            {field ? (
              <>
                <span className="text-label-13">to</span>
                <ValuePicker
                  field={field}
                  ctx={ctx}
                  value={action.value}
                  label={label('value')}
                  invalid={invalid}
                  onChange={(v) => set({ value: v })}
                />
              </>
            ) : null}
          </>
        ) : null}
        {type === 'set_parent_field' || type === 'update_subitems'
          ? (() => {
              // a field of the parent (on a sub-item) or of the sub-items (on a parent)
              const list = actionFields(type, ctx);
              const target = list.find((f) => f.key === fieldKey);
              return (
                <>
                  <FieldSelect
                    label={label('field')}
                    value={fieldKey}
                    fields={list}
                    onChange={(k) => set({ fieldKey: k, value: null })}
                  />
                  {target ? (
                    <>
                      <span className="text-label-13">to</span>
                      <ValuePicker
                        field={target}
                        ctx={ctx}
                        value={action.value}
                        label={label('value')}
                        invalid={invalid}
                        onChange={(v) => set({ value: v })}
                      />
                    </>
                  ) : null}
                  {type === 'update_subitems' ? (
                    <label className="text-label-13 flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={action.onlyOpen === true}
                        onChange={(e) => set({ onlyOpen: e.target.checked })}
                      />
                      only open ones
                    </label>
                  ) : null}
                </>
              );
            })()
          : null}
        {type === 'create_subitems' ? (
          <label className="text-label-13 flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={action.fromTemplate === true}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? { type, fromTemplate: true }
                    : { type, items: [{ name: '', values: {} }] },
                )
              }
            />
            from the sheet&apos;s template
          </label>
        ) : null}
        {type === 'request_update' || type === 'raise_version' ? (
          <FieldSelect
            label={label('field')}
            value={fieldKey}
            fields={actionFields(type, ctx)}
            onChange={(k) => set({ fieldKey: k })}
          />
        ) : null}
        {type === 'raise_version' ? (
          <select
            aria-label={label('kind')}
            className={selectClass}
            value={str(action.kind) || 'minor'}
            onChange={(e) => set({ kind: e.target.value })}
          >
            <option value="minor">minor (v1.2 → v1.3)</option>
            <option value="major">major (v1.2 → v2.0)</option>
          </select>
        ) : null}
        {type === 'assign' ? (
          <>
            <select
              aria-label={label('person')}
              className={selectClass}
              value={str(action.who)}
              onChange={(e) => set({ who: e.target.value })}
            >
              <option value="actor">the person who made the change</option>
              {[...ctx.people.values()].map((p) => (
                <option key={p.id} value={`user:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className="text-label-13">to</span>
            <FieldSelect
              label={label('field')}
              value={fieldKey}
              fields={actionFields('assign', ctx)}
              onChange={(k) => set({ fieldKey: k })}
            />
          </>
        ) : null}
        {type === 'move_to_group' ? (
          <select
            aria-label={label('group')}
            className={selectClass}
            value={str(action.groupId)}
            onChange={(e) => set({ groupId: e.target.value })}
          >
            {!ctx.groups.has(str(action.groupId)) ? <option value="">Choose a group</option> : null}
            {[...ctx.groups.values()]
              .sort((a, b) => (a.position < b.position ? -1 : 1))
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
          </select>
        ) : null}
        {type === 'create_item' || type === 'sync_requirement_checks' ? (
          <>
            <span className="text-label-13">on</span>
            <select
              aria-label={label('sheet')}
              className={selectClass}
              value={str(action.sheetId)}
              onChange={(e) =>
                set(
                  type === 'create_item'
                    ? { sheetId: e.target.value, groupId: null, values: {} }
                    : { sheetId: e.target.value },
                )
              }
            >
              {!sheets.some((s) => s.id === action.sheetId) ? (
                <option value="">Choose a sheet</option>
              ) : null}
              {sheets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {type === 'webhook' ? (
          <select
            aria-label={label('format')}
            className={selectClass}
            value={str(action.preset) || 'generic'}
            onChange={(e) => set({ preset: e.target.value })}
          >
            <option value="generic">Generic JSON</option>
            <option value="teams">Microsoft Teams</option>
            <option value="slack">Slack</option>
          </select>
        ) : null}
        {onRemove ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="ml-auto"
            aria-label={`Remove action ${n}`}
            onClick={onRemove}
          >
            <X aria-hidden />
          </Button>
        ) : null}
      </div>
      {type === 'notify' ? (
        <Recipients action={action} ctx={ctx} label={label} onChange={(to) => set({ to })} />
      ) : null}
      {type === 'notify' || type === 'request_update' || type === 'post_update' ? (
        <TemplateInput
          ctx={ctx}
          label={label('message')}
          multiline
          placeholder="Type { to add a value, for example {id} {name}"
          value={str(action.message)}
          onChange={(m) => set({ message: m })}
        />
      ) : null}
      {type === 'create_item' ? (
        <div className="flex flex-col gap-1.5">
          <TemplateInput
            ctx={ctx}
            label={label('new item name')}
            value={str(action.name)}
            onChange={(m) => set({ name: m })}
          />
          <label className="text-label-13 flex items-center gap-2">
            <input
              type="checkbox"
              checked={action.link === true}
              onChange={(e) => set({ link: e.target.checked })}
            />
            Link the new item to this one when a link field connects the two sheets
          </label>
          {action.values &&
          typeof action.values === 'object' &&
          !Array.isArray(action.values) &&
          Object.keys(action.values).length ? (
            <p className="text-muted-foreground text-label-12 m-0">
              Also fills {Object.keys(action.values).join(', ')} on the new item.
            </p>
          ) : null}
        </div>
      ) : null}
      {type === 'create_subitems' && action.fromTemplate !== true ? (
        <textarea
          aria-label={label('sub-items, one per line')}
          className={cn(inputClass, 'min-h-20 py-1.5')}
          placeholder={'One per line, like:\nContainment\nRoot cause'}
          value={(Array.isArray(action.items) ? action.items : [])
            .map((r) => String((r as { name?: unknown })?.name ?? ''))
            .join('\n')}
          onChange={(e) =>
            set({
              items: e.target.value
                .split('\n')
                .slice(0, 50)
                .map((name) => ({ name, values: {} })),
            })
          }
        />
      ) : null}
      {type === 'start_workflow' ? (
        <select
          aria-label={label('workflow')}
          className={selectClass}
          value={str(action.workflowId)}
          onChange={(e) => set({ workflowId: e.target.value || null })}
        >
          {!(ctx.sheet.workflows ?? []).some((w) => w.id === action.workflowId) ? (
            <option value="">Choose an approval workflow</option>
          ) : null}
          {(ctx.sheet.workflows ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
              {w.enabled ? '' : ' (off)'}
            </option>
          ))}
        </select>
      ) : null}
      {type === 'lock_item' ? (
        <input
          type="text"
          aria-label={label('reason')}
          placeholder="Reason, for example Approved"
          className={inputClass}
          value={str(action.reason)}
          onChange={(e) => set({ reason: e.target.value })}
        />
      ) : null}
      {type === 'webhook' ? (
        <input
          type="url"
          aria-label={label('address')}
          // a saved address stays on the server (0056): only its host is shown; typing replaces it
          placeholder={
            str(action.urlHost) && str(action.urlRef)
              ? `${str(action.urlHost)}/… (saved; type a new address to replace it)`
              : 'https://'
          }
          className={inputClass}
          value={str(action.url)}
          onChange={(e) => set({ url: e.target.value })}
        />
      ) : null}
      {type === 'update_linked' ? (
        <UpdateLinked
          action={action}
          ctx={ctx}
          sheets={sheets}
          label={label}
          invalid={invalid}
          onChange={onChange}
        />
      ) : null}
    </div>
  );
}

function Recipients({
  action,
  ctx,
  label,
  onChange,
}: {
  action: ActionJson;
  ctx: Ctx;
  label(part: string): string;
  onChange(to: Json[]): void;
}) {
  const to = (Array.isArray(action.to) ? action.to : []).filter(
    (x): x is string => typeof x === 'string',
  );
  const options: { group: string; items: { id: string; label: string }[] }[] = [
    {
      group: 'People in a field',
      items: peopleFields(ctx).map((f) => ({ id: `field:${f.key}`, label: f.name })),
    },
    { group: 'The change', items: [{ id: 'actor', label: 'The person who made the change' }] },
    {
      group: 'People',
      items: [...ctx.people.values()].map((p) => ({ id: `user:${p.id}`, label: p.name })),
    },
    {
      group: 'Teams',
      items: [...ctx.teams.values()].map((t) => ({ id: `team:${t.id}`, label: t.name })),
    },
    {
      group: 'Job roles',
      items: [...ctx.jobRoles.values()].map((r) => ({ id: `jobRole:${r.id}`, label: r.name })),
    },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-label-13">Notify</span>
      {to.map((entry) => (
        <span
          key={entry}
          className="border-line bg-background-100 text-label-13 inline-flex items-center gap-1 rounded-full border py-0.5 pr-0.5 pl-2"
        >
          {describeRecipients([entry], ctx)}
          <button
            type="button"
            className="hover:bg-soft focus-visible:outline-focus rounded-full p-0.5 focus-visible:outline-2"
            aria-label={`Do not notify ${describeRecipients([entry], ctx)}`}
            onClick={() => onChange(to.filter((x) => x !== entry))}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <select
        aria-label={label('add someone to notify')}
        className={selectClass}
        value=""
        onChange={(e) => e.target.value && onChange([...to, e.target.value])}
      >
        <option value="">Add someone…</option>
        {options.map((o) =>
          o.items.length ? (
            <optgroup key={o.group} label={o.group}>
              {o.items
                .filter((x) => !to.includes(x.id))
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
            </optgroup>
          ) : null,
        )}
      </select>
    </div>
  );
}

function UpdateLinked({
  action,
  ctx,
  sheets,
  label,
  invalid,
  onChange,
}: {
  action: ActionJson;
  ctx: Ctx;
  sheets: SheetRef[];
  label(part: string): string;
  invalid: boolean;
  onChange(a: ActionJson): void;
}) {
  const path = (
    action.path && typeof action.path === 'object' && !Array.isArray(action.path) ? action.path : {}
  ) as Record<string, Json>;
  const direction = path.direction === 'in' ? 'in' : 'out';
  const out = actionFields('update_linked', ctx);
  const incoming = incomingLinkFields(
    ctx,
    sheets.map((s) => s.id),
  );
  const linkKey = str(path.linkFieldKey);
  const target =
    direction === 'out'
      ? linkTargetSheet(out.find((f) => f.key === linkKey))
      : str(path.sheetId) || null;
  const targetFields = target ? storedFields(ctx, target) : [];
  const targetField = targetFields.find((f) => f.key === action.fieldKey);
  const sheetName = (id: string) => sheets.find((s) => s.id === id)?.name ?? 'Another sheet';
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        aria-label={label('which items')}
        className={selectClass}
        value={direction}
        onChange={(e) =>
          onChange({
            ...action,
            path:
              e.target.value === 'in'
                ? {
                    direction: 'in',
                    sheetId: incoming[0]?.sheetId ?? null,
                    linkFieldKey: incoming[0]?.key ?? null,
                  }
                : { direction: 'out', linkFieldKey: out[0]?.key ?? null },
            fieldKey: null,
            value: null,
          })
        }
      >
        <option value="out">items this item links to in</option>
        {incoming.length ? <option value="in">items that link here through</option> : null}
      </select>
      {direction === 'out' ? (
        <FieldSelect
          label={label('link field')}
          value={linkKey}
          fields={out}
          onChange={(k) =>
            onChange({
              ...action,
              path: { direction: 'out', linkFieldKey: k },
              fieldKey: null,
              value: null,
            })
          }
        />
      ) : (
        <select
          aria-label={label('link field')}
          className={selectClass}
          value={`${str(path.sheetId)}:${linkKey}`}
          onChange={(e) => {
            const [sheetId, key] = e.target.value.split(':');
            onChange({
              ...action,
              path: { direction: 'in', sheetId: sheetId!, linkFieldKey: key! },
              fieldKey: null,
              value: null,
            });
          }}
        >
          {incoming.map((f) => (
            <option key={f.id} value={`${f.sheetId}:${f.key}`}>
              {sheetName(f.sheetId)} · {f.name}
            </option>
          ))}
        </select>
      )}
      <span className="text-label-13">: set</span>
      <FieldSelect
        label={label('linked field')}
        value={str(action.fieldKey)}
        fields={targetFields}
        onChange={(k) => onChange({ ...action, fieldKey: k, value: null })}
      />
      {targetField ? (
        <>
          <span className="text-label-13">to</span>
          <ValuePicker
            field={targetField}
            ctx={ctx}
            value={action.value}
            label={label('value')}
            invalid={invalid}
            onChange={(v) => onChange({ ...action, value: v })}
          />
        </>
      ) : null}
    </div>
  );
}

function TestPanel({ result, item }: { result: TestResult; item: Item }) {
  const triggerWord =
    result.trigger.check === 'matches'
      ? 'Matches'
      : result.trigger.check === 'event'
        ? 'Runs on the event'
        : 'Does not match';
  return (
    <div role="region" aria-label="Test result" className="text-label-13 flex flex-col gap-3">
      <p className="m-0 font-semibold">
        {result.wouldRun ? 'Would run on' : 'Would not run on'} {item.displayId} {item.name}
      </p>
      <div className="flex flex-col gap-1">
        <h3 className="text-label-13 m-0 font-extrabold">Trigger matches?</h3>
        <p className="m-0 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'text-label-12 rounded-full border px-2 py-0.5 font-semibold',
              result.trigger.check === 'no_match'
                ? 'border-crit/40 text-crit'
                : 'border-good/40 text-good',
            )}
          >
            {result.trigger.check === 'no_match' ? '✗ ' : '✓ '}
            {triggerWord}
          </span>
          {result.trigger.text}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-label-13 m-0 font-extrabold">Conditions?</h3>
        {result.conditions.length === 0 ? (
          <p className="text-muted-foreground m-0">No conditions.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {result.conditions.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'text-label-12 rounded-full border px-2 py-0.5 font-semibold',
                    c.ok ? 'border-good/40 text-good' : 'border-crit/40 text-crit',
                  )}
                >
                  {c.ok ? '✓ Holds' : '✗ Does not hold'}
                </span>
                {c.text}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-label-13 m-0 font-extrabold">Planned steps</h3>
        <ol className="m-0 flex flex-col gap-1 pl-5">
          {result.steps.map((s, i) => (
            <li key={i}>
              <span className="flex flex-wrap items-center gap-2">
                {s.summary}
                {s.outcome ? <OutcomeChip outcome={s.outcome} /> : null}
                {s.message ? <span className="text-muted-foreground">{s.message}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <p className="text-muted-foreground text-label-12 m-0">
        Nothing was changed. The test only plans the steps; when the automation runs, status rules
        and locks still apply.
      </p>
    </div>
  );
}

/** The key webhooks of this automation are signed with (owners and admins; each look is logged). */
function SigningKey({ org, automationId }: { org: string; automationId: string }) {
  const [key, setKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const id = useId();
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {/* the header's wire name keeps "Klarert" after the rename to Keptrow: receivers check it (docs/14) */}
      <p id={id} className="text-muted-foreground text-label-12 m-0">
        Webhooks are signed: the header X-Klarert-Signature is t=(seconds),v1=(HMAC-SHA256 of
        &quot;t.body&quot; with this automation&apos;s signing key). Only owners and admins can see
        the key.
      </p>
      {key ? (
        <input
          readOnly
          aria-label="Signing key"
          aria-describedby={id}
          className={cn(inputClass, 'font-mono')}
          value={key}
          onFocus={(e) => e.currentTarget.select()}
        />
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start"
          disabled={pending}
          aria-describedby={id}
          onClick={async () => {
            setPending(true);
            const r = await revealSigningKeyAction({ org, automationId });
            setPending(false);
            if (!r.ok) toast.error(r.error.message);
            else setKey(r.data.key);
          }}
        >
          Show signing key
        </Button>
      )}
    </div>
  );
}
