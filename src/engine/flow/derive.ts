// A sheet's flow (docs/05 §3.8, owner decision 15 Nov 2026): its steps in four groups, in the order data moves.
// 01 Inputs: manual entry (the New item dialog and its intake form), forms with who can submit, other sheets that
// create items here by automation or button, link fields from other sheets, and the inbound API row (coming later).
// 02 Sheet: its columns and relations. 03 Logic: its automations, approval workflows and lifecycle field.
// 04 Outputs: link fields to other sheets, items created or updated on other sheets, notifications and webhooks.
// Derived from configuration only, never stored, never from item rows. Pure.
import { readWorkflows, workflowProblems } from '../approvals/definition';
import { describeAction, describeRecipients, describeTrigger } from '../automations/builder';
import { formEligible } from '../fields/view-support';
import { formatDateTime } from '../fields/helpers';
import { resolveFieldType } from '../fields/resolve';
import { isPersonalField } from '../retention';
import { emptySheetData, sheetCtx } from '../sheet-data';
import type { Ctx, Json } from '../types';
import { formAccess, formState, FORM_STATE_LABEL, noticeReviewed } from '../views/form';
import { chosenIntake, newItemPlan, planQuestions, type IntakeForm } from '../views/new-item';
import { stageFields } from '../workflow';
import {
  DESTINATION_LABEL,
  FLOW_GROUP_TITLE,
  FLOW_GROUPS,
  type Destination,
  type FlowAutomation,
  type FlowField,
  type FlowStep,
  type FlowViewer,
  type FlowWorld,
  type HealthTone,
  type LeaveRow,
  type Provenance,
  type SentField,
  type SheetFlow,
  type StepHealth,
  type StepPack,
} from './types';
import { capitalise, maskUrl, maskWorld, plural, UNREADABLE_SHEET } from './words';

type Action = FlowAutomation['actions'][number];
const str = (v: Json | undefined) => (typeof v === 'string' ? v : '');

/** Storage of a field's type ('links' for link and requirement fields); unknown types count as none. */
const storageOf = (f: { type: string }) => resolveFieldType(f.type)?.storage ?? 'none';
const targetOf = (f: FlowField): string | null => {
  const t = (f.config as { targetSheetId?: unknown } | null)?.targetSheetId;
  return typeof t === 'string' ? t : null;
};
const inverseOf = (f: FlowField): string | null => {
  const t = (f.config as { inverseFieldId?: unknown } | null)?.inverseFieldId;
  return typeof t === 'string' ? t : null;
};
export const isLinkField = (f: FlowField) => storageOf(f) === 'links' && !!targetOf(f);

// ───────────────────────── context ─────────────────────────

/** The engine's Ctx for one sheet, from configuration only (no items): enough to describe triggers and actions. */
const ctxCache = new WeakMap<FlowWorld, Map<string, Ctx>>();
export function flowCtx(world: FlowWorld, sheetId: string, viewer: FlowViewer): Ctx | null {
  let cache = ctxCache.get(world);
  if (!cache) ctxCache.set(world, (cache = new Map()));
  const key = `${sheetId}:${viewer.userId}:${viewer.timeZone}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sheet = world.sheets.find((s) => s.id === sheetId);
  if (!sheet) return null;
  const ctx = sheetCtx(
    {
      ...emptySheetData(sheet),
      fields: world.fields.filter((f) => f.sheetId === sheetId),
      people: world.people,
      teams: world.teams,
      jobRoles: world.jobRoles,
      related: { sheets: world.sheets, fields: world.fields, items: [] },
    },
    { now: viewer.now, timeZone: viewer.timeZone, userId: viewer.userId, newId: (p) => p },
  );
  cache.set(key, ctx);
  return ctx;
}

// ───────────────────────── health ─────────────────────────

const TONE_RANK: Record<HealthTone, number> = { ok: 0, idle: 1, test: 2, off: 3, warn: 4, crit: 5 };
export const worseTone = (a: HealthTone | null, b: HealthTone | null): HealthTone | null =>
  !a ? b : !b ? a : TONE_RANK[b] > TONE_RANK[a] ? b : a;

/** An automation's health in words (docs/05 §3.8 and the board's health view 1j): problems first, then last run. */
export function automationHealth(
  a: FlowAutomation,
  world: FlowWorld,
  viewer: FlowViewer,
): StepHealth {
  const h = world.health.automations[a.id];
  const problems: { tone: HealthTone; words: string }[] = [];
  if (h?.deadLetters)
    problems.push({
      tone: 'crit',
      words: `Dead letter: ${plural(h.deadLetters, 'webhook')} failed`,
    });
  if (h?.failed)
    problems.push({ tone: 'crit', words: `${plural(h.failed, 'run')} failed in 30 days` });
  if (h?.partial)
    problems.push({ tone: 'warn', words: `${plural(h.partial, 'run')} partly done in 30 days` });
  if (h?.retrying)
    problems.push({ tone: 'warn', words: `${plural(h.retrying, 'webhook')} waiting to retry` });
  const state: { tone: HealthTone; words: string } | null = !a.enabled
    ? { tone: 'off', words: 'Paused' }
    : a.mode === 'test'
      ? { tone: 'test', words: 'In test mode' }
      : null;
  const last = a.lastRunAt
    ? { tone: 'ok' as const, words: `Last run ${formatDateTime(a.lastRunAt, viewer.timeZone)}` }
    : { tone: 'idle' as const, words: 'Not run yet' };
  const all = [...problems, ...(state ? [state] : [])];
  const head = problems[0] ?? state ?? last;
  return {
    tone: head.tone,
    words: head.words,
    problems: all.map((p) => p.words),
  };
}

// ───────────────────────── pack provenance ─────────────────────────

export function packMarker(
  world: FlowWorld,
  pack: Provenance | null | undefined,
  driftKey: string | null,
  onPackSheet: boolean,
): StepPack | null {
  if (!pack) return onPackSheet ? { state: 'added', title: null, words: 'Added here' } : null;
  const title = world.packs.find((p) => p.installId === pack.installId)?.title ?? 'a pack';
  const d = driftKey ? world.drift[driftKey] : undefined;
  if (d === 'unchanged') return { state: 'unchanged', title, words: `From ${title} · unchanged` };
  if (d === 'changed') return { state: 'changed', title, words: `From ${title} · changed` };
  return { state: 'from', title, words: `From ${title}` };
}

/** A workflow's provenance: the drift entry when the comparison knows it; else by its id's pack namespace. */
function workflowPack(
  world: FlowWorld,
  sheetId: string,
  workflowId: string,
  sheetPack: Provenance | null,
): StepPack | null {
  const key = `workflow:${sheetId}:${workflowId}`;
  const d = world.drift[key];
  const ns = (k: string) => k.replace(/[^a-z0-9]/g, '');
  const byNamespace = world.packs.find((p) => {
    const n = ns(p.key);
    return workflowId === n || workflowId.startsWith(`${n}_`);
  });
  if (d) {
    const title =
      byNamespace?.title ??
      world.packs.find((p) => p.installId === sheetPack?.installId)?.title ??
      'a pack';
    return { state: d, title, words: `From ${title} · ${d}` };
  }
  if (byNamespace)
    return { state: 'from', title: byNamespace.title, words: `From ${byNamespace.title}` };
  return sheetPack ? { state: 'added', title: null, words: 'Added here' } : null;
}

// ───────────────────────── leaves the system ─────────────────────────

const destinationOf = (preset: Json | undefined): Destination =>
  preset === 'teams' ? 'teams' : preset === 'slack' ? 'slack' : 'webhook';

/**
 * What a webhook action sends (docs/04 §5 payload): every field a message may carry (protected fields never; a
 * restricted one as "Restricted", never its value). Teams and Slack show at most 8 filled-in fields of them.
 */
export function webhookLeave(
  a: FlowAutomation,
  action: Action,
  index: number,
  world: FlowWorld,
  viewer: FlowViewer,
): LeaveRow {
  const sheet = world.sheets.find((s) => s.id === a.sheetId);
  const destination = destinationOf(action.preset);
  const fields: SentField[] = world.fields
    .filter((f) => f.sheetId === a.sheetId)
    .filter((f) => {
      const st = storageOf(f);
      return st !== 'protected' && st !== 'none';
    })
    .map((f) => ({
      name: f.name,
      personal: isPersonalField(f),
      restricted: !!f.restrictedTo,
    }));
  return {
    id: `${a.id}:${index}`,
    sheetId: a.sheetId,
    sheetName: sheet?.name ?? UNREADABLE_SHEET,
    automationId: a.id,
    automationName: a.name,
    destination,
    host: maskUrl(action.url),
    note:
      destination === 'webhook'
        ? 'The item’s ID, name and link, the sheet, the automation and every field below.'
        : 'The item’s ID, name and link, the sheet, the automation and up to 8 filled-in fields below.',
    fields,
    personal: fields.filter((f) => f.personal && !f.restricted).length,
    enabled: a.enabled,
    mode: a.mode,
    health: automationHealth(a, world, viewer),
    pack: packMarker(world, a.pack, `automation:${a.id}`, !!sheet?.pack),
  };
}

// ───────────────────────── the flow ─────────────────────────

const sheetNameOf = (world: FlowWorld, id: string | null | undefined) =>
  (id && world.sheets.find((s) => s.id === id)?.name) || UNREADABLE_SHEET;

/** The target sheet of an action that reaches another sheet, or null. */
export function actionTarget(action: Action, a: FlowAutomation, world: FlowWorld): string | null {
  if (action.type === 'create_item' || action.type === 'sync_requirement_checks')
    return str(action.sheetId) || null;
  if (action.type === 'update_linked') {
    const path = (action.path ?? {}) as {
      direction?: string;
      linkFieldKey?: string;
      sheetId?: string;
    };
    if (path.direction === 'in') return path.sheetId ?? null;
    const f = world.fields.find((x) => x.sheetId === a.sheetId && x.key === path.linkFieldKey);
    return f ? targetOf(f) : null;
  }
  return null;
}

const NOTIFY = new Set(['notify', 'request_update', 'assign']);

/** The sheet's steps, or null when the person cannot read it. */
export function deriveSheetFlow(
  rawWorld: FlowWorld,
  sheetId: string,
  viewer: FlowViewer,
): SheetFlow | null {
  const world = maskWorld(rawWorld);
  const sheet = world.sheets.find((s) => s.id === sheetId);
  const ctx = flowCtx(world, sheetId, viewer);
  if (!sheet || !ctx) return null;
  const onPack = !!sheet.pack;
  const fields = world.fields.filter((f) => f.sheetId === sheetId);
  const forms = world.forms
    .filter((f) => f.sheetId === sheetId)
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  const autos = world.automations
    .filter((a) => a.sheetId === sheetId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const steps: FlowStep[] = [];
  const health = (a: FlowAutomation) => automationHealth(a, world, viewer);
  const autoPack = (a: FlowAutomation) =>
    packMarker(
      world,
      a.pack,
      `automation:${a.id}`,
      !!world.sheets.find((s) => s.id === a.sheetId)?.pack,
    );

  // ── 01 inputs
  const intakeForms: IntakeForm[] = forms.map((f) => ({ id: f.id, name: f.name, form: f.layout }));
  const intake = chosenIntake(sheet.newItemForm, intakeForms);
  const plan = newItemPlan(fields, intake, viewer.now);
  const asked = planQuestions(plan).length;
  const manualProblems: string[] = [];
  if (typeof sheet.newItemForm === 'string' && !intake)
    manualProblems.push('The chosen form no longer exists: the standard dialog asks');
  else if (intake && !plan.form)
    manualProblems.push(`“${intake.name}” is closed: the standard dialog asks`);
  steps.push({
    id: `manual:${sheetId}`,
    group: 'inputs',
    kind: 'manual',
    name: 'Manual entry',
    subline: plan.form
      ? `New item dialog asks the form “${plan.form.name}”${plan.steps.length > 1 ? ` in ${plan.steps.length} steps` : ''} · editors of this sheet`
      : `New item dialog · ${plural(asked + 1, 'question')} · editors of this sheet`,
    health: manualProblems.length
      ? { tone: 'warn', words: manualProblems[0]!, problems: manualProblems }
      : null,
    pack: null,
    edit: { editor: 'new_item', id: sheetId, sheetId },
  });

  for (const form of forms) {
    const access = formAccess(form.layout);
    const state = formState(form.layout, viewer.now, form.responses ?? 0);
    const problems: { tone: HealthTone; words: string }[] = [];
    const onForm = new Set([
      ...form.layout.fields.map((q) => q.key),
      ...(form.layout.prefill ?? []).map((p) => p.key),
    ]);
    const missing = fields.filter(
      (f) => f.required && !f.hidden && formEligible(f) && !onForm.has(f.key),
    );
    if (missing.length)
      problems.push({
        tone: 'warn',
        words: `${plural(missing.length, 'required field')} not on the form`,
      });
    if (access === 'public' && form.layout.status === 'open' && !noticeReviewed(form.layout.notice))
      problems.push({
        tone: 'warn',
        words: 'Privacy notice not reviewed: the form takes no answers',
      });
    const answers =
      form.responses !== undefined
        ? ` · ${plural(form.responses, 'answer')}${form.lastAt ? `, last ${formatDateTime(form.lastAt, viewer.timeZone)}` : ''}`
        : '';
    const stateTone: HealthTone =
      state === 'open' ? 'ok' : state === 'closed' ? 'off' : state === 'full' ? 'warn' : 'idle';
    const head = problems[0] ?? { tone: stateTone, words: `${FORM_STATE_LABEL[state]}${answers}` };
    steps.push({
      id: `form:${form.id}`,
      group: 'inputs',
      kind: 'form',
      name: form.name,
      subline: `${access === 'public' ? 'Public form · anyone with the link' : 'Internal form · editors of the workspace'}${
        intake?.id === form.id ? ' · asked by + New' : ''
      }`,
      health: {
        tone: head.tone,
        words: head.words,
        problems: [
          ...problems.map((p) => p.words),
          ...missing.map((f) => `Required and not on the form: ${f.name}`),
        ],
      },
      pack: packMarker(world, form.pack, `form:${form.id}`, onPack),
      edit: { editor: 'form', id: form.id, sheetId },
    });
  }

  // other sheets that create items here (automations and buttons)
  for (const a of world.automations) {
    if (a.sheetId === sheetId) continue;
    a.actions.forEach((action, i) => {
      if (action.type !== 'create_item' && action.type !== 'sync_requirement_checks') return;
      if (str(action.sheetId) !== sheetId) return;
      const from = sheetNameOf(world, a.sheetId);
      const button = a.trigger.type === 'button_clicked';
      const fctx = flowCtx(world, a.sheetId, viewer);
      const buttonName =
        button && typeof a.trigger.fieldKey === 'string'
          ? (world.fields.find((f) => f.sheetId === a.sheetId && f.key === a.trigger.fieldKey)
              ?.name ?? 'a button')
          : '';
      steps.push({
        id: `${button ? 'button_in' : 'automation_in'}:${a.id}:${i}`,
        group: 'inputs',
        kind: button ? 'button_in' : 'automation_in',
        name: from,
        subline: button
          ? `Sheet · ${buttonName} button (${a.name})`
          : `Sheet · ${fctx ? describeTrigger(a.trigger, fctx) : 'an automation'} (${a.name})`,
        health: health(a),
        pack: autoPack(a),
        edit: { editor: 'automation', id: a.id, sheetId: a.sheetId },
        other: { sheetId: a.sheetId, name: from },
      });
    });
  }

  // link fields of other sheets pointing here, unless they are the other side of one of this sheet's two-way links
  const ownLinkIds = new Set(fields.filter(isLinkField).map((f) => f.id));
  const incoming = world.fields.filter(
    (f) =>
      f.sheetId !== sheetId &&
      isLinkField(f) &&
      targetOf(f) === sheetId &&
      !(inverseOf(f) && ownLinkIds.has(inverseOf(f)!)),
  );
  for (const f of incoming) {
    const from = sheetNameOf(world, f.sheetId);
    steps.push({
      id: `link_in:${f.id}`,
      group: 'inputs',
      kind: 'link_in',
      name: from,
      subline: `Sheet · links here through ${f.name}`,
      health: null,
      pack: packMarker(
        world,
        f.pack,
        `field:${f.id}`,
        !!world.sheets.find((s) => s.id === f.sheetId)?.pack,
      ),
      edit: { editor: 'field', id: f.id, sheetId: f.sheetId },
      other: { sheetId: f.sheetId, name: from },
    });
  }

  steps.push({
    id: `api:${sheetId}`,
    group: 'inputs',
    kind: 'api',
    name: 'API / webhook',
    subline: 'Items sent in from another system',
    health: null,
    pack: null,
    edit: null,
    comingLater: true,
  });

  // ── 02 sheet
  const outLinks = fields.filter(isLinkField);
  const relations = outLinks.length + incoming.length;
  steps.push({
    id: `sheet:${sheetId}`,
    group: 'sheet',
    kind: 'sheet',
    name: sheet.name,
    subline: `${plural(fields.length, 'column')} · ${plural(relations, 'relation')}`,
    health: null,
    pack: sheet.pack ? packMarker(world, sheet.pack, null, true) : null,
    edit: { editor: 'sheet', id: sheetId, sheetId },
  });

  // ── 03 logic
  for (const a of autos)
    steps.push({
      id: `automation:${a.id}`,
      group: 'logic',
      kind: 'automation',
      name: a.name,
      subline: describeTrigger(a.trigger, ctx),
      health: health(a),
      pack: autoPack(a),
      edit: { editor: 'automation', id: a.id, sheetId },
    });
  const workflows = readWorkflows({ workflows: sheet.workflows ?? [] });
  for (const w of workflows) {
    const problems = workflowProblems(w, fields);
    steps.push({
      id: `approval:${sheetId}:${w.id}`,
      group: 'logic',
      kind: 'approval',
      name: w.name,
      subline: `Approval workflow · ${plural(w.steps.length, 'step')}`,
      health: problems.length
        ? { tone: 'warn', words: plural(problems.length, 'problem'), problems }
        : w.enabled
          ? { tone: 'ok', words: 'On', problems: [] }
          : { tone: 'off', words: 'Off', problems: ['Off'] },
      pack: workflowPack(world, sheetId, w.id, sheet.pack),
      edit: { editor: 'approval', id: w.id, sheetId },
    });
  }
  // the lifecycle: the first status field, else the field the Workflow page opens first
  const stageChoices = stageFields(
    fields.filter((f) => !f.hidden),
    ctx,
  );
  const stage = (stageChoices.find((f) => f.type === 'status') ??
    stageChoices[0] ??
    null) as FlowField | null;
  if (stage) {
    const options = (stage.config as { options?: unknown[] } | null)?.options;
    steps.push({
      id: `lifecycle:${stage.id}`,
      group: 'logic',
      kind: 'lifecycle',
      name: `${stage.name} lifecycle`,
      subline: `Workflow · ${plural(Array.isArray(options) ? options.length : 0, 'stage')}`,
      health: null,
      pack: packMarker(world, stage.pack, `field:${stage.id}`, onPack),
      edit: { editor: 'lifecycle', id: stage.id, sheetId },
    });
  }

  // ── 04 outputs
  for (const f of outLinks) {
    const target = targetOf(f)!;
    const name = sheetNameOf(world, target);
    const readable = world.sheets.some((s) => s.id === target);
    steps.push({
      id: `link_out:${f.id}`,
      group: 'outputs',
      kind: 'link_out',
      name,
      subline: `Link · ${f.name}${inverseOf(f) ? ', both ways' : ''}`,
      health: null,
      pack: packMarker(world, f.pack, `field:${f.id}`, onPack),
      edit: { editor: 'field', id: f.id, sheetId },
      other: { sheetId: readable ? target : null, name },
    });
  }
  for (const a of autos)
    a.actions.forEach((action, i) => {
      const base = {
        health: health(a),
        pack: autoPack(a),
        edit: { editor: 'automation' as const, id: a.id, sheetId },
      };
      const target = actionTarget(action, a, world);
      if (action.type === 'create_item' || action.type === 'sync_requirement_checks') {
        const name = sheetNameOf(world, target);
        steps.push({
          ...base,
          id: `create_out:${a.id}:${i}`,
          group: 'outputs',
          kind: 'create_out',
          name,
          subline: `${action.type === 'create_item' ? 'Creates items' : 'Keeps requirement checks'} · ${a.name}`,
          other: { sheetId: world.sheets.some((s) => s.id === target) ? target : null, name },
        });
      } else if (action.type === 'update_linked') {
        const name = sheetNameOf(world, target);
        steps.push({
          ...base,
          id: `update_out:${a.id}:${i}`,
          group: 'outputs',
          kind: 'update_out',
          name,
          subline: `Updates linked items · ${a.name}`,
          other: { sheetId: world.sheets.some((s) => s.id === target) ? target : null, name },
        });
      } else if (NOTIFY.has(action.type)) {
        const who =
          action.type === 'notify'
            ? describeRecipients(action.to, ctx)
            : capitalise(describeAction(action, ctx));
        steps.push({
          ...base,
          id: `notify:${a.id}:${i}`,
          group: 'outputs',
          kind: 'notify',
          name: 'Notifications',
          subline: `${action.type === 'notify' ? `Notify ${who}` : who} · ${a.name}`,
        });
      } else if (action.type === 'webhook') {
        const leaves = webhookLeave(a, action, i, world, viewer);
        steps.push({
          ...base,
          id: `webhook:${a.id}:${i}`,
          group: 'outputs',
          kind: 'webhook',
          name: DESTINATION_LABEL[leaves.destination],
          subline: `Leaves the system · ${leaves.host} · ${a.name}`,
          leaves,
        });
      }
    });

  const groups = FLOW_GROUPS.map((id, i) => ({
    id,
    number: String(i + 1).padStart(2, '0'),
    title: FLOW_GROUP_TITLE[id],
    steps: steps.filter((s) => s.group === id),
  }));
  const count = (id: string) => steps.filter((s) => s.group === id && !s.comingLater).length;
  return {
    sheet,
    groups,
    counts: {
      inputs: count('inputs'),
      logic: count('logic'),
      outputs: count('outputs'),
      columns: fields.length,
      relations,
    },
    differs: steps.some((s) => s.pack?.state === 'changed' || s.pack?.state === 'added'),
  };
}

/** Every step of a flow in list order (what arrow keys walk through). */
export const flowSteps = (flow: SheetFlow): FlowStep[] => flow.groups.flatMap((g) => g.steps);
