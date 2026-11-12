// Workflow (docs/05 §4): the lifecycle of any sheet read from one of its option fields. Stages are the field's
// options in order; each stage lists its items, how many are overdue, the status rules that guard entering it and the
// automations that run when an item enters it or the field changes. Data, not code: nothing here knows a CAPA. Pure.
import type { Automation, Ctx, Field, Item, StatusRule } from './types';
import { describeAction, describeTrigger, joinWords } from './automations/builder';
import { laneFields } from './views/kanban';
import { laneOptions } from './fields/view-support';
import type { LabelOption } from './fields/types';
import { isItemDone, isOverdueOf, keysOf, kindOf } from './values';

/** Fields whose options can be the stages: single-choice option fields (status, dropdown, priority …). */
export function stageFields(fields: Field[], ctx: Ctx): Field[] {
  return laneFields(fields, ctx).filter((f) => {
    const k = kindOf(f, ctx);
    return k === 'option' || k === 'ordered';
  });
}

/** The stage field: the chosen key when it still qualifies, else the first status-like field. */
export function stageField(fields: Field[], chosenKey: string | null | undefined, ctx: Ctx) {
  const usable = stageFields(fields, ctx);
  return usable.find((f) => f.key === chosenKey) ?? usable[0] ?? null;
}

export interface StageItem {
  id: string;
  displayId: string;
  name: string;
  overdue: boolean;
  done: boolean;
}

export interface StageRule {
  id: string;
  /** "Needs Root cause and Evidence" */
  requires: string | null;
  comment: boolean;
  message: string | null;
}

export interface StageAutomation {
  id: string;
  name: string;
  enabled: boolean;
  /** "When Status becomes Closed" */
  when: string;
  /** "notify Owner and lock" */
  then: string;
}

export interface Stage {
  /** Option id; null = items without a stage (or a value that is no longer an option). */
  key: string | null;
  option: LabelOption | null;
  label: string;
  items: StageItem[];
  overdue: number;
  rules: StageRule[];
  automations: StageAutomation[];
}

export interface Lifecycle {
  field: Field;
  stages: Stage[];
  /** Automations that run on any change of the field (field_changed). */
  onChange: StageAutomation[];
  total: number;
  overdue: number;
}

/** An item is overdue when any deadline date of it has passed and it is not done. */
export function isItemOverdue(item: Item, fields: Field[], ctx: Ctx): boolean {
  return fields.some((f) => isOverdueOf(item, f, ctx));
}

/** The rules on the field that apply when an item enters the option. */
export function rulesFor(field: Field, optionId: string, ctx: Ctx): StageRule[] {
  return (field.rules ?? [])
    .filter(
      (r: StatusRule) =>
        r.whenFieldKey === field.key && (r.whenValues ?? []).some((v) => String(v) === optionId),
    )
    .map((r) => {
      const names = (r.require ?? []).map((k) => ctx.fieldsByKey.get(k)?.name ?? k);
      return {
        id: r.id,
        requires: names.length ? `Needs ${joinWords(names)}` : null,
        comment: !!r.requireComment,
        message: r.message?.trim() || null,
      };
    });
}

function describe(a: Automation, ctx: Ctx, sheetName?: (id: string) => string | undefined) {
  return {
    id: a.id,
    name: a.name,
    enabled: a.enabled,
    when: describeTrigger(a.trigger, ctx),
    then: joinWords(a.actions.map((x) => describeAction(x, ctx, sheetName))) || 'nothing yet',
  };
}

/** The field's lifecycle: stages in option order, then "No stage" when some items have none. */
export function lifecycle(
  field: Field,
  items: Item[],
  automations: Automation[],
  ctx: Ctx,
  sheetName?: (id: string) => string | undefined,
): Lifecycle {
  const fields = [...ctx.fieldsByKey.values()];
  const options = laneOptions(field, ctx) ?? [];
  const mine = automations.filter((a) => a.trigger.fieldKey === field.key);
  const stages: Stage[] = options.map((o) => ({
    key: o.id,
    option: o,
    label: o.label,
    items: [],
    overdue: 0,
    rules: rulesFor(field, o.id, ctx),
    automations: mine
      .filter((a) => a.trigger.type === 'field_becomes' && String(a.trigger.value) === o.id)
      .map((a) => describe(a, ctx, sheetName)),
  }));
  const byKey = new Map(stages.map((s) => [s.key, s]));
  const none: Stage = {
    key: null,
    option: null,
    label: 'No stage',
    items: [],
    overdue: 0,
    rules: [],
    automations: [],
  };
  let overdue = 0;
  for (const item of items) {
    const k = keysOf(item, field, ctx)[0];
    const stage = (k !== undefined ? byKey.get(k) : undefined) ?? none;
    const late = isItemOverdue(item, fields, ctx);
    stage.items.push({
      id: item.id,
      displayId: item.displayId,
      name: item.name,
      overdue: late,
      done: isItemDone(item, ctx),
    });
    if (late) {
      stage.overdue += 1;
      overdue += 1;
    }
  }
  return {
    field,
    stages: none.items.length > 0 ? [...stages, none] : stages,
    onChange: mine
      .filter((a) => a.trigger.type === 'field_changed')
      .map((a) => describe(a, ctx, sheetName)),
    total: items.length,
    overdue,
  };
}
