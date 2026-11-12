// Automation events, actions, planned effects and run steps (docs/04 §2, §5, §7). Pure data.
import type { Automation, Json, TriggerId } from '../types';

/** Who caused a change. `$actor` and the `actor` recipient mean the person who started the chain. */
export interface Actor {
  kind: 'user' | 'automation' | 'form' | 'system';
  /** Profile id for a user, automation id for an automation, null for forms and the system. */
  id: string | null;
}

/** What a write emits (docs/04 §2). Computed number fields get `value.changed` events from the runner. */
export type AutomationEvent =
  | { type: 'item.created'; sheetId: string; itemId: string; actor: Actor }
  | { type: 'form.submitted'; sheetId: string; itemId: string; formId: string | null; actor: Actor }
  | {
      type: 'value.changed';
      sheetId: string;
      itemId: string;
      fieldId: string;
      before: unknown;
      after: unknown;
      actor: Actor;
    }
  | {
      type: 'item.moved';
      sheetId: string;
      itemId: string;
      fromGroupId: string;
      toGroupId: string;
      actor: Actor;
    }
  | {
      type: 'links.changed';
      sheetId: string;
      itemId: string;
      fieldId: string;
      before: string[];
      after: string[];
      actor: Actor;
    }
  | { type: 'button.clicked'; sheetId: string; itemId: string; fieldId: string; actor: Actor }
  | {
      type: 'schedule';
      sheetId: string;
      itemId: string;
      automationId: string;
      occurrence: string;
      actor: Actor;
    };

export type EventType = AutomationEvent['type'];

/** The event types each trigger can match; the runner skips automations that cannot match before loading items. */
export const TRIGGER_EVENTS: Record<TriggerId, EventType[]> = {
  item_created: ['item.created'],
  form_submitted: ['form.submitted'],
  field_changed: ['value.changed', 'links.changed'],
  field_becomes: ['value.changed'],
  number_above: ['value.changed'],
  number_below: ['value.changed'],
  date_arrives: ['schedule'],
  clock_warning: ['schedule'],
  evidence_expiring: ['schedule'],
  button_clicked: ['button.clicked'],
  checklist_no: ['value.changed'],
};

export type ActionId =
  | 'set_field'
  | 'notify'
  | 'request_update'
  | 'create_item'
  | 'update_linked'
  | 'move_to_group'
  | 'assign'
  | 'lock_item'
  | 'post_update'
  | 'webhook'
  | 'raise_version';

export const ACTION_IDS: ActionId[] = [
  'set_field',
  'notify',
  'request_update',
  'create_item',
  'update_linked',
  'move_to_group',
  'assign',
  'lock_item',
  'post_update',
  'webhook',
  'raise_version',
];

export type ActionJson = Automation['actions'][number];

/**
 * A side effect the runner executes, each in its own transaction (docs/04 §7.3). Values are raw inputs the target
 * field's `normalize` accepts; the executor validates them against the target item like any other write.
 */
export type Effect =
  | {
      kind: 'set_values';
      sheetId: string;
      itemId: string;
      /** field id → raw value (null clears). */
      values: Record<string, Json | null>;
    }
  | {
      kind: 'notify';
      itemId: string;
      userIds: string[];
      notification: 'notify' | 'request';
      body: string;
      /** The automation update posted on the item, or null. */
      post: string | null;
    }
  | {
      kind: 'create_item';
      sourceSheetId: string;
      sourceItemId: string;
      sheetId: string;
      groupId: string | null;
      name: string;
      /** Target field key → raw value. */
      values: Record<string, Json | null>;
      link: boolean;
      /** The first person of the source's first people field, copied into the target's first empty people field. */
      ownerId: string | null;
    }
  | {
      kind: 'update_linked';
      itemId: string;
      direction: 'out' | 'in';
      /** out: the linked items, known when planning. in: found by the executor. */
      targetIds: string[] | null;
      /** in: the sheet whose link field points at this item. */
      fromSheetId: string | null;
      linkFieldKey: string;
      fieldKey: string;
      value: Json | null;
    }
  | { kind: 'move'; itemId: string; groupId: string }
  | { kind: 'lock'; itemId: string; reason: string | null }
  | { kind: 'post'; itemId: string; body: string }
  | { kind: 'webhook'; itemId: string; url: string; payload: Json };

export type StepOutcome = 'done' | 'no_change' | 'blocked' | 'failed' | 'skipped';

/** One action of a run as planned: effects to execute, or an outcome decided without executing anything. */
export interface PlannedStep {
  action: string;
  /** Plain-words description for the toast, the run log and the builder's Test ("Set Status to Done"). */
  summary: string;
  effects: Effect[];
  /** Set when planning already decided (no recipients → skipped, a missing field → failed, already so → no_change). */
  outcome?: Exclude<StepOutcome, 'done'>;
  message?: string;
}

/** A step as stored in automation_runs.steps. */
export interface Step {
  action: string;
  summary: string;
  outcome: StepOutcome;
  message: string;
}

export type RunStatus = 'done' | 'partial' | 'failed' | 'stopped';
