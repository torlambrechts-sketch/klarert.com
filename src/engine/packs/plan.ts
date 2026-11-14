// The pack install planner (docs/11, docs/02 §15). Pure: the manifest and a snapshot of the workspace in, the
// operations (create / reuse / skip / conflict), a preview people read and the rows install_pack writes out. The clock
// and ids are injected. Sheet-level work (fields, groups, views, forms, tabs, column groups, sub-items, values,
// automations) is the template planner's (planTemplateImport); this file adds what a pack has on top: folders by ref,
// stable refs on every row, ID prefixes renamed when the workspace already uses them, items and links by ref,
// dashboards, libraries and documents registers, and the checks that an install can go ahead.
import { applyPackSettings, type PackSettingValues } from './settings';
import { describeAutomation } from '../automations/builder';
import { basicCtx } from '../context';
import { widgetProblem } from '../dashboards/registry';
import type { WidgetConfig } from '../dashboards/types';
import { keysBetween } from '../ordering';
import { isOutbound, startsInTestMode } from './safety';
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
import {
  defaultLevel,
  levelRank,
  levelSummaries,
  libraryKey,
  manifestAtLevel,
  type LevelSummary,
} from './levels';
import { parseRequirementKey } from '../frameworks/refs';
import { satisfies } from './semver';
import {
  augmentManifest,
  extensionSummary,
  foreignKey,
  standardViewName,
  virtualRef,
  workflowList,
  type ForeignSheet,
} from './extend';
import { packToTemplate } from './template';
import { splitSheetRef, type PackManifest } from './types';

export interface PackSnapshot {
  orgId: string;
  /** ID prefixes in use (every sheet, archived ones too: the prefix stays unique). */
  prefixes: string[];
  folders: { id: string; name: string; archived: boolean }[];
  installs: {
    id: string;
    packKey: string;
    version: string;
    status: 'installed' | 'archived';
    /** The level installed (packs with levels, docs/11). */
    level?: string | null;
    /** The install's ref → id map (`sheet:risk` → id): what a higher level must not create again. */
    refMap?: Record<string, string>;
  }[];
  /** Framework libraries adopted here (`<framework>@<version>` → library sheet id), docs/12. */
  libraries?: { library: string; sheetId: string }[];
  /**
   * The adopted libraries' items the manifest's example links name (`requirements`), by requirement key
   * (`iso-27001@2022#A.6.3` → item id). Only live items of live library sheets.
   */
  requirementItems?: Record<string, string>;
  members: (Person & { email: string })[];
  jobRoles: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  lastSheetPosition: string | null;
  lastFolderPosition: string | null;
  lastDashboardPosition: string | null;
  /**
   * Live sheets of the installed packs the manifest requires, by `<pack>:<sheet ref>` (docs/11 Extends): what an
   * extension adds to and what links into another pack point at.
   */
  foreign?: Record<string, ForeignSheet>;
  /** Folders of the installed packs the manifest requires, `<pack>:<folder ref>` → id (domain folders). */
  foreignFolders?: Record<string, string>;
}

/** A required pack the install command installs (or raises to a level) before this one (docs/11 Extends). */
export interface InstallFirst {
  key: string;
  title: string;
  version: string;
  /** The level it is installed at (or raised to); null for a pack without levels. */
  level: string | null;
  levelName: string | null;
  /** Installed already at a lower level: raised to `level`. */
  raise: boolean;
  /** Its sheets by ref, so the preview names what this pack adds to before they exist. */
  sheets?: Record<string, { name: string; standards: boolean }>;
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
  | 'option'
  | 'workflow'
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
  pack: { key: string; version: string; hash: string; level?: string };
  /** A higher level added to the live install of the same version (docs/11 Levels): rows join that install. */
  extend_install?: string;
  folders: Row[];
  sheets: Row[];
  fields: Row[];
  groups: Row[];
  views: Row[];
  items: Row[];
  links: { field_id: string; from_item: string; to_item: string }[];
  automations: Row[];
  dashboards: Row[];
  /**
   * Options added to option fields of another pack's sheets (docs/11 Extends), merged by id: `ref` is
   * `<pack>:<sheet>.<field key>.<option id>` (ref map `option:<ref>` → the field's id).
   */
  options?: { ref: string; field_id: string; option: Json }[];
  /**
   * Approval workflows added to another pack's sheet (docs/11 Extends), merged by id into its settings.workflows:
   * `ref` is `<pack>:<sheet>.workflow.<id>`; the id starts with the pack's namespace (`<ns>_…`).
   */
  workflows?: { ref: string; sheet_id: string; workflow: Json }[];
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
  /** `testMode`: installed in test mode (docs/04 §14): it logs what it would do until turned live. */
  automations: {
    name: string;
    sheet: string;
    sentence: string;
    enabled: boolean;
    testMode?: boolean;
  }[];
  forms: { sheet: string; name: string; access: string }[];
  dashboards: { name: string; widgets: number }[];
  renamedPrefixes: { sheet: string; from: string; to: string }[];
  /** Why the pack cannot be installed (state blocked). */
  conflicts: string[];
  /** What installs differently than written: people, job roles or teams the workspace does not have. */
  warnings: string[];
  /** The level this preview installs (packs with levels), and what every level creates. */
  level: { key: string; name: string } | null;
  levels: LevelSummary[];
  /** The level already installed when this preview adds a higher one: only what is missing is created. */
  extendsLevel: { key: string; name: string } | null;
  /** Framework libraries the pack builds on; `adopted: false` ones are adopted first at install (docs/12). */
  frameworks: { library: string; adopted: boolean; optional?: boolean }[];
  /** What the pack adds to other packs' sheets (docs/11 Extends). */
  extends: {
    pack: string;
    sheet: string;
    /** "2 columns, 1 example item" */
    adds: string[];
    views: string[];
    options: string[];
  }[];
  /** Required packs installed (or raised to a level) first; the install plans again after them. */
  installsFirst: InstallFirst[];
}

export interface PackPlan {
  state: PackPreview['state'];
  operations: PackOperation[];
  preview: PackPreview;
  /** Null unless the state is ready. */
  payload: InstallPayload | null;
}

const lower = (s: string) => s.trim().toLowerCase();
const listWords = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
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
      (n, s) =>
        n +
        s.items.reduce(
          (k, i) =>
            k +
            Object.values(i.links ?? {}).flat().length +
            Object.values(i.requirements ?? {}).flat().length,
          0,
        ),
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
  for (const d of p.installsFirst ?? [])
    out.push(
      d.raise
        ? `Adds ${d.levelName ?? d.level} to ${d.title} first.`
        : `Installs ${d.title} ${d.version}${d.levelName ? ` (${d.levelName})` : ''} first.`,
    );
  for (const e of p.extends ?? []) {
    const parts = [
      ...e.adds,
      ...e.views.map((v) => `the view ${v}`),
      ...e.options.map((o) => `the option ${o}`),
    ];
    if (parts.length) out.push(`Adds to ${e.sheet}: ${listWords(parts)}.`);
  }
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
  for (const a of p.automations)
    out.push(
      `${a.sheet}: ${a.sentence}${a.enabled ? '' : ' (off)'}${a.testMode ? ' (test mode)' : ''}`,
    );
  for (const f of p.forms) out.push(`${f.sheet}: form ${f.name} (${f.access}, draft).`);
  for (const d of p.dashboards)
    out.push(`Dashboard ${d.name} with ${plural(d.widgets, 'widget')}.`);
  out.push(...p.warnings);
  return out;
}

export function planPackInstall(
  manifest: PackManifest,
  snap: PackSnapshot,
  env: PackEnv,
  opts: {
    level?: string | null;
    /** Required packs the command installs first (docs/11 Extends): not a conflict; the payload waits for them. */
    installFirst?: InstallFirst[];
    /** The install being upgraded: its own rows on other packs' sheets are planned again, not existing columns. */
    selfInstall?: string | null;
    /**
     * Automations that send anything out (webhook, email) install on: the person opted in at install. Off by
     * default (docs/11 Pack quality bar).
     */
    allowOutbound?: boolean;
    /** Every automation installs live, none in test mode: sample data (the seed), never a person's install. */
    live?: boolean;
    /**
     * The workspace's choices for the pack's settings (docs/11 Pack settings): `$setting:` defaults and example
     * values of its own sheets are resolved with them; without a choice they are left out.
     */
    settings?: PackSettingValues;
  } = {},
): PackPlan {
  const full = applyPackSettings(manifest, opts.settings ?? {});
  const conflicts: string[] = [];
  const operations: PackOperation[] = [];
  // ── the level: the manifest as installed at it (a pack without levels installs whole)
  const level = full.levels?.length ? (opts.level ?? defaultLevel(full)) : null;
  if (level && levelRank(full, level) < 0)
    conflicts.push(`"${level}" is not a level of this pack.`);
  const m = manifestAtLevel(
    full,
    level && levelRank(full, level) >= 0 ? level : defaultLevel(full),
  );
  const levelOf = (k: string | null | undefined) => {
    const l = full.levels?.find((x) => x.key === k);
    return l ? { key: l.key, name: l.name } : null;
  };
  const libraries = new Map((snap.libraries ?? []).map((l) => [l.library, l.sheetId]));
  const base: Omit<PackPreview, 'state' | 'conflicts' | 'warnings'> = {
    key: m.key,
    title: m.title,
    version: m.version,
    description: m.description,
    level: levelOf(level),
    levels: levelSummaries(full),
    extendsLevel: null,
    frameworks: (full.frameworks ?? []).map((f) => ({
      library: libraryKey(f),
      adopted: libraries.has(libraryKey(f)),
      ...(f.optional ? { optional: true } : {}),
    })),
    counts: manifestCounts(m),
    folders: [],
    sheets: [],
    links: [],
    automations: [],
    forms: [],
    dashboards: [],
    renamedPrefixes: [],
    extends: [],
    installsFirst: opts.installFirst ?? [],
  };
  const pendingPacks = new Set((opts.installFirst ?? []).map((d) => d.key));

  // ── already installed, or something this pack needs is missing
  const live = snap.installs.find((i) => i.packKey === m.key && i.status === 'installed');
  // a higher level of the version installed: plan the level whole, then leave out what the install already made
  const extend =
    live &&
    live.version === m.version &&
    level &&
    levelRank(full, live.level) < levelRank(full, level)
      ? live
      : null;
  const existing = extend?.refMap ?? {};
  const has = (kind: string, ref: string) => typeof existing[`${kind}:${ref}`] === 'string';
  if (extend) base.extendsLevel = levelOf(extend.level) ?? levelOf(defaultLevel(full));
  if (live && live.version === m.version && !extend) {
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
  if (live && !extend)
    conflicts.push(
      `Version ${live.version} is installed. Upgrading to ${m.version} is not available yet: archive the installed version first.`,
    );
  for (const r of m.requires) {
    if (pendingPacks.has(r.pack)) continue; // the command installs it (or raises its level) first
    const dep = snap.installs.find((i) => i.packKey === r.pack && i.status === 'installed');
    if (!dep) conflicts.push(`Install the pack "${r.pack}" (${r.range}) first.`);
    else if (!satisfies(dep.version, r.range))
      conflicts.push(`The pack "${r.pack}" is at ${dep.version}; this pack needs ${r.range}.`);
  }
  // other packs' sheets this one extends or links to (docs/11 Extends): virtual sheets of the template
  const aug = augmentManifest(m, snap.foreign ?? {}, {
    selfInstall: opts.selfInstall ?? extend?.id ?? null,
    pending: pendingPacks,
  });
  conflicts.push(...aug.problems);
  const mm = aug.manifest;
  const isVirtual = (ref: string) => aug.virtual.has(ref);
  for (const c of conflicts)
    operations.push({ kind: 'pack', ref: m.key, name: m.title, action: 'conflict', note: c });

  // ── ID prefixes: renamed with a number when the workspace already uses them
  const taken = new Set(snap.prefixes);
  const prefixes: Record<string, string> = {};
  for (const s of mm.sheets) {
    if (isVirtual(s.ref)) {
      prefixes[s.ref] = s.idPrefix;
      continue;
    }
    if (has('sheet', s.ref)) {
      prefixes[s.ref] = s.idPrefix;
      continue;
    }
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
    const mine = existing[`folder:${f.ref}`];
    if (mine) {
      folderIds.set(f.ref, mine);
      operations.push({
        kind: 'folder',
        ref: f.ref,
        name: f.name,
        action: 'skip',
        note: 'Already installed.',
      });
      return;
    }
    // a domain folder of shared registers is always the pack's own (docs/11 Core registers)
    const existingFolder = f.domain
      ? undefined
      : snap.folders.find((x) => !x.archived && lower(x.name) === lower(f.name));
    if (existingFolder) {
      const existing = existingFolder;
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
      ...(f.domain ? { domain: f.domain } : {}),
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
  const t = packToTemplate(mm, prefixes);
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
  // the settings of a foreign sheet's existing columns are that pack's business, not this plan's
  const existingSettings = new Set(
    mm.sheets.flatMap((s) => {
      const v = aug.virtual.get(s.ref);
      return v
        ? s.fields
            .filter((f) => v.existingFields.has(f.key))
            .map((f) => `${s.name} › ${f.name}: settings do not fit`)
        : [];
    }),
  );
  // automations that create on a required pack's sheet installed first are checked when the install plans again
  const waitingOn = (raw: unknown) =>
    typeof raw === 'string' &&
    raw.includes(':') &&
    pendingPacks.has(splitSheetRef(raw, m.key)?.pack ?? '');
  // so are automations that read a sheet's links into such a pack, or lookups and roll-ups through them (a check's
  // Supplier owner, looked up on Core's Suppliers): what those fields hold is known once that sheet is there
  const waitingKeys = new Map<string, Set<string>>(); // sheet ref → keys
  for (const s of mm.sheets) {
    const links = new Set(
      s.fields
        .filter((f) => waitingOn((f.config as Record<string, unknown> | undefined)?.targetSheetRef))
        .map((f) => f.key),
    );
    if (!links.size) continue;
    const through = s.fields
      .filter((f) => {
        const k = (f.config as Record<string, unknown> | undefined)?.linkFieldKey;
        return typeof k === 'string' && links.has(k);
      })
      .map((f) => f.key);
    waitingKeys.set(s.ref, new Set([...links, ...through]));
  }
  const readsWaiting = (a: (typeof mm.automations)[number]) => {
    const keys = waitingKeys.get(a.sheet);
    if (!keys) return false;
    const text = JSON.stringify([a.trigger, a.conditions, a.actions]);
    return [...keys].some((k) => text.includes(`"${k}"`) || text.includes(`"field:${k}"`));
  };
  const waitingAutomations = mm.automations
    .filter((a) => a.actions.some((x) => waitingOn(x.sheetRef)) || readsWaiting(a))
    .map((a) => `Automation "${a.name}"`);
  conflicts.push(
    ...tp.problems.filter(
      (p) =>
        ![...existingSettings].some((x) => p.startsWith(x)) &&
        !waitingAutomations.some((x) => p.startsWith(x)),
    ),
  );

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
  // the virtual sheets' planned ids → the foreign sheet's real ones (sheet, existing fields and groups)
  const real = new Map<string, string>();
  const virtualSheetRows: Row[] = [];
  const workflowRows: NonNullable<InstallPayload['workflows']> = [];
  const optionRows: NonNullable<InstallPayload['options']> = aug.options.map((o) => ({
    ref: o.ref,
    field_id: o.fieldId,
    option: o.option as unknown as Json,
  }));
  for (const o of aug.options)
    operations.push({
      kind: 'option',
      ref: o.ref,
      name: `${o.sheetName} › ${o.fieldName} › ${o.option.label}`,
      action: 'create',
    });

  tp.sheets.forEach((ps, si) => {
    const ms = mm.sheets[si]!;
    const v = aug.virtual.get(ms.ref);
    if (v) {
      // ── another pack's sheet: only what the extension adds is written, after what the sheet has
      const sheetId = ps.row.id;
      real.set(sheetId, v.foreign.sheetId);
      sheetIdOf.set(ms.ref, sheetId);
      sheetName.set(sheetId, ms.name);
      virtualSheetRows.push({
        id: sheetId,
        name: ms.name,
        item_label: ms.itemLabel,
        id_prefix: ms.idPrefix,
        is_library: false,
      });
      const added = ps.fields.filter((f) => !v.existingFields.has(f.key));
      const fieldKeys = keysBetween(v.foreign.lastFieldPosition, null, Math.max(1, added.length));
      for (const f of ps.fields) {
        const was = v.existingFields.get(f.key);
        if (was) real.set(f.id, was);
      }
      added.forEach((f, i) => {
        const ref = `${v.key}.${f.key}`;
        fieldRows.push({ ...(f as unknown as Row), ref, position: fieldKeys[i]!, system: true });
        operations.push({ kind: 'field', ref, name: `${ms.name} › ${f.name}`, action: 'create' });
      });
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
      const newGroups = ps.groups.filter((_g, gi) => !v.existingGroups.has(ms.groups[gi]!.ref));
      const groupKeys = keysBetween(
        v.foreign.lastGroupPosition,
        null,
        Math.max(1, newGroups.length),
      );
      let gn = 0;
      ps.groups.forEach((g, gi) => {
        const gref = ms.groups[gi]!.ref;
        const was = v.existingGroups.get(gref);
        if (was) {
          real.set(g.id, was);
          return;
        }
        const ref = `${v.key}.${gref}`;
        groupRows.push({ ...(g as unknown as Row), ref, position: groupKeys[gn++]! });
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
      const viewKeys = keysBetween(v.foreign.lastViewPosition, null, Math.max(1, ps.views.length));
      const viewNames: string[] = [];
      ps.views.forEach((vw, vi) => {
        const form = vi >= ms.views.length ? ms.forms[vi - ms.views.length] : undefined;
        const ref = form
          ? `${v.key}.form.${form.ref}`
          : vi < v.extensionViews
            ? `${v.key}.view.${vi + 1}`
            : `${v.key}.view.standard`;
        viewRows.push({ ...(vw as unknown as Row), ref, position: viewKeys[vi]! });
        operations.push({
          kind: form ? 'form' : 'view',
          ref,
          name: `${ms.name} › ${vw.name}`,
          action: 'create',
        });
        if (form) base.forms.push({ sheet: ms.name, name: form.name, access: form.access });
        else viewNames.push(vw.name);
      });
      for (const g of ps.items) {
        const realGroup = real.get(g.groupId);
        const keys = realGroup
          ? keysBetween(v.foreign.lastItemPosition[realGroup] || null, null, g.rows.length)
          : g.rows.map((r) => r.position);
        g.rows.forEach((r, ri) => {
          const id = env.newId();
          const ref = `${v.key}.${r.ref}`;
          itemIds.set(`${ms.ref}.${r.ref}`, id);
          itemRows.push({
            id,
            ref,
            sheet_id: sheetId,
            group_id: g.groupId,
            name: r.name,
            position: keys[ri]!,
            values: r.values,
          });
          operations.push({ kind: 'item', ref, name: `${ms.name} › ${r.name}`, action: 'create' });
        });
      }
      const ext = (m.extends ?? []).find((e) => e.pack === v.pack && e.sheet === v.sheet);
      // approval workflows merged by id: one the sheet has already is left as it is
      const has = new Set(workflowList(v.foreign.workflows).map((w) => w.id));
      for (const w of ext?.workflows ?? []) {
        const ref = `${v.key}.workflow.${w.id}`;
        if (has.has(w.id)) {
          operations.push({
            kind: 'workflow',
            ref,
            name: `${ms.name} › ${w.name}`,
            action: 'skip',
            note: 'The sheet has this approval workflow.',
          });
          continue;
        }
        workflowRows.push({ ref, sheet_id: v.foreign.sheetId, workflow: w as unknown as Json });
        operations.push({
          kind: 'workflow',
          ref,
          name: `${ms.name} › ${w.name}`,
          action: 'create',
        });
      }
      const opts = aug.options.filter((o) => o.ref.startsWith(`${v.key}.`));
      if (ext || opts.length)
        base.extends.push({
          pack: v.pack,
          sheet: ms.name,
          adds: ext ? extensionSummary({ ...ext, views: [], forms: [] }) : [],
          views: viewNames,
          options: opts.map((o) => `${o.option.label} in ${o.fieldName}`),
        });
      return;
    }
    const folder = ms.folder;
    const foreignFolder = folder?.includes(':') ? folder : null;
    const folderId = folder
      ? foreignFolder
        ? (snap.foreignFolders?.[foreignFolder] ?? null)
        : (folderIds.get(folder) ?? null)
      : null;
    if (foreignFolder && !folderId && !pendingPacks.has(foreignFolder.split(':')[0]!))
      conflicts.push(
        `${ms.name} goes in the folder "${foreignFolder}", which is not installed here.`,
      );
    const sheetId = ps.row.id;
    sheetIdOf.set(ms.ref, sheetId);
    sheetName.set(sheetId, ms.name);
    const settings = {
      ...ps.row.settings,
      // a system pack's sheets are shared registers (docs/11 Core registers): the header says "System board"
      ...(m.system ? { system: true } : {}),
      ...(ms.register ? { register: ms.register } : {}),
      ...(ms.framework ? { framework: ms.framework } : {}),
      ...(ms.uniqueLinks ? { uniqueLinkPair: ms.uniqueLinks } : {}),
    } as unknown as Row;
    sheetRows.push({
      ...(ps.row as unknown as Row),
      ref: ms.ref,
      folder_id: folderId,
      is_library: ms.isLibrary,
      settings,
      parent_sheet_id: null,
      ...(ms.restricted || ms.personalData ? { restricted: true } : {}),
    });
    operations.push({ kind: 'sheet', ref: ms.ref, name: ms.name, action: 'create' });
    for (const f of ps.fields) {
      const ref = `${ms.ref}.${f.key}`;
      // a system pack's fields are system columns: hidden, renamed, never deleted, retyped or re-keyed
      fieldRows.push({ ...(f as unknown as Row), ref, ...(m.system ? { system: true } : {}) });
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
      // automations on sub-items (`subitems: true`) name the child sheet: sentences and checks read its fields
      sheetIdOf.set(childRef, sub.sheet.id);
      sheetName.set(sub.sheet.id, `${ms.name} › ${sub.label}`);
      engineFields.set(
        sub.sheet.id,
        sub.fields.map((f) => ({
          id: f.id,
          sheetId: sub.sheet.id,
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
          rules: f.rules as unknown as Field['rules'],
          visibility: null,
        })),
      );
      engineGroups.set(sub.sheet.id, [
        {
          id: sub.group.id,
          sheetId: sub.sheet.id,
          name: sub.group.name,
          color: sub.group.color as LabelColor,
          position: sub.group.position,
        },
      ]);
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
    // items with their refs (examples, documents of a register, library items with their requirement)
    const requirementOf = new Map(
      ms.items.flatMap((i) => (i.requirementRef ? [[i.ref, i.requirementRef] as const] : [])),
    );
    for (const g of ps.items)
      for (const r of g.rows) {
        const id = env.newId();
        const ref = `${ms.ref}.${r.ref}`;
        itemIds.set(ref, id);
        const requirement = r.ref ? requirementOf.get(r.ref) : undefined;
        itemRows.push({
          id,
          ref,
          sheet_id: sheetId,
          group_id: g.groupId,
          name: r.name,
          position: r.position,
          values: r.values,
          ...(requirement ? { requirement_ref: requirement } : {}),
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
      ...(ms.restricted || ms.personalData ? { restricted: true } : {}),
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
      const foreignTarget =
        !target && typeof cfg.targetSheetRef === 'string'
          ? splitSheetRef(cfg.targetSheetRef, m.key)
          : null;
      if (foreignTarget?.pack) {
        const fs = snap.foreign?.[foreignKey(foreignTarget.pack, foreignTarget.ref)];
        base.links.push({
          from: ms.name,
          field: f.name,
          to:
            fs?.name ??
            base.installsFirst.find((d) => d.key === foreignTarget.pack)?.sheets?.[
              foreignTarget.ref
            ]?.name ??
            `${foreignTarget.pack}:${foreignTarget.ref}`,
          twoWay: typeof cfg.inverseKey === 'string',
        });
        continue;
      }
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
  // example links into a required framework's library (`requirements`), by requirement key: resolved against the
  // adopted library's items. Before the library is adopted (the preview) they are left for the install, which adopts
  // it first and plans again; a key the library does not have is left out and said.
  const libraryLinkWarnings: string[] = [];
  const reqItems = snap.requirementItems ?? {};
  // (an extension item links through a requirement field its entry adds to the other pack's sheet)
  for (const ms of mm.sheets)
    for (const i of ms.items)
      for (const [key, keys] of Object.entries(i.requirements ?? {})) {
        const fieldRef = `${aug.virtual.get(ms.ref)?.key ?? ms.ref}.${key}`;
        const fieldId = fieldRows.find((f) => f.ref === fieldRef)?.id;
        const from = itemIds.get(`${ms.ref}.${i.ref}`);
        if (typeof fieldId !== 'string' || !from) continue;
        for (const k of keys) {
          const id = parseRequirementKey(k);
          if (!id || !libraries.has(`${id.framework}@${id.version}`)) continue;
          const to = reqItems[k];
          if (!to) {
            libraryLinkWarnings.push(
              `${ms.name} › ${i.name}: the library has no requirement ${id.ref}, so it is not linked.`,
            );
            continue;
          }
          linkRows.push({ field_id: fieldId, from_item: from, to_item: to });
        }
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
    [...sheetRows, ...virtualSheetRows].map((r) => [
      r.id as string,
      {
        id: r.id as string,
        orgId: snap.orgId,
        name: r.name as string,
        itemLabel: r.item_label as string,
        idPrefix: (r.id_prefix as string | null) ?? '',
        isLibrary: !!r.is_library,
        // the sheet's approval workflows, so a `start_workflow` action or a workflow trigger finds them
        ...(Array.isArray((r.settings as { workflows?: unknown } | undefined)?.workflows)
          ? {
              workflows: (r.settings as unknown as { workflows: Sheet['workflows'] }).workflows,
            }
          : {}),
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
  // outbound ones off unless opted in, notifying ones in test mode (docs/11 Pack quality bar)
  const automationRows: Row[] = tp.automations.map((a, i) => {
    const ma = mm.automations[i]!;
    const id = env.newId();
    const enabled = a.enabled && (opts.allowOutbound === true || !isOutbound(ma));
    const testMode = !opts.live && startsInTestMode(ma);
    operations.push({
      kind: 'automation',
      ref: ma.ref,
      name: a.name,
      action: 'create',
      ...(!enabled
        ? { note: 'Installed off.' }
        : testMode
          ? { note: 'Installed in test mode.' }
          : {}),
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
      enabled,
      ...(testMode ? { testMode: true } : {}),
    });
    return {
      id,
      ref: ma.ref,
      sheet_id: a.sheet_id,
      name: a.name,
      enabled,
      ...(testMode ? { mode: 'test' } : {}),
      trigger: a.trigger,
      conditions: a.conditions,
      actions: a.actions,
    };
  });

  // ── dashboards: sheets by ref, fields by key, checked against the widget registry
  const dashKeys = keysBetween(snap.lastDashboardPosition, null, Math.max(1, m.dashboards.length));
  // a widget on a required pack's sheet (`core:nc`) reads the virtual sheet planned for it, then the real one
  const widgetSheet = (raw: string): string | null => {
    const s = splitSheetRef(raw, m.key);
    if (!s) return null;
    return sheetIdOf.get(s.pack ? virtualRef(s.pack, s.ref) : s.ref) ?? null;
  };
  const dashboardRows: Row[] = m.dashboards.map((d, di) => {
    const widgets: WidgetConfig[] = d.widgets.map((w) => ({
      id: w.ref,
      type: w.type,
      title: w.title,
      ...(w.sheetRef ? { sheetId: widgetSheet(w.sheetRef) } : {}),
      // a required framework's library: adopted before the install when missing (the command plans again then)
      ...(w.library ? { sheetId: libraries.get(w.library) ?? null } : {}),
      ...(w.fieldKey ? { fieldKey: w.fieldKey } : {}),
      ...(w.conditions ? { conditions: w.conditions as Condition[] } : {}),
      ...(w.scope ? { scope: w.scope as Condition[] } : {}),
      ...(w.days !== undefined ? { days: w.days } : {}),
    }));
    for (const [wi, w] of widgets.entries()) {
      // the library's fields are the framework's (docs/12); the manifest names them by key
      if (d.widgets[wi]!.library) continue;
      // a required pack's sheet installed first: checked when the install plans again
      if (waitingOn(d.widgets[wi]!.sheetRef)) continue;
      const problem = widgetProblem(w, (id) => {
        if (!sheetsById.has(id)) return undefined;
        return { fields: engineFields.get(id) ?? [], ctx: ctxFor(id) };
      });
      if (problem) conflicts.push(`Dashboard ${d.name} › ${w.title}: ${problem}`);
    }
    operations.push({ kind: 'dashboard', ref: d.ref, name: d.name, action: 'create' });
    base.dashboards.push({ name: d.name, widgets: widgets.length });
    // checked against the planned sheets; written with the real id of another pack's sheet
    const written = widgets.map((w) =>
      w.sheetId && real.has(w.sheetId) ? { ...w, sheetId: real.get(w.sheetId)! } : w,
    );
    return {
      id: env.newId(),
      ref: d.ref,
      name: d.name,
      position: dashKeys[di]!,
      config: { widgets: written } as unknown as Json,
    };
  });

  // ── rows on other packs' sheets: the virtual sheet's ids swapped for the real ones
  const swapReal = (v: Json): Json => {
    if (typeof v === 'string') return real.get(v) ?? v;
    if (Array.isArray(v)) return v.map(swapReal);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [real.get(k) ?? k, swapReal(x)]));
    return v;
  };
  const onReal = <T>(list: T[]): T[] =>
    real.size ? list.map((r) => swapReal(r as unknown as Json) as unknown as T) : list;

  // ── a higher level: what the install already made is left out, and the new rows point at its ids
  let rows = {
    sheets: sheetRows,
    fields: onReal(fieldRows),
    groups: onReal(groupRows),
    views: onReal(viewRows),
    items: onReal(itemRows),
    links: onReal(linkRows),
    automations: onReal(automationRows),
    dashboards: dashboardRows,
  };
  let options = optionRows;
  if (extend) {
    const kinds: [keyof typeof rows, string][] = [
      ['sheets', 'sheet'],
      ['fields', 'field'],
      ['groups', 'group'],
      ['views', 'view'],
      ['items', 'item'],
      ['automations', 'automation'],
      ['dashboards', 'dashboard'],
    ];
    const remap = new Map<string, string>();
    for (const [list, kind] of kinds)
      for (const r of rows[list] as Row[])
        if (has(kind, String(r.ref)))
          remap.set(String(r.id), existing[`${kind}:${String(r.ref)}`]!);
    options = optionRows.filter((o) => !has('option', o.ref));
    const swap = (v: Json): Json => {
      if (typeof v === 'string') return remap.get(v) ?? v;
      if (Array.isArray(v)) return v.map(swap);
      if (v && typeof v === 'object')
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [remap.get(k) ?? k, swap(x)]));
      return v;
    };
    const fresh = (list: Row[]) =>
      list.filter((r) => !remap.has(String(r.id))).map((r) => swap(r) as Row);
    const before = new Set(remap.keys());
    rows = {
      sheets: fresh(rows.sheets),
      fields: fresh(rows.fields),
      groups: fresh(rows.groups),
      views: fresh(rows.views),
      items: fresh(rows.items),
      // links the install already has (both ends and the field made before) are not written again
      links: rows.links
        .filter((l) => !(before.has(l.field_id) && before.has(l.from_item)))
        .map((l) => swap(l as unknown as Json) as unknown as InstallPayload['links'][number]),
      automations: fresh(rows.automations),
      dashboards: fresh(rows.dashboards),
    };
    // what a lower level already added to other packs' sheets is not said again
    base.extends = [];
    for (const o of operations)
      if (o.action === 'create' && has(o.kind, o.ref)) {
        o.action = 'skip';
        o.note = 'Already installed.';
      }
    const newSheet = (ref: string) => !has('sheet', ref);
    const sheetsAdded = m.sheets.filter((s) => newSheet(s.ref));
    const sheetNames = new Set(sheetsAdded.map((s) => s.name));
    base.sheets = base.sheets.filter((s) => newSheet(s.ref));
    base.links = base.links.filter((l) => sheetNames.has(l.from) || sheetNames.has(l.to));
    base.forms = base.forms.filter((f) => sheetNames.has(f.sheet));
    const newAutos = m.automations.filter((a) => !has('automation', a.ref));
    base.automations = base.automations.filter(
      (_a, i) => !has('automation', m.automations[i]!.ref),
    );
    const newDash = m.dashboards.filter((d) => !has('dashboard', d.ref));
    base.dashboards = base.dashboards.filter((_d, i) => !has('dashboard', m.dashboards[i]!.ref));
    base.counts = manifestCounts({
      ...m,
      folders: [],
      sheets: sheetsAdded,
      automations: newAutos,
      dashboards: newDash,
    });
  }

  // what it adds to a required pack installed first: said from the manifest (the install plans it again then)
  for (const e of m.extends ?? []) {
    if (!aug.pending.includes(foreignKey(e.pack, e.sheet))) continue;
    const target = base.installsFirst.find((d) => d.key === e.pack)?.sheets?.[e.sheet];
    const standard = m.standard && target?.standards ? m.standard : null;
    base.extends.push({
      pack: e.pack,
      sheet: target?.name ?? `${e.pack}:${e.sheet}`,
      adds: extensionSummary({ ...e, views: [], forms: [] }),
      views: [
        ...(e.views ?? []).map((v) => v.name),
        ...(standard ? [standardViewName(standard.label)] : []),
      ],
      options: [
        ...Object.values(e.options ?? {})
          .flat()
          .map((o) => o.label),
        ...(standard ? [`${standard.label} in Standards`] : []),
      ],
    });
  }
  const state = conflicts.length ? 'blocked' : 'ready';
  // required packs installed first: the install plans again once they are there
  const waiting = base.installsFirst.length > 0 || aug.pending.length > 0;
  const preview: PackPreview = {
    ...base,
    // folders the workspace already has are used, not counted as new
    counts: { ...base.counts, folders: folderRows.length, links: rows.links.length },
    state,
    conflicts: [...new Set(conflicts)],
    warnings: [...new Set([...tp.warnings, ...libraryLinkWarnings])],
  };
  if (state === 'blocked')
    for (const c of preview.conflicts)
      if (!operations.some((o) => o.action === 'conflict' && o.note === c))
        operations.push({ kind: 'pack', ref: m.key, name: m.title, action: 'conflict', note: c });
  const payload: InstallPayload | null =
    state === 'ready' && !waiting
      ? {
          pack: { key: m.key, version: m.version, hash: env.hash, ...(level ? { level } : {}) },
          ...(extend ? { extend_install: extend.id } : {}),
          folders: folderRows,
          ...rows,
          ...(options.length ? { options } : {}),
          ...(workflowRows.length ? { workflows: workflowRows } : {}),
        }
      : null;
  return { state, operations, preview, payload };
}
