// Action planning (docs/04 §5): each action becomes a planned step with the effects to execute, or an outcome decided
// without executing anything. Pure: no writes, no clock but ctx.now, so the builder's Test (M8) shows the same steps
// the runner executes.
import { raiseVersion } from '../fields/version';
import type { Automation, Ctx, Item, Json } from '../types';
import { defOf, keysOfValue, kindOf, valueOf } from '../values';
import { actorName, renderTemplate, type TemplateEnv } from './template';
import type { ActionId, ActionJson, AutomationEvent, Effect, PlannedStep } from './types';
import { isWebhookPreset, savedWebhookHost, webhookPayload } from './webhook';
import { resolveValueToken, valueLabel } from './value-tokens';
import { SUBITEM_ACTIONS } from './subitem-actions';
import { planSyncAction } from './requirement-sync';

export { resolveValueToken, valueLabel };

export interface PlanEnv extends TemplateEnv {
  automation: Pick<Automation, 'id' | 'name' | 'trigger'>;
  /** People holding a job role (members whose job title is the role's name). */
  roleHolders(roleId: string): string[];
}

type Planner = (
  action: ActionJson,
  item: Item,
  ctx: Ctx,
  env: PlanEnv,
  event: AutomationEvent | null,
) => PlannedStep;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

const failed = (action: string, summary: string, message: string): PlannedStep => ({
  action,
  summary,
  effects: [],
  outcome: 'failed',
  message,
});
const skipped = (action: string, summary: string, message: string): PlannedStep => ({
  action,
  summary,
  effects: [],
  outcome: 'skipped',
  message,
});

const missingField = (action: string, key: string | null) =>
  failed(
    action,
    'Change a field',
    key ? `The field "${key}" no longer exists.` : 'Choose a field.',
  );

/** People ids in a value, at any depth (people fields, lookups of people fields). Only workspace members. */
function peopleIn(v: unknown, ctx: Ctx, out: string[] = []): string[] {
  if (typeof v === 'string') {
    if (ctx.people.has(v) && !out.includes(v)) out.push(v);
  } else if (Array.isArray(v)) {
    for (const x of v) peopleIn(x, ctx, out);
  }
  return out;
}

/** Recipients: "field:<key>", "user:<id>", "team:<id>", "jobRole:<id>", "actor". Members only, no duplicates. */
export function recipients(to: Json | undefined, item: Item, ctx: Ctx, env: PlanEnv): string[] {
  const out: string[] = [];
  const add = (ids: unknown) => peopleIn(ids, ctx, out);
  for (const entry of Array.isArray(to) ? to : []) {
    if (typeof entry !== 'string') continue;
    if (entry === 'actor') {
      if (env.actor.kind === 'user') add(env.actor.id);
      continue;
    }
    const [kind, id] = [entry.slice(0, entry.indexOf(':')), entry.slice(entry.indexOf(':') + 1)];
    if (kind === 'field') {
      const field = ctx.fieldsByKey.get(id);
      if (field) add(valueOf(item, field, ctx));
    } else if (kind === 'user') add(id);
    else if (kind === 'team') add(ctx.teams.get(id)?.memberIds ?? []);
    else if (kind === 'jobRole') add(env.roleHolders(id));
  }
  return out;
}

const namesOf = (ids: string[], ctx: Ctx) =>
  ids.map((id) => ctx.people.get(id)?.name ?? 'Someone').join(', ');

const storedField = (action: ActionJson, ctx: Ctx) => {
  const key = str(action.fieldKey);
  const field = key ? ctx.fieldsByKey.get(key) : undefined;
  return { key, field };
};

/**
 * The actions (docs/04 §5), keyed by id: 11 on the item, 3 for sub-items (subitem-actions.ts), the requirement
 * checks sync (requirement-sync.ts) and start_workflow (approvals). A new action is one
 * entry here and one executor case.
 */
export const ACTIONS: Record<ActionId, Planner> = {
  set_field: (action, item, ctx, env) => {
    const { key, field } = storedField(action, ctx);
    if (!field) return missingField('set_field', key);
    const summary = `Set ${field.name}`;
    if (defOf(field).storage !== 'values')
      return failed('set_field', summary, `${field.name} cannot be set by automations.`);
    const v = resolveValueToken(action.value, ctx, env.actor);
    if (!v.ok) return skipped('set_field', summary, v.message);
    // `template: true`: a text value is a message template ("{requirement}: {requirement_guidance}"), rendered now
    if (action.template === true && typeof v.value === 'string')
      v.value = renderTemplate(v.value, item, ctx, env).slice(0, 10000);
    return {
      action: 'set_field',
      summary: `Set ${field.name} to ${valueLabel(field, v.value, ctx)}`,
      effects: [
        {
          kind: 'set_values',
          sheetId: item.sheetId,
          itemId: item.id,
          values: { [field.id]: v.value },
        },
      ],
    };
  },

  notify: (action, item, ctx, env) => {
    const ids = recipients(action.to, item, ctx, env);
    const body = renderTemplate(str(action.message) ?? '{id} {name}', item, ctx, env);
    if (ids.length === 0) return skipped('notify', 'Notify', 'No one to notify.');
    const names = namesOf(ids, ctx);
    return {
      action: 'notify',
      summary: `Notify ${names}`,
      effects: [
        {
          kind: 'notify',
          itemId: item.id,
          userIds: ids,
          notification: 'notify',
          body,
          post: `Notified ${names}: ${body}`,
        },
      ],
    };
  },

  request_update: (action, item, ctx, env) => {
    const { key, field } = storedField(action, ctx);
    if (!field) return missingField('request_update', key);
    const ids = peopleIn(valueOf(item, field, ctx), ctx);
    if (ids.length === 0)
      return skipped('request_update', 'Request an update', `${field.name} is empty.`);
    const names = namesOf(ids, ctx);
    const body = renderTemplate(
      str(action.message) ?? 'Please update {id} {name}.',
      item,
      ctx,
      env,
    );
    return {
      action: 'request_update',
      summary: `Request an update from ${names}`,
      effects: [
        {
          kind: 'notify',
          itemId: item.id,
          userIds: ids,
          notification: 'request',
          body,
          post: `Requested an update from ${names}: ${body}`,
        },
      ],
    };
  },

  create_item: (action, item, ctx, env) => {
    const sheetId = str(action.sheetId);
    if (!sheetId) return failed('create_item', 'Create an item', 'Choose the sheet to create on.');
    const name = renderTemplate(str(action.name) ?? '{name}', item, ctx, env).trim() || item.name;
    const values: Record<string, Json | null> = {};
    const raw =
      action.values && typeof action.values === 'object' && !Array.isArray(action.values)
        ? (action.values as Record<string, Json>)
        : {};
    for (const [k, v] of Object.entries(raw)) {
      const r = resolveValueToken(v, ctx, env.actor);
      if (r.ok)
        values[k] = typeof r.value === 'string' ? renderTemplate(r.value, item, ctx, env) : r.value;
    }
    const ownerField = ctx
      .fieldsOf(item.sheetId)
      .find((f) => defOf(f).storage === 'values' && kindOf(f, ctx) === 'people');
    const ownerId = ownerField ? (peopleIn(valueOf(item, ownerField, ctx), ctx)[0] ?? null) : null;
    return {
      action: 'create_item',
      summary: `Create "${name}"`,
      effects: [
        {
          kind: 'create_item',
          sourceSheetId: item.sheetId,
          sourceItemId: item.id,
          sheetId,
          groupId: str(action.groupId),
          name,
          values,
          link: action.link === true,
          ownerId,
        },
      ],
    };
  },

  update_linked: (action, item, ctx, env) => {
    const path = (
      action.path && typeof action.path === 'object' && !Array.isArray(action.path)
        ? action.path
        : {}
    ) as Record<string, Json>;
    const linkKey = str(path.linkFieldKey);
    const fieldKey = str(action.fieldKey);
    if (!linkKey || !fieldKey)
      return failed('update_linked', 'Update linked items', 'Choose the link and the field.');
    const v = resolveValueToken(action.value, ctx, env.actor);
    if (!v.ok) return skipped('update_linked', 'Update linked items', v.message);
    if (path.direction === 'in') {
      const fromSheetId = str(path.sheetId);
      if (!fromSheetId)
        return failed('update_linked', 'Update linked items', 'Choose the sheet that links here.');
      return {
        action: 'update_linked',
        summary: `Set ${fieldKey} on items linking here`,
        effects: [
          {
            kind: 'update_linked',
            itemId: item.id,
            direction: 'in',
            targetIds: null,
            fromSheetId,
            linkFieldKey: linkKey,
            fieldKey,
            value: v.value,
          },
        ],
      };
    }
    const linkField = ctx.fieldsByKey.get(linkKey);
    if (!linkField || defOf(linkField).storage !== 'links')
      return missingField('update_linked', linkKey);
    const targetIds = ctx.links(item.id, linkField.id);
    const targetSheet = (linkField.config as { targetSheetId?: unknown }).targetSheetId;
    const target =
      typeof targetSheet === 'string'
        ? ctx.fieldsOf(targetSheet).find((f) => f.key === fieldKey)
        : undefined;
    const summary = `Set ${target?.name ?? fieldKey}${target ? ` to ${valueLabel(target, v.value, ctx)}` : ''} on ${linkField.name}`;
    if (targetIds.length === 0) return skipped('update_linked', summary, 'No linked items.');
    return {
      action: 'update_linked',
      summary,
      effects: [
        {
          kind: 'update_linked',
          itemId: item.id,
          direction: 'out',
          targetIds,
          fromSheetId: null,
          linkFieldKey: linkKey,
          fieldKey,
          value: v.value,
        },
      ],
    };
  },

  move_to_group: (action, item, ctx) => {
    const group = ctx.groups.get(str(action.groupId) ?? '');
    if (!group) return failed('move_to_group', 'Move to a group', 'This group no longer exists.');
    const summary = `Move to ${group.name}`;
    if (item.groupId === group.id)
      return { action: 'move_to_group', summary, effects: [], outcome: 'no_change', message: '' };
    return {
      action: 'move_to_group',
      summary,
      effects: [{ kind: 'move', itemId: item.id, groupId: group.id }],
    };
  },

  assign: (action, item, ctx, env) => {
    const { key, field } = storedField(action, ctx);
    if (!field) return missingField('assign', key);
    const who = str(action.who);
    const id =
      who === 'actor'
        ? env.actor.kind === 'user'
          ? env.actor.id
          : null
        : who?.startsWith('user:')
          ? who.slice(5)
          : null;
    if (!id || !ctx.people.has(id))
      return skipped('assign', `Assign to ${field.name}`, 'No one to assign.');
    const name = ctx.people.get(id)!.name;
    const summary = `Assign ${name} to ${field.name}`;
    const current = keysOfValue(field, valueOf(item, field, ctx));
    if (current.includes(id))
      return { action: 'assign', summary, effects: [], outcome: 'no_change', message: '' };
    // add to the people already there; a one-person field takes the new person instead
    const def = defOf(field);
    const added = def.normalize([...current, id], field.config, ctx) as unknown;
    const value = keysOfValue(field, added).includes(id) ? [...current, id] : [id];
    return {
      action: 'assign',
      summary,
      effects: [
        {
          kind: 'set_values',
          sheetId: item.sheetId,
          itemId: item.id,
          values: { [field.id]: value },
        },
        {
          kind: 'notify',
          itemId: item.id,
          userIds: [id],
          notification: 'notify',
          body: `${actorName(env.actor, ctx)} assigned you to ${item.displayId} ${item.name} (${field.name}).`,
          post: null,
        },
      ],
    };
  },

  lock_item: (action, item) => {
    const reason = str(action.reason);
    const summary = reason ? `Lock the item: ${reason}` : 'Lock the item';
    if (item.locked)
      return { action: 'lock_item', summary, effects: [], outcome: 'no_change', message: '' };
    return { action: 'lock_item', summary, effects: [{ kind: 'lock', itemId: item.id, reason }] };
  },

  post_update: (action, item, ctx, env) => {
    const body = renderTemplate(str(action.message) ?? '', item, ctx, env).trim();
    if (!body) return skipped('post_update', 'Post an update', 'The message is empty.');
    return {
      action: 'post_update',
      summary: 'Post an update',
      effects: [{ kind: 'post', itemId: item.id, body: body.slice(0, 10000) }],
    };
  },

  webhook: (action, item, ctx, env) => {
    const url = str(action.url)?.trim() ?? '';
    let host = '';
    try {
      host = new URL(url).host;
    } catch {
      host = '';
    }
    // a saved address stays on the server (0056): the runner fills `url` in; previews know only its host
    const saved = !url && savedWebhookHost(action);
    if (saved) host = saved;
    else if (!url.startsWith('https://') || !host)
      return failed('webhook', 'Send a webhook', 'Webhooks need an https:// address.');
    const preset = isWebhookPreset(action.preset) ? action.preset : 'generic';
    return {
      action: 'webhook',
      summary: `Send a webhook to ${host}`,
      effects: [
        {
          kind: 'webhook',
          itemId: item.id,
          url,
          payload: webhookPayload(preset, env.automation, item, ctx, env),
        },
      ],
    };
  },

  raise_version: (action, item, ctx) => {
    const { key, field } = storedField(action, ctx);
    if (!field) return missingField('raise_version', key);
    const kind = action.kind === 'major' ? 'major' : 'minor';
    const current = valueOf(item, field, ctx);
    const next = raiseVersion(typeof current === 'string' ? current : null, kind);
    const summary = `Raise ${field.name} to ${next}`;
    if (defOf(field).normalize(next, field.config, ctx) !== next)
      return failed('raise_version', summary, `${field.name} does not hold a version.`);
    return {
      action: 'raise_version',
      summary,
      effects: [
        {
          kind: 'set_values',
          sheetId: item.sheetId,
          itemId: item.id,
          values: { [field.id]: next },
        },
      ],
    };
  },
  ...SUBITEM_ACTIONS,
  sync_requirement_checks: (action, item, ctx) => planSyncAction(action, item, ctx),

  /** Submit the item to an approval workflow of its sheet (docs/04 §13); the chain's person is the submitter. */
  start_workflow: (action, item, ctx, env) => {
    const id = str(action.workflowId);
    const w = (ctx.sheet.workflows ?? []).find((x) => x.id === id);
    if (!w)
      return failed(
        'start_workflow',
        'Submit for approval',
        id ? 'This approval workflow no longer exists.' : 'Choose an approval workflow.',
      );
    const summary = `Submit for approval: ${w.name}`;
    if (!w.enabled) return skipped('start_workflow', summary, `${w.name} is turned off.`);
    return {
      action: 'start_workflow',
      summary,
      effects: [
        {
          kind: 'start_workflow',
          itemId: item.id,
          workflowId: w.id,
          submittedBy: env.actor.kind === 'user' ? env.actor.id : null,
        },
      ],
    };
  },
};

export const isActionId = (id: unknown): id is ActionId =>
  typeof id === 'string' && Object.prototype.hasOwnProperty.call(ACTIONS, id);

/** Plan every action of an automation against the item (after the change), in array order. */
export function planActions(
  actions: ActionJson[],
  item: Item,
  event: AutomationEvent | null,
  ctx: Ctx,
  env: PlanEnv,
): PlannedStep[] {
  return actions.map((action) => {
    const type = action?.type;
    if (!isActionId(type))
      return failed(String(type ?? 'unknown'), 'Unknown action', 'This action is not supported.');
    try {
      return ACTIONS[type](action, item, ctx, env, event);
    } catch (e) {
      return failed(type, 'Run an action', e instanceof Error ? e.message : 'The action failed.');
    }
  });
}

export type { Effect };
