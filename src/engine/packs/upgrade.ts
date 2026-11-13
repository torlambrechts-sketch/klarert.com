// Pack upgrades (docs/11 Upgrades, P6). Pure: the manifest of the installed version, the workspace's current state of
// what the install made, and the new manifest in; a preview people read and the rows upgrade_pack writes out. The clock
// and ids are injected.
//
// A three-way diff per object, matched by its stable ref (the install's ref map):
//   base   = the installed version's manifest, planned the way install_pack wrote it (ids swapped for the install's)
//   mine   = the object as the workspace holds it now
//   theirs = the new version's manifest, planned the same way
// Per attribute: the pack did not change it → nothing; the client did not change it → take the pack's; both changed
// it → a conflict the person settles (keep mine, the default, or take theirs). Fields are add-only (never a new type,
// never an option removed; new options are added, the client's labels and colours kept); automations keep their on/off
// state; objects the pack no longer ships are archived (sheets and items only when they hold nothing the client
// added, automations turned off), never deleted; what the client added is never touched. Example items compare
// against the values the install logged (item.created), so `$today` and `$in:N` do not read as changes.
import { keysBetween } from '../ordering';
import type { Json } from '../types';
import { defaultLevel, levelRank } from './levels';
import { planPackInstall, type PackEnv, type PackSnapshot } from './plan';
import { compareVersions } from './semver';
import type { PackManifest } from './types';

type Row = Record<string, Json>;
type Attrs = Record<string, Json | undefined>;

/** What the install made, as the workspace holds it now (read with provenance: pack_install_id and pack_ref). */
export interface InstalledState {
  installId: string;
  version: string;
  level: string | null;
  refMap: Record<string, string>;
  folders: { id: string; ref: string; name: string; archived: boolean }[];
  sheets: {
    id: string;
    ref: string;
    name: string;
    description: string | null;
    itemLabel: string;
    folderId: string | null;
    parentSheetId: string | null;
    archived: boolean;
    /** Live items the client added (no pack provenance). */
    clientItems: number;
  }[];
  fields: {
    id: string;
    ref: string;
    sheetId: string;
    key: string;
    name: string;
    type: string;
    description: string | null;
    required: boolean;
    locked: boolean;
    config: Json;
    archived: boolean;
  }[];
  groups: { id: string; ref: string; sheetId: string; name: string; color: string }[];
  views: { id: string; ref: string; sheetId: string; name: string; type: string; config: Json }[];
  items: {
    id: string;
    ref: string;
    sheetId: string;
    groupId: string;
    name: string;
    values: Record<string, Json>;
    archived: boolean;
    requirementRef: string | null;
    /** The item as the install wrote it (its item.created entry); null when the entry is not there. */
    installed: { name: string; groupId: string; values: Record<string, Json> } | null;
  }[];
  automations: {
    id: string;
    ref: string;
    sheetId: string;
    name: string;
    enabled: boolean;
    trigger: Json;
    conditions: Json;
    actions: Json;
  }[];
  dashboards: { id: string; ref: string; name: string; config: Json; archived: boolean }[];
  /** The last position per sheet (fields, groups, views) and per group (live items), to add after. */
  lastPosition: {
    fields: Record<string, string>;
    groups: Record<string, string>;
    views: Record<string, string>;
    items: Record<string, string>;
  };
}

export type UpgradeObjectKind =
  | 'folder'
  | 'sheet'
  | 'field'
  | 'group'
  | 'view'
  | 'form'
  | 'item'
  | 'requirement'
  | 'automation'
  | 'dashboard';

export interface UpgradeChange {
  kind: UpgradeObjectKind;
  ref: string;
  /** "Risk register › Likelihood" */
  name: string;
  /** What changes, or why it is kept: "Name and description", "Holds items you added". */
  note?: string;
}

export interface UpgradeConflict {
  /** `<kind>:<ref>`: the key of the person's choice. */
  id: string;
  kind: UpgradeObjectKind;
  ref: string;
  name: string;
  /** What both sides changed, in words: "name", "settings", "Owner". */
  attributes: string[];
  choice: 'mine' | 'theirs';
}

export interface UpgradePreview {
  key: string;
  title: string;
  from: string;
  to: string;
  /** ready: there is something to write; current: the installed version is the newest; blocked: see blockers. */
  state: 'ready' | 'current' | 'blocked';
  added: UpgradeChange[];
  changed: UpgradeChange[];
  archived: UpgradeChange[];
  /** Objects the new version leaves out or changes in a way an upgrade never applies: they stay as they are. */
  kept: UpgradeChange[];
  conflicts: UpgradeConflict[];
  warnings: string[];
  blockers: string[];
  counts: { added: number; changed: number; archived: number; kept: number; conflicts: number };
}

export interface UpgradePayload {
  pack: { key: string; from_version: string; from_hash: string; version: string; hash: string };
  install: string;
  add: {
    folders: Row[];
    sheets: Row[];
    fields: Row[];
    groups: Row[];
    views: Row[];
    items: Row[];
    links: { field_id: string; from_item: string; to_item: string }[];
    automations: Row[];
    dashboards: Row[];
  };
  /** Rows of the install with the columns to set (only those present change). Item `values` is a patch. */
  update: {
    folders: Row[];
    sheets: Row[];
    fields: Row[];
    groups: Row[];
    views: Row[];
    items: Row[];
    automations: Row[];
    dashboards: Row[];
  };
  archive: { folders: string[]; sheets: string[]; items: string[]; dashboards: string[] };
  /** Automations the new version no longer ships: turned off. */
  disable: { automations: string[] };
  /** Written into the pack.upgraded entry. */
  summary: {
    added: number;
    changed: number;
    archived: number;
    kept: number;
    conflicts: number;
    theirs: number;
  };
}

export interface UpgradePlan {
  state: UpgradePreview['state'];
  preview: UpgradePreview;
  payload: UpgradePayload | null;
}

export interface UpgradeInput {
  /** The installed version's manifest and hash (the catalogue keeps every version). */
  from: { manifest: PackManifest; hash: string };
  /** The newest version in the catalogue. */
  to: { manifest: PackManifest; hash: string };
  state: InstalledState;
  snapshot: PackSnapshot;
  env: Omit<PackEnv, 'hash'>;
  /** Conflict id → the person's choice; keep mine when not given. */
  choices?: Record<string, 'mine' | 'theirs'>;
}

// ───────────────────────── helpers ─────────────────────────

/** Deep equality of JSON values; object key order does not matter, undefined keys are left out. */
export function sameJson(a: Json | undefined, b: Json | undefined): boolean {
  return canon(a) === canon(b);
}
function canon(v: Json | undefined): string {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  return `{${Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
    .join(',')}}`;
}

const isObj = (v: Json | undefined): v is Record<string, Json> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The per-attribute three-way merge. `packBase` is what the pack shipped before (did the pack change it?),
 * `clientBase` what the install wrote (did the client change it?); usually the same.
 */
export function threeWay(
  packBase: Attrs,
  clientBase: Attrs,
  mine: Attrs,
  theirs: Attrs,
  keys?: string[],
): { apply: Attrs; conflicts: string[] } {
  const apply: Attrs = {};
  const conflicts: string[] = [];
  const all = keys ?? [...new Set([...Object.keys(packBase), ...Object.keys(theirs)])];
  for (const k of all) {
    if (sameJson(packBase[k], theirs[k])) continue; // the pack did not change it
    if (sameJson(mine[k], theirs[k])) continue; // already the same
    if (sameJson(mine[k], clientBase[k])) apply[k] = theirs[k];
    else conflicts.push(k);
  }
  return { apply, conflicts };
}

interface Option {
  id?: string;
  label?: string;
  color?: string;
  [k: string]: Json | undefined;
}
const optionsOf = (config: Json | undefined): Option[] =>
  isObj(config) && Array.isArray(config.options)
    ? (config.options.filter(isObj) as unknown as Option[])
    : [];

/**
 * Field options: never removed. The client's options stay in their order with their labels and colours; an option
 * the client left as shipped takes the pack's new label and colour; options new in the pack are added at the end.
 * An option the client removed is not brought back.
 */
export function mergeOptions(
  base: Option[],
  mine: Option[],
  theirs: Option[],
): { options: Option[]; added: string[]; changed: boolean } {
  const baseById = new Map(base.filter((o) => o.id).map((o) => [o.id!, o]));
  const theirsById = new Map(theirs.filter((o) => o.id).map((o) => [o.id!, o]));
  const mineIds = new Set(mine.map((o) => o.id));
  let changed = false;
  const options = mine.map((o) => {
    const b = o.id ? baseById.get(o.id) : undefined;
    const t = o.id ? theirsById.get(o.id) : undefined;
    if (!b || !t || !sameJson(o as Json, b as Json) || sameJson(b as Json, t as Json)) return o;
    changed = true;
    return t;
  });
  const added: string[] = [];
  for (const t of theirs)
    if (t.id && !mineIds.has(t.id) && !baseById.has(t.id)) {
      options.push(t);
      added.push(String(t.label ?? t.id));
      changed = true;
    }
  return { options, added, changed };
}

const ATTR_WORDS: Record<string, string> = {
  name: 'name',
  description: 'description',
  item_label: 'item label',
  color: 'colour',
  config: 'settings',
  required: 'required',
  locked: 'locked',
  trigger: 'trigger',
  conditions: 'conditions',
  actions: 'actions',
  group_id: 'group',
};

const sentenceList = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
const capital = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** The rows a plan wrote per kind, by ref. */
interface Planned {
  folders: Map<string, Row>;
  sheets: Map<string, Row>;
  fields: Map<string, Row>;
  groups: Map<string, Row>;
  views: Map<string, Row>;
  items: Map<string, Row>;
  automations: Map<string, Row>;
  dashboards: Map<string, Row>;
  links: { field_id: string; from_item: string; to_item: string }[];
}

const KINDS: [keyof Omit<Planned, 'links'>, string][] = [
  ['folders', 'folder'],
  ['sheets', 'sheet'],
  ['fields', 'field'],
  ['groups', 'group'],
  ['views', 'view'],
  ['items', 'item'],
  ['automations', 'automation'],
  ['dashboards', 'dashboard'],
];

/** Plan a manifest as a fresh install, then swap every id the install already has for the install's own. */
function planAsInstalled(
  m: PackManifest,
  input: UpgradeInput,
  level: string | null,
  hash: string,
): {
  planned: Planned | null;
  problems: string[];
  renamed: { sheet: string; from: string; to: string }[];
} {
  const { state, snapshot, env } = input;
  const ownFolders = new Set(state.folders.map((f) => f.id));
  const plan = planPackInstall(
    m,
    {
      ...snapshot,
      installs: snapshot.installs.filter((i) => i.id !== state.installId),
      folders: snapshot.folders.filter((f) => !ownFolders.has(f.id)),
    },
    { ...env, hash },
    { level },
  );
  if (!plan.payload) return { planned: null, problems: plan.preview.conflicts, renamed: [] };
  const p = plan.payload;
  const remap = new Map<string, string>();
  for (const [list, kind] of KINDS)
    for (const r of p[list] as Row[]) {
      const known = state.refMap[`${kind}:${String(r.ref)}`];
      if (known) remap.set(String(r.id), known);
    }
  const swap = (v: Json): Json => {
    if (typeof v === 'string') return remap.get(v) ?? v;
    if (Array.isArray(v)) return v.map(swap);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [remap.get(k) ?? k, swap(x)]));
    return v;
  };
  const byRef = (rows: Row[]) => new Map(rows.map((r) => [String(r.ref), swap(r) as Row]));
  return {
    planned: {
      folders: byRef(p.folders),
      sheets: byRef(p.sheets),
      fields: byRef(p.fields),
      groups: byRef(p.groups),
      views: byRef(p.views),
      items: byRef(p.items),
      automations: byRef(p.automations),
      dashboards: byRef(p.dashboards),
      links: p.links.map((l) => swap(l as unknown as Json) as unknown as Planned['links'][number]),
    },
    problems: [],
    renamed: plan.preview.renamedPrefixes,
  };
}

const pick = (r: Row | undefined, keys: string[]): Attrs =>
  Object.fromEntries(keys.map((k) => [k, r?.[k] ?? (r ? null : undefined)]));

// ───────────────────────── the planner ─────────────────────────

export function planPackUpgrade(input: UpgradeInput): UpgradePlan {
  const { from, to, state } = input;
  const choices = input.choices ?? {};
  const m = to.manifest;
  const preview: UpgradePreview = {
    key: m.key,
    title: m.title,
    from: state.version,
    to: m.version,
    state: 'ready',
    added: [],
    changed: [],
    archived: [],
    kept: [],
    conflicts: [],
    warnings: [],
    blockers: [],
    counts: { added: 0, changed: 0, archived: 0, kept: 0, conflicts: 0 },
  };
  const done = (state: UpgradePreview['state'], payload: UpgradePayload | null): UpgradePlan => {
    preview.state = state;
    preview.counts = {
      added: preview.added.length,
      changed: preview.changed.length,
      archived: preview.archived.length,
      kept: preview.kept.length,
      conflicts: preview.conflicts.length,
    };
    return { state, preview, payload };
  };

  if (from.manifest.key !== m.key) {
    preview.blockers.push('The new version is not the same pack.');
    return done('blocked', null);
  }
  if (compareVersions(m.version, state.version) <= 0) return done('current', null);

  // the level installed; a level the new version dropped falls back to its lowest
  const levelFrom = state.level;
  const levelTo = state.level && levelRank(m, state.level) >= 0 ? state.level : defaultLevel(m);
  const base = planAsInstalled(from.manifest, input, levelFrom, from.hash);
  const theirsPlan = planAsInstalled(m, input, levelTo, to.hash);
  if (!base.planned) {
    preview.blockers.push(
      `The installed version ${state.version} cannot be compared: ${base.problems[0] ?? 'it no longer plans.'}`,
    );
    return done('blocked', null);
  }
  if (!theirsPlan.planned) {
    preview.blockers.push(...theirsPlan.problems);
    return done('blocked', null);
  }
  const B = base.planned;
  const T = theirsPlan.planned;

  // the install as it is now, by ref
  const mineSheets = new Map(state.sheets.map((s) => [s.ref, s]));
  const mineFields = new Map(state.fields.map((f) => [f.ref, f]));
  const mineGroups = new Map(state.groups.map((g) => [g.ref, g]));
  const mineViews = new Map(state.views.map((v) => [v.ref, v]));
  const mineItems = new Map(state.items.map((i) => [i.ref, i]));
  const mineAutos = new Map(state.automations.map((a) => [a.ref, a]));
  const mineDash = new Map(state.dashboards.map((d) => [d.ref, d]));
  const mineFolders = new Map(state.folders.map((f) => [f.ref, f]));
  const installed = (kind: string, ref: string) =>
    typeof state.refMap[`${kind}:${ref}`] === 'string';

  const sheetName = (sheetId: Json | undefined): string => {
    const id = String(sheetId ?? '');
    const s =
      [...T.sheets.values()].find((r) => r.id === id) ??
      [...B.sheets.values()].find((r) => r.id === id);
    return String(s?.name ?? state.sheets.find((x) => x.id === id)?.name ?? '');
  };
  const fieldName = (fieldId: string): string =>
    String(
      [...T.fields.values()].find((r) => r.id === fieldId)?.name ??
        state.fields.find((f) => f.id === fieldId)?.name ??
        'a field',
    );

  const payload: UpgradePayload = {
    pack: {
      key: m.key,
      from_version: state.version,
      from_hash: from.hash,
      version: m.version,
      hash: to.hash,
    },
    install: state.installId,
    add: {
      folders: [],
      sheets: [],
      fields: [],
      groups: [],
      views: [],
      items: [],
      links: [],
      automations: [],
      dashboards: [],
    },
    update: {
      folders: [],
      sheets: [],
      fields: [],
      groups: [],
      views: [],
      items: [],
      automations: [],
      dashboards: [],
    },
    archive: { folders: [], sheets: [], items: [], dashboards: [] },
    disable: { automations: [] },
    summary: { added: 0, changed: 0, archived: 0, kept: 0, conflicts: 0, theirs: 0 },
  };
  let theirsChosen = 0;

  /** Settle one object's merge: what is applied, which conflicts the person settles. */
  const settle = (
    kind: UpgradeObjectKind,
    ref: string,
    name: string,
    merged: { apply: Attrs; conflicts: string[] },
    theirs: Attrs,
    words: (k: string) => string = (k) => ATTR_WORDS[k] ?? k,
  ): Attrs => {
    const out: Attrs = { ...merged.apply };
    if (merged.conflicts.length) {
      const id = `${kind}:${ref}`;
      const choice = choices[id] === 'theirs' ? 'theirs' : 'mine';
      preview.conflicts.push({
        id,
        kind,
        ref,
        name,
        attributes: merged.conflicts.map(words),
        choice,
      });
      if (choice === 'theirs') {
        theirsChosen += 1;
        for (const k of merged.conflicts) out[k] = theirs[k];
      }
    }
    return out;
  };
  const noteOf = (keys: string[], words: (k: string) => string = (k) => ATTR_WORDS[k] ?? k) =>
    capital(sentenceList([...new Set(keys.map(words))]));

  // ── existing objects the new version still ships: three-way per attribute
  const simple = (
    kind: UpgradeObjectKind,
    list: keyof UpgradePayload['update'],
    ref: string,
    name: string,
    id: string,
    keys: string[],
    mine: Attrs,
  ) => {
    const b = pick(B[list].get(ref), keys);
    const t = pick(T[list].get(ref), keys);
    const apply = settle(kind, ref, name, threeWay(b, b, mine, t, keys), t);
    const changedKeys = Object.keys(apply);
    if (!changedKeys.length) return;
    payload.update[list].push({ id, ...(apply as Row) });
    preview.changed.push({ kind, ref, name, note: noteOf(changedKeys) });
  };

  for (const [ref, t] of T.folders) {
    const mine = mineFolders.get(ref);
    if (!mine || mine.archived) continue;
    simple('folder', 'folders', ref, String(t.name), mine.id, ['name'], { name: mine.name });
  }
  for (const [ref, t] of T.sheets) {
    const mine = mineSheets.get(ref);
    if (!mine || mine.archived || mine.parentSheetId) continue;
    simple('sheet', 'sheets', ref, String(t.name), mine.id, ['name', 'description', 'item_label'], {
      name: mine.name,
      description: mine.description,
      item_label: mine.itemLabel,
    });
  }
  for (const [ref, t] of T.groups) {
    const mine = mineGroups.get(ref);
    if (!mine) continue;
    simple(
      'group',
      'groups',
      ref,
      `${sheetName(t.sheet_id)} › ${String(t.name)}`,
      mine.id,
      ['name', 'color'],
      {
        name: mine.name,
        color: mine.color,
      },
    );
  }
  for (const [ref, t] of T.views) {
    const mine = mineViews.get(ref);
    if (!mine) continue;
    const kind = t.type === 'form' ? 'form' : 'view';
    simple(
      kind,
      'views',
      ref,
      `${sheetName(t.sheet_id)} › ${String(t.name)}`,
      mine.id,
      ['name', 'config'],
      {
        name: mine.name,
        config: mine.config,
      },
    );
  }
  for (const [ref, t] of T.automations) {
    const mine = mineAutos.get(ref);
    if (!mine) continue;
    // the on/off state is the client's: never compared, never written
    simple(
      'automation',
      'automations',
      ref,
      String(t.name),
      mine.id,
      ['name', 'trigger', 'conditions', 'actions'],
      {
        name: mine.name,
        trigger: mine.trigger,
        conditions: mine.conditions,
        actions: mine.actions,
      },
    );
  }
  for (const [ref, t] of T.dashboards) {
    const mine = mineDash.get(ref);
    if (!mine || mine.archived) continue;
    simple('dashboard', 'dashboards', ref, String(t.name), mine.id, ['name', 'config'], {
      name: mine.name,
      config: mine.config,
    });
  }

  // fields: add-only. Name, description, required and locked merge like any attribute; settings merge per key with
  // the options merged on their own; the type never changes.
  for (const [ref, t] of T.fields) {
    const mine = mineFields.get(ref);
    if (!mine || mine.archived) continue;
    const b = B.fields.get(ref);
    const name = `${sheetName(t.sheet_id)} › ${String(t.name)}`;
    if (b && t.type !== b.type) {
      preview.kept.push({
        kind: 'field',
        ref,
        name,
        note: `Stays a ${mine.type} field: an upgrade never changes a field's type.`,
      });
      continue;
    }
    const keys = ['name', 'description', 'required', 'locked'];
    const bAttrs = pick(b, keys);
    const tAttrs = pick(t, keys);
    const mAttrs: Attrs = {
      name: mine.name,
      description: mine.description,
      required: mine.required,
      locked: mine.locked,
    };
    const top = threeWay(bAttrs, bAttrs, mAttrs, tAttrs, keys);
    // settings, key by key, without the options
    const bc = isObj(b?.config) ? b!.config : {};
    const tc = isObj(t.config) ? t.config : {};
    const mc = isObj(mine.config) ? mine.config : {};
    const cfgKeys = [...new Set([...Object.keys(bc), ...Object.keys(tc)])].filter(
      (k) => k !== 'options',
    );
    const cfg = threeWay(bc as Attrs, bc as Attrs, mc as Attrs, tc as Attrs, cfgKeys);
    const merged = {
      apply: { ...top.apply },
      conflicts: [...top.conflicts, ...cfg.conflicts.map((k) => `config.${k}`)],
    };
    const words = (k: string) => (k.startsWith('config.') ? 'settings' : (ATTR_WORDS[k] ?? k));
    const theirsAll: Attrs = {
      ...tAttrs,
      ...Object.fromEntries(cfgKeys.map((k) => [`config.${k}`, tc[k]])),
    };
    const out = settle('field', ref, name, merged, theirsAll, words);
    const settingsChanged =
      Object.keys(cfg.apply).length > 0 || Object.keys(out).some((k) => k.startsWith('config.'));
    const notes: string[] = Object.keys(out)
      .filter((k) => !k.startsWith('config.'))
      .map((k) => ATTR_WORDS[k] ?? k);
    if (settingsChanged) notes.push('settings');
    const config: Record<string, Json> = { ...mc };
    let configChanged = false;
    const setCfg = (k: string, v: Json | undefined) => {
      if (v === undefined) delete config[k];
      else config[k] = v;
      configChanged = true;
    };
    for (const [k, v] of Object.entries(cfg.apply)) setCfg(k, v);
    for (const k of Object.keys(out))
      if (k.startsWith('config.')) {
        setCfg(k.slice(7), out[k]);
        delete out[k];
      }
    const opts = mergeOptions(optionsOf(bc), optionsOf(mc), optionsOf(tc));
    if (opts.changed) setCfg('options', opts.options as unknown as Json);
    if (opts.added.length) notes.push(`new options ${sentenceList(opts.added)}`);
    else if (opts.changed) notes.push('options');
    if (configChanged) out.config = config;
    if (!Object.keys(out).length) continue;
    payload.update.fields.push({ id: mine.id, ...(out as Row) });
    preview.changed.push({
      kind: 'field',
      ref,
      name,
      note: capital(sentenceList([...new Set(notes.length ? notes : ['settings'])])),
    });
  }

  // items: name, group and each value the pack sets, against what the install wrote
  for (const [ref, t] of T.items) {
    const mine = mineItems.get(ref);
    if (!mine || mine.archived) continue;
    const b = B.items.get(ref);
    const kind: UpgradeObjectKind = mine.requirementRef ? 'requirement' : 'item';
    const name = `${sheetName(t.sheet_id)} › ${String(t.name)}`;
    const bv = isObj(b?.values) ? b!.values : {};
    const tv = isObj(t.values) ? t.values : {};
    const valueKeys = [...new Set([...Object.keys(bv), ...Object.keys(tv)])];
    const inst = mine.installed;
    const iv = inst?.values ?? (bv as Record<string, Json>);
    const packBase: Attrs = {
      name: b?.name,
      group_id: b?.group_id,
      ...Object.fromEntries(valueKeys.map((k) => [`v:${k}`, bv[k]])),
    };
    const clientBase: Attrs = {
      name: inst?.name ?? b?.name,
      group_id: inst?.groupId ?? b?.group_id,
      ...Object.fromEntries(valueKeys.map((k) => [`v:${k}`, iv[k]])),
    };
    const mineA: Attrs = {
      name: mine.name,
      group_id: mine.groupId,
      ...Object.fromEntries(valueKeys.map((k) => [`v:${k}`, mine.values[k]])),
    };
    const theirsA: Attrs = {
      name: t.name,
      group_id: t.group_id,
      ...Object.fromEntries(valueKeys.map((k) => [`v:${k}`, tv[k]])),
    };
    // a group the client no longer has is not moved into
    const words = (k: string) =>
      k.startsWith('v:') ? fieldName(k.slice(2)) : (ATTR_WORDS[k] ?? k);
    const out = settle(
      kind,
      ref,
      name,
      threeWay(packBase, clientBase, mineA, theirsA),
      theirsA,
      words,
    );
    if (out.group_id !== undefined && !state.groups.some((g) => g.id === out.group_id))
      delete out.group_id;
    const keys = Object.keys(out);
    if (!keys.length) continue;
    const row: Row = { id: mine.id };
    const values: Record<string, Json> = {};
    for (const k of keys)
      if (k.startsWith('v:')) values[k.slice(2)] = out[k] === undefined ? null : out[k]!;
      else row[k] = out[k] ?? null;
    if (Object.keys(values).length) row.values = values;
    payload.update.items.push(row);
    preview.changed.push({ kind, ref, name, note: noteOf(keys, words) });
  }

  // ── objects the new version adds
  const addedIds = new Set<string>();
  const existingSheetIds = new Set(state.sheets.filter((s) => !s.archived).map((s) => s.id));
  const existingGroupIds = new Set(state.groups.map((g) => g.id));
  const newSheet = (r: Row) => !installed('sheet', String(r.ref));
  // a sub-item sheet joins only with its parent: sub-items are not added to a sheet that is already installed
  const addedSheets = [...T.sheets.values()].filter((r) => {
    if (!newSheet(r)) return false;
    const parent = r.parent_sheet_id ? String(r.parent_sheet_id) : null;
    if (parent && existingSheetIds.has(parent)) {
      preview.kept.push({
        kind: 'sheet',
        ref: String(r.ref),
        name: String(r.name),
        note: 'Sub-items are not added to a sheet you already have.',
      });
      return false;
    }
    return true;
  });
  for (const r of addedSheets) addedIds.add(String(r.id));
  const sheetOk = (id: Json | undefined) =>
    existingSheetIds.has(String(id)) || addedIds.has(String(id));

  for (const r of T.folders.values())
    if (!installed('folder', String(r.ref))) {
      payload.add.folders.push(r);
      addedIds.add(String(r.id));
      preview.added.push({ kind: 'folder', ref: String(r.ref), name: String(r.name) });
    }
  for (const r of addedSheets) {
    payload.add.sheets.push(r);
    if (!r.parent_sheet_id)
      preview.added.push({ kind: 'sheet', ref: String(r.ref), name: String(r.name) });
  }
  for (const s of theirsPlan.renamed)
    if (addedSheets.some((r) => r.name === s.sheet))
      preview.warnings.push(
        `${s.sheet} uses the prefix ${s.to}: ${s.from} is taken in this workspace.`,
      );

  const appendAt = (
    rows: Row[],
    keyOf: (r: Row) => string,
    last: Record<string, string>,
  ): Row[] => {
    const byParent = new Map<string, Row[]>();
    for (const r of rows) byParent.set(keyOf(r), [...(byParent.get(keyOf(r)) ?? []), r]);
    const out: Row[] = [];
    for (const [parent, list] of byParent) {
      if (!last[parent] && !existingSheetIds.has(parent) && !existingGroupIds.has(parent)) {
        out.push(...list); // a new sheet or group: the plan's own positions
        continue;
      }
      const keys = keysBetween(last[parent] ?? null, null, list.length);
      list.forEach((r, i) => out.push({ ...r, position: keys[i]! }));
    }
    return out;
  };

  const newGroups = [...T.groups.values()].filter(
    (r) => !installed('group', String(r.ref)) && sheetOk(r.sheet_id),
  );
  payload.add.groups = appendAt(newGroups, (r) => String(r.sheet_id), state.lastPosition.groups);
  const newFields = [...T.fields.values()].filter((r) => {
    if (installed('field', String(r.ref)) || !sheetOk(r.sheet_id)) return false;
    if (existingSheetIds.has(String(r.sheet_id)) && r.type === 'subitems') return false;
    return true;
  });
  payload.add.fields = appendAt(newFields, (r) => String(r.sheet_id), state.lastPosition.fields);
  const newViews = [...T.views.values()].filter(
    (r) => !installed('view', String(r.ref)) && sheetOk(r.sheet_id),
  );
  payload.add.views = appendAt(newViews, (r) => String(r.sheet_id), state.lastPosition.views);
  for (const r of [...payload.add.groups, ...payload.add.fields, ...payload.add.views])
    addedIds.add(String(r.id));
  const groupOk = (id: Json | undefined) =>
    existingGroupIds.has(String(id)) || addedIds.has(String(id));
  const newItems = [...T.items.values()].filter(
    (r) => !installed('item', String(r.ref)) && sheetOk(r.sheet_id) && groupOk(r.group_id),
  );
  payload.add.items = appendAt(newItems, (r) => String(r.group_id), state.lastPosition.items);
  for (const r of payload.add.items) addedIds.add(String(r.id));
  for (const r of newGroups)
    if (existingSheetIds.has(String(r.sheet_id)))
      preview.added.push({
        kind: 'group',
        ref: String(r.ref),
        name: `${sheetName(r.sheet_id)} › ${String(r.name)}`,
      });
  for (const r of newFields)
    if (existingSheetIds.has(String(r.sheet_id)))
      preview.added.push({
        kind: 'field',
        ref: String(r.ref),
        name: `${sheetName(r.sheet_id)} › ${String(r.name)}`,
      });
  for (const r of newViews)
    if (existingSheetIds.has(String(r.sheet_id)))
      preview.added.push({
        kind: r.type === 'form' ? 'form' : 'view',
        ref: String(r.ref),
        name: `${sheetName(r.sheet_id)} › ${String(r.name)}`,
      });
  for (const r of newItems)
    preview.added.push({
      kind: r.requirement_ref ? 'requirement' : 'item',
      ref: String(r.ref),
      name: `${sheetName(r.sheet_id)} › ${String(r.name)}`,
    });

  // links: only from an item or through a field this upgrade adds (links the client made or removed stay theirs)
  // The target is an item added now, an item the install has, or an item outside the pack (a library's requirement).
  const plannedItemIds = new Set([...T.items.values()].map((r) => String(r.id)));
  const stateItemIds = new Set(state.items.map((i) => i.id));
  const stateFieldIds = new Set(state.fields.map((f) => f.id));
  payload.add.links = T.links.filter(
    (l) =>
      (addedIds.has(l.from_item) || addedIds.has(l.field_id)) &&
      (addedIds.has(l.from_item) || stateItemIds.has(l.from_item)) &&
      (addedIds.has(l.field_id) || stateFieldIds.has(l.field_id)) &&
      (addedIds.has(l.to_item) || stateItemIds.has(l.to_item) || !plannedItemIds.has(l.to_item)),
  );

  for (const r of T.automations.values())
    if (!installed('automation', String(r.ref))) {
      if (!sheetOk(r.sheet_id)) {
        preview.kept.push({
          kind: 'automation',
          ref: String(r.ref),
          name: String(r.name),
          note: 'Not added: it belongs to sub-items this upgrade does not add.',
        });
        continue;
      }
      payload.add.automations.push(r);
      preview.added.push({
        kind: 'automation',
        ref: String(r.ref),
        name: String(r.name),
        ...(r.enabled ? {} : { note: 'Added off.' }),
      });
    }
  for (const r of T.dashboards.values())
    if (!installed('dashboard', String(r.ref))) {
      payload.add.dashboards.push(r);
      preview.added.push({ kind: 'dashboard', ref: String(r.ref), name: String(r.name) });
    }

  // ── objects the new version no longer ships (in the installed version, not in the new one)
  const archivedSheets = new Set<string>();
  for (const [ref, b] of B.sheets) {
    if (T.sheets.has(ref) || b.parent_sheet_id) continue;
    const mine = mineSheets.get(ref);
    if (!mine || mine.archived) continue;
    const touched = state.items.some(
      (i) => i.sheetId === mine.id && !i.archived && !untouchedItem(i),
    );
    if (mine.clientItems > 0 || touched) {
      preview.kept.push({
        kind: 'sheet',
        ref,
        name: mine.name,
        note: 'No longer in the pack. Kept: it holds items you added or changed.',
      });
      continue;
    }
    archivedSheets.add(mine.id);
    payload.archive.sheets.push(mine.id);
    preview.archived.push({
      kind: 'sheet',
      ref,
      name: mine.name,
      note: 'Restorable from Archived.',
    });
  }
  for (const [ref] of B.items) {
    if (T.items.has(ref)) continue;
    const mine = mineItems.get(ref);
    if (!mine || mine.archived || archivedSheets.has(mine.sheetId)) continue;
    const name = `${state.sheets.find((s) => s.id === mine.sheetId)?.name ?? ''} › ${mine.name}`;
    if (mine.requirementRef) {
      preview.kept.push({
        kind: 'requirement',
        ref,
        name,
        note: 'A requirement is never removed.',
      });
      continue;
    }
    if (!untouchedItem(mine)) {
      preview.kept.push({
        kind: 'item',
        ref,
        name,
        note: 'No longer in the pack. Kept: you changed it.',
      });
      continue;
    }
    payload.archive.items.push(mine.id);
    preview.archived.push({ kind: 'item', ref, name });
  }
  for (const [ref, b] of B.fields) {
    if (T.fields.has(ref)) continue;
    const mine = mineFields.get(ref);
    if (!mine || mine.archived || archivedSheets.has(mine.sheetId)) continue;
    preview.kept.push({
      kind: 'field',
      ref,
      name: `${sheetName(b.sheet_id)} › ${mine.name}`,
      note: 'No longer in the pack. Kept: fields are never removed.',
    });
  }
  for (const [ref, b] of B.views) {
    if (T.views.has(ref)) continue;
    const mine = mineViews.get(ref);
    if (!mine || archivedSheets.has(mine.sheetId)) continue;
    preview.kept.push({
      kind: mine.type === 'form' ? 'form' : 'view',
      ref,
      name: `${sheetName(b.sheet_id)} › ${mine.name}`,
      note: 'No longer in the pack. Kept.',
    });
  }
  for (const [ref] of B.automations) {
    if (T.automations.has(ref)) continue;
    const mine = mineAutos.get(ref);
    if (!mine) continue;
    if (!mine.enabled) continue;
    payload.disable.automations.push(mine.id);
    preview.archived.push({ kind: 'automation', ref, name: mine.name, note: 'Turned off.' });
  }
  for (const [ref, b] of B.dashboards) {
    if (T.dashboards.has(ref)) continue;
    const mine = mineDash.get(ref);
    if (!mine || mine.archived) continue;
    if (!sameJson(mine.config, b.config) || mine.name !== b.name) {
      preview.kept.push({
        kind: 'dashboard',
        ref,
        name: mine.name,
        note: 'No longer in the pack. Kept: you changed it.',
      });
      continue;
    }
    payload.archive.dashboards.push(mine.id);
    preview.archived.push({ kind: 'dashboard', ref, name: mine.name });
  }
  for (const [ref] of B.folders) {
    if (T.folders.has(ref)) continue;
    const mine = mineFolders.get(ref);
    if (!mine || mine.archived) continue;
    const live = state.sheets.some(
      (s) => s.folderId === mine.id && !s.archived && !archivedSheets.has(s.id),
    );
    if (live) {
      preview.kept.push({
        kind: 'folder',
        ref,
        name: mine.name,
        note: 'No longer in the pack. Kept: it has sheets.',
      });
      continue;
    }
    payload.archive.folders.push(mine.id);
    preview.archived.push({ kind: 'folder', ref, name: mine.name });
  }

  payload.summary = {
    added: preview.added.length,
    changed: preview.changed.length,
    archived: preview.archived.length,
    kept: preview.kept.length,
    conflicts: preview.conflicts.length,
    theirs: theirsChosen,
  };
  return done('ready', payload);

  function untouchedItem(i: InstalledState['items'][number]): boolean {
    if (!i.installed) return false;
    return (
      i.name === i.installed.name &&
      i.groupId === i.installed.groupId &&
      sameJson(i.values, i.installed.values)
    );
  }
}

/** The preview as lines of plain text (logs and tests). */
export function upgradeLines(p: UpgradePreview): string[] {
  if (p.state === 'current') return [`${p.title} ${p.from} is the newest version.`];
  if (p.state === 'blocked') return [`${p.title} cannot be updated to ${p.to}.`, ...p.blockers];
  const out = [`Updates ${p.title} from ${p.from} to ${p.to}.`];
  for (const a of p.added) out.push(`Adds ${a.kind} ${a.name}${a.note ? ` (${a.note})` : ''}.`);
  for (const c of p.changed) out.push(`Changes ${c.kind} ${c.name}: ${c.note ?? 'updated'}.`);
  for (const a of p.archived)
    out.push(`Archives ${a.kind} ${a.name}${a.note ? ` (${a.note})` : ''}.`);
  for (const k of p.kept) out.push(`Keeps ${k.kind} ${k.name}: ${k.note ?? ''}`);
  for (const c of p.conflicts)
    out.push(
      `Conflict on ${c.kind} ${c.name}: you and the pack both changed ${sentenceList(c.attributes)}. ${c.choice === 'theirs' ? 'Takes the pack’s.' : 'Keeps yours.'}`,
    );
  out.push(...p.warnings);
  return out;
}
