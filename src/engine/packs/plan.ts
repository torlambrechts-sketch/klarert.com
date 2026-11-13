// The pack install planner (docs/11, docs/02 §15). Pure: the manifest and a snapshot of the workspace in, the
// operations (create / reuse / skip / conflict), a preview people read and the rows install_pack writes out. The clock
// and ids are injected. Sheet-level work (fields, groups, views, forms, tabs, column groups, sub-items, values,
// automations) is the template planner's (planTemplateImport); this file adds what a pack has on top: folders by ref,
// stable refs on every row, ID prefixes renamed when the workspace already uses them, items and links by ref,
// dashboards, libraries and documents registers, and the checks that an install can go ahead.
import { describeAutomation } from '../automations/builder';
import { basicCtx } from '../context';
import { widgetProblem } from '../dashboards/registry';
import type { WidgetConfig } from '../dashboards/types';
import { keysBetween } from '../ordering';
import { uniqueIdPrefix } from '../ordering';
import { planTemplateImport, type PlanPerson } from '../templates/plan';
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
} from '../types';
import { satisfies } from './semver';
import { foreignLinks, packToTemplate } from './template';
import type { PackManifest } from './types';

export interface PackSnapshot {
  orgId: string;
  /** ID prefixes in use (every sheet, archived ones too: the prefix stays unique). */
  prefixes: string[];
  folders: { id: string; name: string; archived: boolean }[];
  installs: { id: string; packKey: string; version: string; status: 'installed' | 'archived' }[];
  members: (Person & { email: string })[];
  jobRoles: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  lastSheetPosition: string | null;
  lastFolderPosition: string | null;
  lastDashboardPosition: string | null;
}

export interface PackEnv {
  /** ISO date in the workspace time zone ($today, $in:N). */
  today: string;
  now: Date;
  timeZone: string;
  newId: () => string;
  /** The catalogue hash of the manifest (packs.hash). */
  hash: string;
  /** Who installs (example values and sentences only). */
  userId: string;
}

export type PackObjectKind =
  | 'folder'
  | 'sheet'
  | 'field'
  | 'group'
  | 'view'
  | 'form'
  | 'item'
  | 'link'
  | 'automation'
  | 'dashboard'
  | 'pack';

export interface PackOperation {
  kind: PackObjectKind;
  ref: string;
  name: string;
  action: 'create' | 'reuse' | 'skip' | 'conflict';
  note?: string;
}

type Row = Record<string, Json>;

/** The rows install_pack writes (p_plan). Ids are new uuids; every row has its stable ref. */
export interface InstallPayload {
  pack: { key: string; version: string; hash: string };
  folders: Row[];
  sheets: Row[];
  fields: Row[];
  groups: Row[];
  views: Row[];
  items: Row[];
  links: { field_id: string; from_item: string; to_item: string }[];
  automations: Row[];
  dashboards: Row[];
}

export interface PackCounts {
  folders: number;
  sheets: number;
  fields: number;
  views: number;
  forms: number;
  items: number;
  documents: number;
  libraryItems: number;
  links: number;
  automations: number;
  dashboards: number;
}

export interface PackPreview {
  key: string;
  title: string;
  version: string;
  description: string;
  state: 'ready' | 'installed' | 'blocked';
  counts: PackCounts;
  folders: { name: string; action: 'create' | 'reuse'; restricted?: boolean }[];
  sheets: {
    ref: string;
    name: string;
    prefix: string;
    renamedFrom?: string;
    fields: number;
    items: number;
    kind: 'sheet' | 'library' | 'documents';
    folder: string | null;
    subitems?: string;
    /** Restricted at install: the installer (and owners) see it until people are given access. */
    restricted?: boolean;
  }[];
  links: { from: string; field: string; to: string; twoWay: boolean }[];
  automations: { name: string; sheet: string; sentence: string; enabled: boolean }[];
  forms: { sheet: string; name: string; access: string }[];
  dashboards: { name: string; widgets: number }[];
  renamedPrefixes: { sheet: string; from: string; to: string }[];
  /** Why the pack cannot be installed (state blocked). */
  conflicts: string[];
  /** What installs differently than written: people, job roles or teams the workspace does not have. */
  warnings: string[];
}

export interface PackPlan {
  state: PackPreview['state'];
  operations: PackOperation[];
  preview: PackPreview;
  /** Null unless the state is ready. */
  payload: InstallPayload | null;
}

const lower = (s: string) => s.trim().toLowerCase();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a manifest holds, without a workspace (catalogue cards). */
export function manifestCounts(m: PackManifest): PackCounts {
  const items = (kind: 'sheet' | 'library' | 'documents') =>
    m.sheets.filter((s) => sheetKind(s) === kind).reduce((n, s) => n + s.items.length, 0);
  return {
    folders: m.folders.length,
    sheets: m.sheets.length,
    fields: m.sheets.reduce((n, s) => n + s.fields.length, 0),
    views: m.sheets.reduce((n, s) => n + s.views.length, 0),
    forms: m.sheets.reduce((n, s) => n + s.forms.length, 0),
    items: items('sheet'),
    documents: items('documents'),
    libraryItems: items('library'),
    links: m.sheets.reduce(
      (n, s) => n + s.items.reduce((k, i) => k + Object.values(i.links ?? {}).flat().length, 0),
      0,
    ),
    automations: m.automations.length,
    dashboards: m.dashboards.length,
  };
}

const sheetKind = (s: PackManifest['sheets'][number]): 'sheet' | 'library' | 'documents' =>
  s.register === 'documents' ? 'documents' : s.isLibrary ? 'library' : 'sheet';

/** "3 sheets, 41 fields, 9 automations, 2 forms and 1 dashboard": the counts that are not zero. */
export function countsText(c: PackCounts): string {
  const parts = [
    c.folders && plural(c.folders, 'folder'),
    c.sheets && plural(c.sheets, 'sheet'),
    c.fields && plural(c.fields, 'field'),
    c.views && plural(c.views, 'view'),
    c.forms && plural(c.forms, 'form'),
    c.items && plural(c.items, 'example item'),
    c.documents && plural(c.documents, 'document'),
    c.libraryItems && plural(c.libraryItems, 'library item'),
    c.links && plural(c.links, 'link'),
    c.automations && plural(c.automations, 'automation'),
    c.dashboards && plural(c.dashboards, 'dashboard'),
  ].filter((x): x is string => !!x);
  if (parts.length <= 1) return parts[0] ?? 'nothing';
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** The preview as lines of plain text (the dialog's summary, logs and tests). */
export function previewLines(p: PackPreview): string[] {
  const out: string[] = [];
  if (p.state === 'installed')
    out.push(`${p.title} ${p.version} is already installed. Nothing to do.`);
  else if (p.state === 'blocked')
    out.push(`${p.title} ${p.version} cannot be installed.`, ...p.conflicts);
  else out.push(`Installs ${countsText(p.counts)}.`);
  for (const f of p.folders)
    out.push(
      f.action === 'create'
        ? `New folder ${f.name}${f.restricted ? ' (restricted: only you and the owners see it until you share it)' : ''}.`
        : `Uses the folder ${f.name}.`,
    );
  for (const s of p.sheets)
    out.push(
      `${s.name} (${s.prefix}): ${plural(s.fields, 'field')}${s.items ? `, ${plural(s.items, s.kind === 'documents' ? 'document' : s.kind === 'library' ? 'library item' : 'example item')}` : ''}${s.subitems ? `, sub-items "${s.subitems}"` : ''}${s.restricted ? ', restricted' : ''}.`,
    );
  for (const l of p.links)
    out.push(`${l.from} links to ${l.to} through ${l.field}${l.twoWay ? ', both ways' : ''}.`);
  for (const r of p.renamedPrefixes)
    out.push(`${r.sheet} uses the prefix ${r.to}: ${r.from} is taken in this workspace.`);
  for (const a of p.automations) out.push(`${a.sheet}: ${a.sentence}${a.enabled ? '' : ' (off)'}`);
  for (const f of p.forms) out.push(`${f.sheet}: form ${f.name} (${f.access}, draft).`);
  for (const d of p.dashboards)
    out.push(`Dashboard ${d.name} with ${plural(d.widgets, 'widget')}.`);
  out.push(...p.warnings);
  return out;
}

export function planPackInstall(m: PackManifest, snap: PackSnapshot, env: PackEnv): PackPlan {
  const conflicts: string[] = [];
  const operations: PackOperation[] = [];
  const base: Omit<PackPreview, 'state' | 'conflicts' | 'warnings'> = {
    key: m.key,
    title: m.title,
    version: m.version,
    description: m.description,
    counts: manifestCounts(m),
    folders: [],
    sheets: [],
    links: [],
    automations: [],
    forms: [],
    dashboards: [],
    renamedPrefixes: [],
  };

  // ── already installed, or something this pack needs is missing
  const live = snap.installs.find((i) => i.packKey === m.key && i.status === 'installed');
  if (live && live.version === m.version) {
    const skip = (kind: PackObjectKind, ref: string, name: string) =>
      operations.push({ kind, ref, name, action: 'skip', note: 'Already installed.' });
    for (const f of m.folders) skip('folder', f.ref, f.name);
    for (const s of m.sheets) skip('sheet', s.ref, s.name);
    for (const a of m.automations) skip('automation', a.ref, a.name);
    for (const d of m.dashboards) skip('dashboard', d.ref, d.name);
    const preview = {
      ...base,
      state: 'installed' as const,
      sheets: m.sheets.map((s) => ({
        ref: s.ref,
        name: s.name,
        prefix: s.idPrefix,
        fields: s.fields.length,
        items: s.items.length,
        kind: sheetKind(s),
        folder: m.folders.find((f) => f.ref === s.folder)?.name ?? null,
      })),
      conflicts: [],
      warnings: [],
    };
    return { state: 'installed', operations, preview, payload: null };
  }
  if (live)
    conflicts.push(
      `Version ${live.version} is installed. Upgrading to ${m.version} is not available yet: archive the installed version first.`,
    );
  for (const r of m.requires) {
    const dep = snap.installs.find((i) => i.packKey === r.pack && i.status === 'installed');
    if (!dep) conflicts.push(`Install the pack "${r.pack}" (${r.range}) first.`);
    else if (!satisfies(dep.version, r.range))
      conflicts.push(`The pack "${r.pack}" is at ${dep.version}; this pack needs ${r.range}.`);
  }
  for (const l of foreignLinks(m))
    conflicts.push(
      `${m.sheets.find((s) => s.ref === l.sheet)?.name ?? l.sheet} › ${l.fieldKey} links to "${l.pack}:${l.ref}". Links to another pack's sheets are not available yet.`,
    );
  for (const c of conflicts)
    operations.push({ kind: 'pack', ref: m.key, name: m.title, action: 'conflict', note: c });

  // ── ID prefixes: renamed with a number when the workspace already uses them
  const taken = new Set(snap.prefixes);
  const prefixes: Record<string, string> = {};
  for (const s of m.sheets) {
    const p = uniqueIdPrefix(s.idPrefix, taken);
    taken.add(p);
    prefixes[s.ref] = p;
    if (p !== s.idPrefix) base.renamedPrefixes.push({ sheet: s.name, from: s.idPrefix, to: p });
  }

  // ── folders by ref: an active folder with the same name is used, otherwise the pack makes one
  const folderIds = new Map<string, string>();
  const folderRows: Row[] = [];
  const folderKeys = keysBetween(snap.lastFolderPosition, null, Math.max(1, m.folders.length));
  m.folders.forEach((f, i) => {
    const existing = snap.folders.find((x) => !x.archived && lower(x.name) === lower(f.name));
    if (existing) {
      folderIds.set(f.ref, existing.id);
      base.folders.push({ name: existing.name, action: 'reuse' });
      operations.push({
        kind: 'folder',
        ref: f.ref,
        name: f.name,
        action: 'reuse',
        note: 'A folder with this name exists.',
      });
      return;
    }
    const id = env.newId();
    folderIds.set(f.ref, id);
    folderRows.push({
      id,
      ref: f.ref,
      name: f.name,
      position: folderKeys[i]!,
      ...(f.restricted ? { restricted: true } : {}),
    });
    base.folders.push({
      name: f.name,
      action: 'create',
      ...(f.restricted ? { restricted: true } : {}),
    });
    operations.push({ kind: 'folder', ref: f.ref, name: f.name, action: 'create' });
  });

  // ── the sheets through the template planner (lenient: missing people, roles and teams are warnings)
  const byEmail = new Map(snap.members.map((p) => [lower(p.email), p]));
  const people: PlanPerson[] = m.people.flatMap((p) => {
    const hit = byEmail.get(lower(p.email));
    return hit ? [{ ...hit, ref: p.ref }] : [];
  });
  const t = packToTemplate(m, prefixes);
  const tp = planTemplateImport(t, {
    orgId: snap.orgId,
    folderId: null,
    people,
    today: env.today,
    now: env.now,
    timeZone: env.timeZone,
    newId: env.newId,
    lastSheetPosition: snap.lastSheetPosition,
    jobRoles: snap.jobRoles,
    teams: snap.teams,
    lenient: true,
  });
  conflicts.push(...tp.problems);

  const sheetRows: Row[] = [];
  const fieldRows: Row[] = [];
  const groupRows: Row[] = [];
  const viewRows: Row[] = [];
  const itemRows: Row[] = [];
  const sheetName = new Map<string, string>(); // id → name
  const engineFields = new Map<string, Field[]>(); // sheet id → fields
  const engineGroups = new Map<string, Group[]>();
  const sheetIdOf = new Map<string, string>(); // ref → id
  const itemIds = new Map<string, string>(); // `${sheetRef}.${itemRef}` → id

  tp.sheets.forEach((ps, si) => {
    const ms = m.sheets[si]!;
    const folderId = ms.folder ? (folderIds.get(ms.folder) ?? null) : null;
    const sheetId = ps.row.id;
    sheetIdOf.set(ms.ref, sheetId);
    sheetName.set(sheetId, ms.name);
    const settings = {
      ...ps.row.settings,
      ...(ms.register ? { register: ms.register } : {}),
    } as unknown as Row;
    sheetRows.push({
      ...(ps.row as unknown as Row),
      ref: ms.ref,
      folder_id: folderId,
      is_library: ms.isLibrary,
      settings,
      parent_sheet_id: null,
      ...(ms.restricted ? { restricted: true } : {}),
    });
    operations.push({ kind: 'sheet', ref: ms.ref, name: ms.name, action: 'create' });
    for (const f of ps.fields) {
      const ref = `${ms.ref}.${f.key}`;
      fieldRows.push({ ...(f as unknown as Row), ref });
      operations.push({ kind: 'field', ref, name: `${ms.name} › ${f.name}`, action: 'create' });
    }
    engineFields.set(
      sheetId,
      ps.fields.map((f) => ({
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
        rules: f.rules as unknown as Field['rules'],
        visibility: f.visibility as unknown as Condition | null,
      })),
    );
    ps.groups.forEach((g, gi) => {
      const ref = `${ms.ref}.${ms.groups[gi]!.ref}`;
      groupRows.push({ ...(g as unknown as Row), ref });
      operations.push({ kind: 'group', ref, name: `${ms.name} › ${g.name}`, action: 'create' });
    });
    engineGroups.set(
      sheetId,
      ps.groups.map((g) => ({
        id: g.id,
        sheetId,
        name: g.name,
        color: g.color as LabelColor,
        position: g.position,
      })),
    );
    ps.views.forEach((v, vi) => {
      const form = vi >= ms.views.length ? ms.forms[vi - ms.views.length] : undefined;
      const ref = form ? `${ms.ref}.form.${form.ref}` : `${ms.ref}.view.${vi + 1}`;
      viewRows.push({ ...(v as unknown as Row), ref });
      operations.push({
        kind: form ? 'form' : 'view',
        ref,
        name: `${ms.name} › ${v.name}`,
        action: 'create',
      });
      if (form) base.forms.push({ sheet: ms.name, name: form.name, access: form.access });
    });
    // sub-items: the hidden child sheet, its group and fields (docs/02 §12)
    if (ps.subitems) {
      const sub = ps.subitems;
      const childRef = `${ms.ref}.subitems`;
      sheetRows.push({
        ...(sub.sheet as unknown as Row),
        ref: childRef,
        folder_id: folderId,
        is_library: false,
      });
      groupRows.push({
        ...(sub.group as unknown as Row),
        ref: `${childRef}.group`,
        sheet_id: sub.sheet.id,
      });
      for (const f of sub.fields)
        fieldRows.push({
          ...(f as unknown as Row),
          ref: `${childRef}.${f.key}`,
          sheet_id: sub.sheet.id,
          required: false,
          locked: false,
          description: null,
          visibility: null,
        });
      operations.push({
        kind: 'sheet',
        ref: childRef,
        name: `${ms.name} › ${sub.label}`,
        action: 'create',
      });
    }
    // items with their refs (examples, documents of a register, library items)
    for (const g of ps.items)
      for (const r of g.rows) {
        const id = env.newId();
        const ref = `${ms.ref}.${r.ref}`;
        itemIds.set(ref, id);
        itemRows.push({
          id,
          ref,
          sheet_id: sheetId,
          group_id: g.groupId,
          name: r.name,
          position: r.position,
          values: r.values,
        });
        operations.push({ kind: 'item', ref, name: `${ms.name} › ${r.name}`, action: 'create' });
      }
    base.sheets.push({
      ref: ms.ref,
      name: ms.name,
      prefix: prefixes[ms.ref]!,
      ...(prefixes[ms.ref] !== ms.idPrefix ? { renamedFrom: ms.idPrefix } : {}),
      fields: ms.fields.length,
      items: ms.items.length,
      kind: sheetKind(ms),
      folder: ms.folder ? (m.folders.find((f) => f.ref === ms.folder)?.name ?? null) : null,
      ...(ps.subitems ? { subitems: ps.subitems.label } : {}),
      ...(ms.restricted ? { restricted: true } : {}),
    });
  });

  // a new document cannot start Approved (docs/02 §14): say so here rather than fail in the database
  for (const ms of m.sheets.filter((s) => s.register === 'documents'))
    for (const i of ms.items) {
      const status = ms.fields.find((f) => f.type === 'status');
      const v = status ? i.values[status.key] : undefined;
      const opts = ((status?.config as Row | undefined)?.options ?? []) as {
        id?: string;
        done?: boolean;
      }[];
      if (typeof v === 'string' && opts.some((o) => o.id === v && o.done))
        conflicts.push(`${ms.name} › ${i.name}: a document starts as a draft.`);
    }

  // ── links between the pack's sheets (preview) and between its items (rows)
  for (const ms of m.sheets)
    for (const f of ms.fields) {
      const cfg = (f.config ?? {}) as Row;
      const target =
        typeof cfg.targetSheetRef === 'string'
          ? m.sheets.find(
              (s) => s.ref === cfg.targetSheetRef || `${m.key}:${s.ref}` === cfg.targetSheetRef,
            )
          : undefined;
      if (!target) continue;
      // a two-way pair is shown once, from the sheet that comes first
      if (typeof cfg.inverseKey === 'string' && m.sheets.indexOf(target) < m.sheets.indexOf(ms))
        continue;
      base.links.push({
        from: ms.name,
        field: f.name,
        to: target.name,
        twoWay: typeof cfg.inverseKey === 'string',
      });
    }
  const linkRows: InstallPayload['links'] = [];
  for (const l of tp.links) {
    const from = l.from.ref && itemIds.get(`${l.from.sheetRef}.${l.from.ref}`);
    const to = l.to.ref && itemIds.get(`${l.to.sheetRef}.${l.to.ref}`);
    if (!from || !to) {
      conflicts.push(`Link ${l.from.name} → ${l.to.name}: an item has no ref.`);
      continue;
    }
    linkRows.push({ field_id: l.fieldId, from_item: from, to_item: to });
  }
  if (linkRows.length)
    operations.push({
      kind: 'link',
      ref: 'links',
      name: plural(linkRows.length, 'link'),
      action: 'create',
    });

  // ── a Ctx per sheet for sentences and widget checks
  const sheetsById = new Map<string, Sheet>(
    sheetRows.map((r) => [
      r.id as string,
      {
        id: r.id as string,
        orgId: snap.orgId,
        name: r.name as string,
        itemLabel: r.item_label as string,
        idPrefix: (r.id_prefix as string | null) ?? '',
        isLibrary: !!r.is_library,
      },
    ]),
  );
  const ctxFor = (sheetId: string): Ctx => {
    const ctx = basicCtx({
      today: env.today,
      now: env.now,
      timeZone: env.timeZone,
      userId: env.userId,
      sheet: sheetsById.get(sheetId)!,
      people: snap.members,
      newId: (prefix) => `${prefix}${env.newId().slice(0, 8)}`,
    });
    return {
      ...ctx,
      fieldsByKey: new Map((engineFields.get(sheetId) ?? []).map((f) => [f.key, f])),
      fieldsOf: (id) => engineFields.get(id) ?? [],
      groups: new Map((engineGroups.get(sheetId) ?? []).map((g) => [g.id, g])),
      sheetOf: (id) => sheetsById.get(id),
      jobRoles: new Map(
        snap.jobRoles.map((r) => [r.id, { ...r, memberIds: [] }]),
      ) as Ctx['jobRoles'],
      teams: new Map(snap.teams.map((r) => [r.id, { ...r, memberIds: [] }])) as Ctx['teams'],
    };
  };

  // ── automations with refs (and sentences for the preview)
  const automationRows: Row[] = tp.automations.map((a, i) => {
    const ma = m.automations[i]!;
    const id = env.newId();
    operations.push({
      kind: 'automation',
      ref: ma.ref,
      name: a.name,
      action: 'create',
      ...(a.enabled ? {} : { note: 'Installed off.' }),
    });
    let sentence = a.name;
    try {
      sentence = describeAutomation(
        {
          trigger: a.trigger as unknown as Automation['trigger'],
          conditions: a.conditions as unknown as Condition[],
          actions: a.actions as unknown as Automation['actions'],
        },
        ctxFor(a.sheet_id),
        (sid) => sheetName.get(sid),
      );
    } catch {
      // the name is the fallback sentence
    }
    base.automations.push({
      name: a.name,
      sheet: sheetName.get(a.sheet_id) ?? '',
      sentence,
      enabled: a.enabled,
    });
    return {
      id,
      ref: ma.ref,
      sheet_id: a.sheet_id,
      name: a.name,
      enabled: a.enabled,
      trigger: a.trigger,
      conditions: a.conditions,
      actions: a.actions,
    };
  });

  // ── dashboards: sheets by ref, fields by key, checked against the widget registry
  const dashKeys = keysBetween(snap.lastDashboardPosition, null, Math.max(1, m.dashboards.length));
  const dashboardRows: Row[] = m.dashboards.map((d, di) => {
    const widgets: WidgetConfig[] = d.widgets.map((w) => ({
      id: w.ref,
      type: w.type,
      title: w.title,
      ...(w.sheetRef ? { sheetId: sheetIdOf.get(w.sheetRef) ?? null } : {}),
      ...(w.fieldKey ? { fieldKey: w.fieldKey } : {}),
      ...(w.conditions ? { conditions: w.conditions as Condition[] } : {}),
      ...(w.days !== undefined ? { days: w.days } : {}),
    }));
    for (const w of widgets) {
      const problem = widgetProblem(w, (id) => {
        if (!sheetsById.has(id)) return undefined;
        return { fields: engineFields.get(id) ?? [], ctx: ctxFor(id) };
      });
      if (problem) conflicts.push(`Dashboard ${d.name} › ${w.title}: ${problem}`);
    }
    operations.push({ kind: 'dashboard', ref: d.ref, name: d.name, action: 'create' });
    base.dashboards.push({ name: d.name, widgets: widgets.length });
    return {
      id: env.newId(),
      ref: d.ref,
      name: d.name,
      position: dashKeys[di]!,
      config: { widgets } as unknown as Json,
    };
  });

  const state = conflicts.length ? 'blocked' : 'ready';
  const preview: PackPreview = {
    ...base,
    // folders the workspace already has are used, not counted as new
    counts: { ...base.counts, folders: folderRows.length, links: linkRows.length },
    state,
    conflicts: [...new Set(conflicts)],
    warnings: [...new Set(tp.warnings)],
  };
  if (state === 'blocked')
    for (const c of preview.conflicts)
      if (!operations.some((o) => o.action === 'conflict' && o.note === c))
        operations.push({ kind: 'pack', ref: m.key, name: m.title, action: 'conflict', note: c });
  const payload: InstallPayload | null =
    state === 'ready'
      ? {
          pack: { key: m.key, version: m.version, hash: env.hash },
          folders: folderRows,
          sheets: sheetRows,
          fields: fieldRows,
          groups: groupRows,
          views: viewRows,
          items: itemRows,
          links: linkRows,
          automations: automationRows,
          dashboards: dashboardRows,
        }
      : null;
  return { state, operations, preview, payload };
}
