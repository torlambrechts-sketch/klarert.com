// Turning a sheet template into rows (docs/07 Part B, the template's `importer` notes). Pure: ids, the clock and the
// people are injected, so the same plan is unit-tested here and written by src/server/templates/importer.ts.
// Order: sheets (fields without links) → link fields with inverses → groups → views → items → links → automations.
// Values go through each field type's `normalize`, as the commands do; nothing here runs automations or status rules.
import { planSubitems, type SubitemFieldSpec, type SubitemRows } from './subitems';
import { draftProblems } from '../automations/builder';
import { basicCtx } from '../context';
import { addDays } from '../fields/helpers';
import { fieldType } from '../fields/registry';
import { keysBetween } from '../ordering';
import { readSubitemSettings } from '../subitems';
import { STORED_VIEW_TYPE, type FormLayout } from '../views/config';
import { arrangeFields, type ColumnGroup } from '../views/column-groups';
import { resolveTemplateTabs, type SheetTab } from '../views/tabs';
import type {
  Automation,
  Condition,
  Ctx,
  Field,
  Group,
  Json,
  LabelColor,
  Person,
  Sheet,
  StatusRule,
} from '../types';
import { isFormRef, type SheetTemplate, type TemplateField, type TemplateForm } from './schema';

export interface PlanPerson extends Person {
  ref: string;
}

export interface PlanEnv {
  orgId: string;
  folderId: string | null;
  people: PlanPerson[];
  /** ISO date the relative tokens ($today, $in:N) count from. */
  today: string;
  now: Date;
  timeZone: string;
  /** A new uuid. */
  newId: () => string;
  /** Position of the workspace's last sheet; the template's sheets go after it. */
  lastSheetPosition: string | null;
  /** The workspace's job roles and teams: recipients name them (`jobRole:HSE manager`), automations store ids. */
  jobRoles?: { id: string; name: string }[];
  teams?: { id: string; name: string }[];
  /**
   * Packs (docs/11): people, job roles and teams the workspace does not have are warnings, not problems. Example
   * values naming them are left empty, and an automation naming them is installed off.
   */
  lenient?: boolean;
}

export interface PlannedSheet {
  ref: string;
  row: {
    id: string;
    org_id: string;
    folder_id: string | null;
    name: string;
    description: string | null;
    item_label: string;
    id_prefix: string;
    position: string;
    settings: {
      template: { id: string; version: number; ref: string };
      subitems?: SubitemRows['settings'];
      /** The template's starting tabs (docs/02 sheets.settings.tabs) and a copy for "Reset to template default". */
      tabs?: SheetTab[];
      tabsDefault?: SheetTab[];
      defaultViewId?: string;
      columnGroups?: ColumnGroup[];
    };
  };
  /** The sheet's sub-items (docs/02 §12): its child sheet, written after the parents. */
  subitems?: SubitemRows;
  groups: { id: string; org_id: string; sheet_id: string; name: string; color: string; position: string }[];
  fields: {
    id: string;
    org_id: string;
    sheet_id: string;
    key: string;
    name: string;
    type: string;
    position: string;
    width: number;
    required: boolean;
    locked: boolean;
    description: string | null;
    config: Json;
    rules: Json;
    visibility: Json | null;
  }[];
  views: {
    id: string;
    org_id: string;
    sheet_id: string;
    name: string;
    type: string;
    config: Json;
    position: string;
    owner_id: null;
  }[];
  /** Per group, in template order; values keyed by field id. `ref` is the item's stable ref, when it has one. */
  items: {
    groupId: string;
    rows: { name: string; position: string; values: Record<string, Json>; ref?: string }[];
  }[];
}

export interface PlannedLink {
  fieldId: string;
  /** The item by name, and by its ref when it has one. */
  from: { sheetRef: string; name: string; ref?: string };
  to: { sheetRef: string; name: string; ref?: string };
}

export interface ImportPlan {
  templateId: string;
  sheets: PlannedSheet[];
  /** Both directions of two-way links, so set_item_links writes each side. */
  links: PlannedLink[];
  automations: {
    org_id: string;
    sheet_id: string;
    name: string;
    enabled: boolean;
    trigger: Json;
    conditions: Json;
    actions: Json;
    source: string;
  }[];
  /** Values that do not fit their field and automations the builder would refuse. Empty for a good template. */
  problems: string[];
  /** Lenient plans only: people, job roles and teams left out (the values stay empty, the automations off). */
  warnings: string[];
}

const OPTION = /^\$option:(.+)$/;
const PERSON = /^\$person:(.+)$/;
const IN_DAYS = /^\$in:(-?\d{1,4})$/;
const ITEM = /^\$item:([a-z][a-z0-9_]*):(.+)$/;
const GROUP_RECIPIENT = /^(jobRole|team):(.+)$/;

type Obj = Record<string, Json>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** The template's source marker on automations and in sheets.settings (idempotent re-runs look for it). */
export const templateSource = (id: string) => `template:${id}`;

/** `$today` / `$in:N` in a field's config.default, in the words the default resolver reads (docs/03 §2). */
function defaultToken(raw: Json, people: Map<string, PlanPerson>): Json {
  if (typeof raw !== 'string') return raw;
  if (raw === '$today') return 'today';
  const days = raw.match(IN_DAYS);
  if (days && Number(days[1]) >= 0) return `in ${Number(days[1])} days`;
  const person = raw.match(PERSON);
  if (person) return people.get(person[1]!)?.id ?? null;
  return raw;
}

export function planTemplateImport(t: SheetTemplate, env: PlanEnv): ImportPlan {
  const problems: string[] = [];
  const warnings: string[] = [];
  const people = new Map(env.people.map((p) => [p.ref, p]));
  /** Lenient plans: `$person:` tokens of people the workspace does not have are dropped (and said once each). */
  const missingPeople = new Set<string>();
  const dropMissingPeople = (raw: Json): Json | undefined => {
    if (!env.lenient) return raw;
    if (typeof raw === 'string') {
      const m = raw.match(PERSON);
      if (m && !people.has(m[1]!)) {
        missingPeople.add(m[1]!);
        return undefined;
      }
      return raw;
    }
    if (Array.isArray(raw)) {
      const kept = raw.map(dropMissingPeople).filter((x): x is Json => x !== undefined);
      return kept.length === 0 && raw.length > 0 ? undefined : kept;
    }
    return raw;
  };
  const sheetIds = new Map(t.sheets.map((s) => [s.ref, env.newId()]));
  const fieldIds = new Map<string, string>(); // `${sheetRef}.${key}` → id
  for (const s of t.sheets) for (const f of s.fields) fieldIds.set(`${s.ref}.${f.key}`, env.newId());
  const groupIds = new Map<string, string>(); // `${sheetRef}.${groupRef}` → id
  const formIds = new Map<string, string>(); // `${sheetRef}.${formRef}` → view id
  for (const s of t.sheets) for (const g of s.groups) groupIds.set(`${s.ref}.${g.ref}`, env.newId());

  const sheetPositions = keysBetween(env.lastSheetPosition, null, t.sheets.length);

  // fields as the engine sees them, so values and automations are checked against the real configs
  const engineFields = new Map<string, Field[]>();
  const engineSheets = new Map<string, Sheet>();
  const engineGroups = new Map<string, Group[]>();

  const planned: PlannedSheet[] = t.sheets.map((s, si) => {
    const sheetId = sheetIds.get(s.ref)!;
    // column groups: each group's fields sit together, at its first field (docs/02 sheets.settings.columnGroups)
    const columnGroups: ColumnGroup[] = s.columnGroups.map((g) => ({
      id: env.newId(),
      name: g.name,
      fieldKeys: g.fields,
    }));
    const order = arrangeFields(
      s.fields.map((f, fi) => ({ id: f.key, key: f.key, position: String(fi).padStart(4, '0') })),
      columnGroups,
    ).map((f) => f.key);
    const slots = keysBetween(null, null, s.fields.length);
    const fieldPositions = s.fields.map((f) => slots[order.indexOf(f.key)]!);
    const groupPositions = keysBetween(null, null, s.groups.length);
    const viewPositions = keysBetween(null, null, s.views.length + s.forms.length);
    engineSheets.set(sheetId, {
      id: sheetId,
      orgId: env.orgId,
      name: s.name,
      itemLabel: s.itemLabel,
      idPrefix: s.idPrefix,
      isLibrary: false,
    });

    const fields = s.fields.map((f, fi) => {
      const def = fieldType(f.type)!;
      const config = fieldConfig(f, sheetIds, fieldIds, people);
      const check = def.configSchema.safeParse(config);
      if (!check.success)
        problems.push(`${s.name} › ${f.name}: settings do not fit a ${def.label} field.`);
      return {
        id: fieldIds.get(`${s.ref}.${f.key}`)!,
        org_id: env.orgId,
        sheet_id: sheetId,
        key: f.key,
        name: f.name,
        type: f.type,
        position: fieldPositions[fi]!,
        width: def.defaultWidth,
        required: f.required ?? false,
        locked: f.locked ?? false,
        description: f.description ?? null,
        config,
        rules: [] as Json,
        visibility: null as Json | null,
      };
    });
    engineFields.set(
      sheetId,
      fields.map((f) => ({
        id: f.id,
        sheetId,
        key: f.key,
        name: f.name,
        type: f.type,
        position: f.position,
        width: f.width,
        required: f.required,
        locked: f.locked,
        description: f.description,
        config: f.config,
        validation: {},
        rules: [],
        visibility: null,
      })),
    );

    const groups = s.groups.map((g, gi) => ({
      id: groupIds.get(`${s.ref}.${g.ref}`)!,
      org_id: env.orgId,
      sheet_id: sheetId,
      name: g.name,
      color: g.color,
      position: groupPositions[gi]!,
    }));
    engineGroups.set(
      sheetId,
      groups.map((g) => ({
        id: g.id,
        sheetId,
        name: g.name,
        color: g.color as LabelColor,
        position: g.position,
      })),
    );

    const views = s.views.map((v, vi) => ({
      id: env.newId(),
      org_id: env.orgId,
      sheet_id: sheetId,
      name: v.name,
      type: STORED_VIEW_TYPE[v.type],
      config: v.config as Json,
      position: viewPositions[vi]!,
      owner_id: null,
    }));
    // ready-made forms: drafts whose privacy notice still needs a review (docs/05 §3.3)
    for (const [fi, f] of s.forms.entries()) {
      const id = env.newId();
      formIds.set(`${s.ref}.${f.ref}`, id);
      views.push({
        id,
        org_id: env.orgId,
        sheet_id: sheetId,
        name: f.name,
        type: STORED_VIEW_TYPE.form,
        config: {
          filters: [],
          sort: [],
          hidden: [],
          form: templateFormLayout(f, f.groupRef ? (groupIds.get(`${s.ref}.${f.groupRef}`) ?? null) : null),
        } as unknown as Json,
        position: viewPositions[s.views.length + fi]!,
        owner_id: null,
      });
    }
    const settings: PlannedSheet['row']['settings'] = {
      template: { id: t.id, version: t.version, ref: s.ref },
      ...(columnGroups.length ? { columnGroups } : {}),
    };
    if (s.tabs) {
      // view names → the new views' ids (docs/02 sheets.settings.tabs)
      const tabs = resolveTemplateTabs(s.tabs, s.defaultView, views);
      problems.push(...tabs.problems.map((m) => `${s.name} › tabs: ${m}`));
      settings.tabs = tabs.tabs;
      settings.tabsDefault = tabs.tabs;
      if (tabs.defaultViewId) settings.defaultViewId = tabs.defaultViewId;
    }

    return {
      ref: s.ref,
      row: {
        id: sheetId,
        org_id: env.orgId,
        folder_id: env.folderId,
        name: s.name,
        description: s.description ?? null,
        item_label: s.itemLabel,
        id_prefix: s.idPrefix,
        position: sheetPositions[si]!,
        settings,
      },
      groups,
      fields,
      views,
      items: [],
      ...(s.subitems
        ? (() => {
            const rows = planSubitems(
              { ...s.subitems, fields: s.subitems.fields as SubitemFieldSpec[] },
              {
                orgId: env.orgId,
                parent: {
                  id: sheetId,
                  name: s.name,
                  folderId: env.folderId,
                  position: sheetPositions[si]!,
                  holdAutomations: true,
                },
                parentFields: fields,
                newId: env.newId,
              },
            );
            fields.push({
              ...rows.parentField,
              org_id: env.orgId,
              sheet_id: sheetId,
              required: false,
              locked: false,
              description: null,
              rules: [],
              visibility: null,
            });
            return { subitems: rows };
          })()
        : {}),
    };
  });

  for (const p of planned) if (p.subitems) p.row.settings.subitems = p.subitems.settings;

  // sub-item sheets as the engine sees them: automations on sub-items (`subitems: true`) are checked against them
  const subSheetIds = new Map<string, string>(); // parent sheet ref → child sheet id
  for (const p of planned) {
    const sub = p.subitems;
    if (!sub) continue;
    const childId = sub.sheet.id;
    subSheetIds.set(p.ref, childId);
    // the parent knows its child and its template set, so automations on the parent may add sub-items
    const parent = engineSheets.get(p.row.id);
    if (parent)
      engineSheets.set(p.row.id, {
        ...parent,
        childSheetId: childId,
        subitems: readSubitemSettings(sub.settings),
      });
    engineSheets.set(childId, {
      id: childId,
      orgId: env.orgId,
      name: sub.sheet.name,
      itemLabel: sub.sheet.item_label,
      idPrefix: '',
      isLibrary: false,
      parentSheetId: p.row.id,
    } as Sheet);
    engineFields.set(
      childId,
      sub.fields.map((f) => ({
        id: f.id,
        sheetId: childId,
        key: f.key,
        name: f.name,
        type: f.type,
        position: f.position,
        width: f.width,
        required: false,
        locked: false,
        description: null,
        config: f.config,
        validation: {},
        rules: f.rules as unknown as StatusRule[],
        visibility: null,
      })),
    );
    engineGroups.set(childId, [
      {
        id: sub.group.id,
        sheetId: childId,
        name: sub.group.name,
        color: sub.group.color as LabelColor,
        position: sub.group.position,
      },
    ]);
  }

  const ctxFor = (sheetRef: string): Ctx => ctxForId(sheetIds.get(sheetRef)!);
  const ctxForId = (sheetId: string): Ctx => {
    const ctx = basicCtx({
      today: env.today,
      now: env.now,
      timeZone: env.timeZone,
      userId: env.people[0]?.id ?? '',
      sheet: engineSheets.get(sheetId)!,
      people: env.people,
      newId: (prefix) => `${prefix}${env.newId().slice(0, 8)}`,
    });
    return {
      ...ctx,
      fieldsByKey: new Map((engineFields.get(sheetId) ?? []).map((f) => [f.key, f])),
      fieldsOf: (id) => engineFields.get(id) ?? [],
      groups: new Map((engineGroups.get(sheetId) ?? []).map((g) => [g.id, g])),
    };
  };

  /** `$option:<label>` on a label field → the option id. */
  const option = (field: Field | undefined, raw: Json, ctx: Ctx, where: string): Json => {
    if (typeof raw !== 'string') return raw;
    const m = raw.match(OPTION);
    if (!m) return raw;
    const def = field && fieldType(field.type);
    const found = def?.options
      ?.(field!.config, ctx)
      .find((o) => o.label.toLowerCase() === m[1]!.toLowerCase());
    if (!found) problems.push(`${where}: no option "${m[1]}".`);
    return found?.id ?? null;
  };

  /** Item value tokens: $person:, $option:, $today, $in:N. */
  const itemValue = (field: Field, raw: Json, ctx: Ctx, where: string): Json => {
    if (Array.isArray(raw)) return raw.map((x) => itemValue(field, x, ctx, where));
    if (isObj(raw))
      return Object.fromEntries(
        Object.entries(raw).map(([k, v]) => [k, itemValue(field, v, ctx, where)]),
      );
    if (typeof raw !== 'string') return raw;
    if (raw === '$today') return env.today;
    const days = raw.match(IN_DAYS);
    if (days) return addDays(env.today, Number(days[1]));
    const person = raw.match(PERSON);
    if (person) return people.get(person[1]!)?.id ?? null;
    return option(field, raw, ctx, where);
  };

  // status rules and visibility name option ids or $option: tokens on their own field
  for (const [si, s] of t.sheets.entries()) {
    const ctx = ctxFor(s.ref);
    for (const [fi, f] of s.fields.entries()) {
      const row = planned[si]!.fields[fi]!;
      const rules: StatusRule[] = (f.rules ?? []).map((r) => ({
        ...r,
        whenValues: r.whenValues.map((v) =>
          option(ctx.fieldsByKey.get(r.whenFieldKey), v, ctx, `${s.name} › ${f.name} rule`),
        ),
      }));
      row.rules = rules as unknown as Json;
      if (f.visibility) {
        const vis: Condition = {
          ...f.visibility,
          value:
            f.visibility.value === undefined
              ? undefined
              : resolveDeep(f.visibility.value, (v) =>
                  option(ctx.fieldsByKey.get(f.visibility!.fieldKey), v, ctx, `${s.name} › ${f.name}`),
                ),
        };
        row.visibility = vis as unknown as Json;
      }
      const e = engineFields.get(row.sheet_id)!.find((x) => x.id === row.id)!;
      e.rules = rules;
      e.visibility = (row.visibility ?? null) as Condition | null;
    }
  }

  // items, values normalised by their field type
  for (const [si, s] of t.sheets.entries()) {
    const ctx = ctxFor(s.ref);
    const byGroup = new Map<string, { name: string; values: Record<string, Json> }[]>();
    for (const item of s.items) {
      const values: Record<string, Json> = {};
      for (const [key, given] of Object.entries(item.values)) {
        const raw = dropMissingPeople(given);
        if (raw === undefined) continue;
        const field = ctx.fieldsByKey.get(key)!;
        const def = fieldType(field.type)!;
        const where = `${s.name} › ${item.name} › ${field.name}`;
        if (def.storage !== 'values') {
          problems.push(`${where}: this field is not set through values.`);
          continue;
        }
        const v = def.normalize(itemValue(field, raw, ctx, where), field.config, ctx);
        if (v === null || v === undefined || def.isEmpty(v)) {
          problems.push(`${where}: not a valid ${def.label.toLowerCase()}.`);
          continue;
        }
        values[field.id] = v as Json;
      }
      const groupId = groupIds.get(`${s.ref}.${item.group}`)!;
      byGroup.set(groupId, [
        ...(byGroup.get(groupId) ?? []),
        { name: item.name, values, ...(item.ref ? { ref: item.ref } : {}) },
      ]);
    }
    planned[si]!.items = [...byGroup].map(([groupId, rows]) => {
      const keys = keysBetween(null, null, rows.length);
      return { groupId, rows: rows.map((r, i) => ({ ...r, position: keys[i]! })) };
    });
  }

  // links, mirrored onto the inverse field
  const links: PlannedLink[] = [];
  const seen = new Set<string>();
  /** A link token's item: by ref first, then by name. */
  const linkEnd = (sheetRef: string, x: string): PlannedLink['to'] => {
    const items = t.sheets.find((s) => s.ref === sheetRef)?.items ?? [];
    const hit = items.find((i) => i.ref === x) ?? items.find((i) => i.name === x);
    return { sheetRef, name: hit?.name ?? x, ...(hit?.ref ? { ref: hit.ref } : {}) };
  };
  const addLink = (l: PlannedLink) => {
    const k = `${l.fieldId}|${l.from.sheetRef}|${l.from.name}|${l.to.sheetRef}|${l.to.name}`;
    if (seen.has(k)) return;
    seen.add(k);
    links.push(l);
  };
  for (const s of t.sheets)
    for (const item of s.items)
      for (const [key, tokens] of Object.entries(item.links ?? {})) {
        const f = s.fields.find((x) => x.key === key)!;
        const cfg = (f.config ?? {}) as Obj;
        for (const token of tokens) {
          const m = token.match(ITEM)!;
          const to = linkEnd(m[1]!, m[2]!);
          const from = { sheetRef: s.ref, name: item.name, ...(item.ref ? { ref: item.ref } : {}) };
          addLink({ fieldId: fieldIds.get(`${s.ref}.${key}`)!, from, to });
          if (typeof cfg.inverseKey === 'string')
            addLink({
              fieldId: fieldIds.get(`${to.sheetRef}.${cfg.inverseKey}`)!,
              from: to,
              to: from,
            });
        }
      }

  /** `jobRole:<name>` / `team:<name>` → the same with the workspace's id (an id already given is kept). */
  const recipient = (kind: 'jobRole' | 'team', ref: string, where: string): Json => {
    const list = (kind === 'jobRole' ? env.jobRoles : env.teams) ?? [];
    const hit = list.find((x) => x.id === ref || x.name.toLowerCase() === ref.toLowerCase());
    if (!hit) {
      const message = `${where}: no ${kind === 'jobRole' ? 'job role' : 'team'} "${ref}" in the workspace.`;
      if (env.lenient) {
        degraded.add(where);
        warnings.push(message);
        return null;
      }
      problems.push(message);
      return `${kind}:${ref}`;
    }
    return `${kind}:${hit.id}`;
  };

  // automations: refs to ids, $option: to option ids, $person: to user ids, job roles and teams by name to ids;
  // then the builder's own checks. Lenient plans leave out who is missing and install that automation off.
  const degraded = new Set<string>();
  const automations = t.automations.map((a) => {
    const where = `Automation "${a.name}"`;
    // on sub-items: the hidden child sheet of `sheet` (docs/02 §12); a sheet without sub-items is the schema's problem
    const sheetId = a.subitems
      ? (subSheetIds.get(a.sheet) ?? sheetIds.get(a.sheet)!)
      : sheetIds.get(a.sheet)!;
    if (a.subitems && !subSheetIds.has(a.sheet)) problems.push(`${where}: "${a.sheet}" has no sub-items.`);
    const ctx = ctxForId(sheetId);
    const resolve = (o: Obj): Obj => {
      const fctx = ctx;
      const field =
        typeof o.fieldKey === 'string' ? fctx.fieldsByKey.get(o.fieldKey) : undefined;
      const out: Obj = {};
      for (const [k, v] of Object.entries(o)) {
        if (k === 'sheetRef' && typeof v === 'string') out.sheetId = sheetIds.get(v) ?? null;
        else if (k === 'formId' && isFormRef(v)) out.formId = formIds.get(`${a.sheet}.${v}`) ?? null;
        else if (k === 'groupRef' && typeof v === 'string') {
          const groupSheet = typeof o.sheetRef === 'string' ? o.sheetRef : a.sheet;
          out.groupId = groupIds.get(`${groupSheet}.${v}`) ?? null;
        } else
          out[k] = resolveDeep(v, (x) => {
            if (typeof x !== 'string') return x;
            const person = x.match(PERSON);
            if (person) {
              const id = people.get(person[1]!)?.id ?? null;
              if (!id && env.lenient) {
                degraded.add(where);
                warnings.push(`${where}: "${person[1]}" is not in the workspace.`);
              }
              return id;
            }
            const group = k === 'to' ? x.match(GROUP_RECIPIENT) : null;
            if (group) return recipient(group[1] as 'jobRole' | 'team', group[2]!, where);
            return OPTION.test(x) ? option(field, x, fctx, where) : x;
          });
        // recipients left out (lenient plans) are dropped from the list
        if (env.lenient && k === 'to' && Array.isArray(out[k])) out[k] = (out[k] as Json[]).filter((x) => x !== null);
      }
      return out;
    };
    const trigger = resolve(a.trigger as Obj) as Automation['trigger'];
    const conditions = a.conditions.map((c) => resolve(c as Obj)) as unknown as Condition[];
    const actions = a.actions.map((x) => resolve(x as Obj)) as Automation['actions'];
    const found = draftProblems({ name: a.name, trigger, conditions, actions }, ctx, {
      sheetIds: [...sheetIds.values()],
    });
    // lenient plans: an automation that lost someone it names stays on unless the builder would now refuse it
    const off = degraded.has(where) && Object.keys(found).length > 0;
    for (const [at, message] of Object.entries(found))
      (off ? warnings : problems).push(`${where} › ${at}: ${message}`);
    if (off && a.enabled) warnings.push(`${where} is installed off. Turn it on once it has someone to tell.`);
    return {
      org_id: env.orgId,
      sheet_id: sheetId,
      name: a.name,
      enabled: a.enabled && !off,
      trigger: trigger as unknown as Json,
      conditions: conditions as unknown as Json,
      actions: actions as unknown as Json,
      source: templateSource(t.id),
    };
  });

  for (const ref of missingPeople)
    warnings.push(`Example values naming "${ref}" are left empty: no such person in the workspace.`);
  return { templateId: t.id, sheets: planned, links, automations, problems, warnings };
}

function resolveDeep(v: Json, leaf: (x: Json) => Json): Json {
  if (Array.isArray(v)) return v.map((x) => resolveDeep(x, leaf));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveDeep(x, leaf)]));
  return leaf(v);
}

/** The stored config: type defaults, the template's settings, refs → ids, default tokens → default words. */
function fieldConfig(
  f: TemplateField,
  sheetIds: Map<string, string>,
  fieldIds: Map<string, string>,
  people: Map<string, PlanPerson>,
): Json {
  const def = fieldType(f.type)!;
  const out: Obj = { ...(def.defaultConfig() as Obj), ...((f.config ?? {}) as Obj) };
  if (typeof out.targetSheetRef === 'string') {
    const target = out.targetSheetRef;
    out.targetSheetId = sheetIds.get(target) ?? '';
    out.inverseFieldId =
      typeof out.inverseKey === 'string' ? (fieldIds.get(`${target}.${out.inverseKey}`) ?? null) : null;
    delete out.targetSheetRef;
    delete out.inverseKey;
  }
  if ('default' in out) out.default = defaultToken(out.default!, people);
  return out;
}

/** A template's form as stored in views.config.form: a draft, the notice at version 1 and not reviewed. */
export function templateFormLayout(f: TemplateForm, groupId: string | null): FormLayout {
  return {
    ...f.layout,
    status: 'draft',
    access: f.access,
    ...(groupId ? { groupId } : {}),
    ...(f.settings?.confirmation ? { confirmation: f.settings.confirmation } : {}),
    ...(f.settings?.maxResponses ? { maxResponses: f.settings.maxResponses } : {}),
    ...(f.settings?.prefill?.length ? { prefill: f.settings.prefill } : {}),
    ...(f.notice ? { notice: { ...f.notice, version: 1 } } : {}),
  };
}
