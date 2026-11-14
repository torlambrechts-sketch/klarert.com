// Extends (docs/11 Extends, Core registers): a pack adds columns, groups, views, forms, example items, automations and
// options to sheets of a pack it requires (an add-on to the Core registers), and its own sheets may link to those
// sheets and sit in their domain folders. Pure. Every row an extension adds is the extender's own (its provenance and
// ref map), so upgrade and archive stay per pack; refs are `<pack>:<sheet>.<…>` and field keys, group, item and form
// refs and option ids are in the extender's namespace.
//
// The planner plans an extension with the template planner, the same way as the pack's own sheets: each foreign
// sheet the pack reaches into becomes a virtual sheet of the template (its existing columns and groups, plus what the
// extension adds), and afterwards the virtual rows are swapped for the real ids and only the new rows are kept.
import type { Json } from '../types';
import { fieldType } from '../fields/registry';
import { levelRank } from './levels';
import {
  splitSheetRef,
  type ExtensionOption,
  type PackExtension,
  type PackManifest,
  type PackSheet,
} from './types';

type Obj = Record<string, Json>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** The shared "Standards" field of the Core registers (docs/11 Core registers): add-ons add their option to it. */
export const STANDARDS_KEY = 'standards';

/** A pack's namespace: its key without "-" (`iso-14001` → `iso14001`). */
export const namespaceOf = (packKey: string) => packKey.replace(/[^a-z0-9]/g, '');

/** An id or key in a namespace: the namespace itself or `<namespace>_…`. */
export const inNamespace = (ns: string, id: string) => id === ns || id.startsWith(`${ns}_`);

/** `<pack>:<sheet>`: how a foreign sheet is named in a manifest, a snapshot and a ref. */
export const foreignKey = (pack: string, sheet: string) => `${pack}:${sheet}`;

/** The foreign sheet's ref inside the planner's template (a plain ref, so `$item:` tokens and links resolve). */
export const virtualRef = (pack: string, sheet: string) =>
  `ext__${pack.replace(/-/g, '_')}__${sheet}`;

export interface ForeignField {
  id: string;
  key: string;
  name: string;
  type: string;
  config: Json;
  required: boolean;
  locked: boolean;
  description: string | null;
  /** The install that made it (null: added by people). */
  installId: string | null;
}

/** A live sheet of an installed pack this manifest requires, as the planner needs it. */
export interface ForeignSheet {
  sheetId: string;
  pack: string;
  /** The sheet's ref in its pack. */
  ref: string;
  name: string;
  itemLabel: string;
  idPrefix: string;
  /** Live fields. */
  fields: ForeignField[];
  /** `ref`: the group's ref in its sheet (`open` of `risk.open`), null for groups people added. */
  groups: {
    id: string;
    ref: string | null;
    name: string;
    color: string;
    installId: string | null;
  }[];
  lastFieldPosition: string | null;
  lastGroupPosition: string | null;
  lastViewPosition: string | null;
  /** group id → the last live item's position */
  lastItemPosition: Record<string, string>;
}

/** Every foreign sheet a manifest reaches into: extends targets, link targets and the sheets actions name. */
export function foreignSheets(m: PackManifest): { pack: string; sheet: string }[] {
  const out = new Map<string, { pack: string; sheet: string }>();
  const add = (raw: unknown) => {
    if (typeof raw !== 'string') return;
    const s = splitSheetRef(raw, m.key);
    if (s?.pack) out.set(foreignKey(s.pack, s.ref), { pack: s.pack, sheet: s.ref });
  };
  for (const e of m.extends ?? []) {
    out.set(foreignKey(e.pack, e.sheet), { pack: e.pack, sheet: e.sheet });
    for (const f of e.fields ?? []) add((f.config as Obj | undefined)?.targetSheetRef);
    for (const a of e.automations ?? []) for (const x of a.actions) add(x.sheetRef);
  }
  for (const s of m.sheets)
    for (const f of s.fields) add((f.config as Obj | undefined)?.targetSheetRef);
  // an add-on's dashboard widgets may read a required pack's sheets (its tagged rows of a Core register)
  for (const d of m.dashboards) for (const w of d.widgets) add(w.sheetRef);
  return [...out.values()];
}

/** Folders of required packs the manifest's sheets sit in (`<pack>:<folder ref>`). */
export const foreignFolders = (m: PackManifest): string[] => [
  ...new Set(m.sheets.flatMap((s) => (s.folder?.includes(':') ? [s.folder] : []))),
];

/** The standard view's name on an extended sheet. */
export const standardViewName = (label: string) => `${label} view`;

const OPTION_TYPES = (type: string) => !!fieldType(type)?.options && type !== 'people';

/** Problems with a manifest's extends and foreign references that need no other manifest (manifest.ts reports them). */
export function extendsProblems(m: PackManifest): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  const problem = (path: (string | number)[], message: string) => out.push({ path, message });
  const ns = namespaceOf(m.key);
  const required = new Set(m.requires.map((r) => r.pack));
  const own = new Map(m.sheets.map((s) => [s.ref, s]));
  const nsWord = (what: string, id: string) =>
    `${what} "${id}" is not in the pack's namespace: use "${ns}" or start it with "${ns}_".`;
  const foreignOk = (raw: unknown, path: (string | number)[]) => {
    if (typeof raw !== 'string') return;
    const s = splitSheetRef(raw, m.key);
    if (!s) problem(path, `"${raw}" is not a sheet ref.`);
    else if (s.pack && !required.has(s.pack))
      problem(path, `"${raw}" names the pack "${s.pack}", which is not in requires.`);
    else if (!s.pack && !own.has(s.ref)) problem(path, `Unknown sheet "${raw}".`);
  };
  if (m.standard && !inNamespace(ns, m.standard.id))
    problem(['standard', 'id'], nsWord('The standard id', m.standard.id));

  const autoRefs = new Set(m.automations.map((a) => a.ref));
  const seen = new Set<string>();
  for (const [ei, e] of (m.extends ?? []).entries()) {
    const at = (...p: (string | number)[]) => ['extends', ei, ...p];
    const target = foreignKey(e.pack, e.sheet);
    if (e.pack === m.key) problem(at('pack'), 'A pack extends the packs it requires, not itself.');
    else if (!required.has(e.pack))
      problem(
        at('pack'),
        `The pack "${e.pack}" is not in requires: a pack extends only what it requires.`,
      );
    if (seen.has(target)) problem(at(), `"${target}" is extended twice: use one entry.`);
    seen.add(target);

    const keys = new Set<string>();
    for (const [fi, f] of (e.fields ?? []).entries()) {
      if (!inNamespace(ns, f.key)) problem(at('fields', fi), nsWord('The field key', f.key));
      if (keys.has(f.key)) problem(at('fields', fi), `Duplicate field key "${f.key}".`);
      keys.add(f.key);
      if (f.type === 'subitems')
        problem(at('fields', fi), 'Sub-items cannot be added to another pack’s sheet.');
      const cfg = (f.config ?? {}) as Obj;
      foreignOk(cfg.targetSheetRef, at('fields', fi));
      if (typeof cfg.targetSheetRef === 'string' && typeof cfg.inverseKey === 'string') {
        const s = splitSheetRef(cfg.targetSheetRef, m.key);
        const back =
          s && !s.pack ? own.get(s.ref)?.fields.find((x) => x.key === cfg.inverseKey) : null;
        const bc = (back?.config ?? {}) as Obj;
        if (!back || bc.targetSheetRef !== target || bc.inverseKey !== f.key)
          problem(
            at('fields', fi),
            `The inverse "${cfg.inverseKey}" must link back to "${target}" through "${f.key}".`,
          );
      }
    }
    const groups = new Set<string>();
    for (const [gi, g] of (e.groups ?? []).entries()) {
      if (!inNamespace(ns, g.ref)) problem(at('groups', gi), nsWord('The group ref', g.ref));
      if (groups.has(g.ref)) problem(at('groups', gi), `Duplicate group ref "${g.ref}".`);
      groups.add(g.ref);
    }
    const forms = new Set<string>();
    for (const [fi, f] of (e.forms ?? []).entries()) {
      if (!inNamespace(ns, f.ref)) problem(at('forms', fi), nsWord('The form ref', f.ref));
      if (forms.has(f.ref)) problem(at('forms', fi), `Duplicate form ref "${f.ref}".`);
      forms.add(f.ref);
    }
    const items = new Set<string>();
    for (const [ii, item] of (e.items ?? []).entries()) {
      if (!inNamespace(ns, item.ref)) problem(at('items', ii), nsWord('The item ref', item.ref));
      if (items.has(item.ref)) problem(at('items', ii), `Duplicate item ref "${item.ref}".`);
      items.add(item.ref);
      if (item.requirementRef)
        problem(at('items', ii), 'Library items cannot be added to another pack’s sheet.');
      for (const [key, refs] of Object.entries(item.links ?? {})) {
        const f = (e.fields ?? []).find((x) => x.key === key);
        if (!f) {
          // a link field the sheet has: only to items this pack adds to its target (checked by extendsAgainst)
          for (const r of refs)
            if (
              !inNamespace(ns, r) ||
              !(m.extends ?? []).some((x) => x.items?.some((i) => i.ref === r))
            )
              problem(
                at('items', ii),
                `"${r}" is not an item this pack adds to another pack's sheet.`,
              );
          continue;
        }
        const raw = (f.config as Obj | undefined)?.targetSheetRef;
        const s = typeof raw === 'string' ? splitSheetRef(raw, m.key) : null;
        if (!s || s.pack) {
          problem(
            at('items', ii),
            `"${key}" is not a link field this entry adds to one of the pack's sheets.`,
          );
          continue;
        }
        for (const r of refs)
          if (!own.get(s.ref)?.items.some((x) => x.ref === r))
            problem(at('items', ii), `Unknown linked item "${r}" on "${s.ref}".`);
      }
    }
    for (const [ai, a] of (e.automations ?? []).entries()) {
      if (autoRefs.has(a.ref))
        problem(at('automations', ai), `Duplicate automation ref "${a.ref}".`);
      autoRefs.add(a.ref);
      if (a.subitems)
        problem(
          at('automations', ai),
          'Automations on another pack’s sub-items are not available.',
        );
      for (const x of a.actions) foreignOk(x.sheetRef, at('automations', ai));
    }
    for (const [key, opts] of Object.entries(e.options ?? {})) {
      const ids = new Set<string>();
      for (const o of opts) {
        if (!inNamespace(ns, o.id)) problem(at('options', key), nsWord('The option id', o.id));
        if (ids.has(o.id)) problem(at('options', key), `Duplicate option "${o.id}".`);
        ids.add(o.id);
      }
    }
  }

  // own sheets: a link into a required pack's sheet that goes both ways needs its inverse in that sheet's extends
  for (const [si, s] of m.sheets.entries())
    for (const [fi, f] of s.fields.entries()) {
      const cfg = (f.config ?? {}) as Obj;
      if (typeof cfg.targetSheetRef !== 'string' || typeof cfg.inverseKey !== 'string') continue;
      const t = splitSheetRef(cfg.targetSheetRef, m.key);
      if (!t?.pack) continue;
      const ext = (m.extends ?? []).find((e) => e.pack === t.pack && e.sheet === t.ref);
      const inv = ext?.fields?.find((x) => x.key === cfg.inverseKey);
      const ic = (inv?.config ?? {}) as Obj;
      if (!inv || ic.targetSheetRef !== s.ref || ic.inverseKey !== f.key)
        problem(
          ['sheets', si, 'fields', fi],
          `"${f.key}" links both ways to "${cfg.targetSheetRef}": add "${cfg.inverseKey}" there in extends, linking back.`,
        );
    }
  return out;
}

/** Field keys of `{key}` references in a formula. */
const formulaKeys = (expr: unknown): string[] =>
  typeof expr === 'string' ? [...expr.matchAll(/\{([a-z][a-z0-9_]*)\}/g)].map((x) => x[1]!) : [];

/**
 * What a manifest uses of another pack's sheets (sheet ref → field keys): the sheets it extends or links to and every
 * field key of those sheets its views, forms, items, options, automations, formulas and lookups name. An upgrade of
 * that pack may not remove or retype any of them (docs/11 Extends).
 */
export function extensionUses(m: PackManifest, depKey: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const mark = (sheet: string, key?: string) => {
    const set = out.get(sheet) ?? new Set<string>();
    if (key) set.add(key);
    out.set(sheet, set);
  };
  const keysIn = (v: unknown, into: (k: string) => void) => {
    if (Array.isArray(v)) v.forEach((x) => keysIn(x, into));
    else if (isObj(v))
      for (const [k, x] of Object.entries(v)) {
        if (
          (k === 'fieldKey' ||
            k === 'whenFieldKey' ||
            k === 'labelFieldKey' ||
            k === 'dateFieldKey' ||
            k === 'key') &&
          typeof x === 'string'
        )
          into(x);
        else keysIn(x, into);
      }
  };
  for (const e of m.extends ?? []) {
    if (e.pack !== depKey) continue;
    mark(e.sheet);
    const own = new Set((e.fields ?? []).map((f) => f.key));
    const add = (k: string) => {
      if (!own.has(k)) mark(e.sheet, k);
    };
    for (const v of e.views ?? []) {
      keysIn(v.config, add);
      const hidden = (v.config as Obj).hidden;
      if (Array.isArray(hidden)) hidden.forEach((h) => typeof h === 'string' && add(h));
    }
    for (const f of e.forms ?? [])
      keysIn([f.layout.fields, f.settings?.prefill ?? []] as unknown as Json, add);
    for (const i of e.items ?? []) {
      Object.keys(i.values).forEach(add);
      Object.keys(i.links ?? {}).forEach(add);
    }
    for (const k of Object.keys(e.options ?? {})) add(k);
    for (const a of e.automations ?? []) {
      keysIn([a.trigger, ...a.conditions] as unknown as Json, add);
      for (const x of a.actions)
        if (typeof x.sheetRef !== 'string') keysIn(x as unknown as Json, add);
    }
    for (const f of e.fields ?? []) {
      const cfg = (f.config ?? {}) as Obj;
      formulaKeys(cfg.expr).forEach(add);
      for (const k of ['sourceFieldKey', 'linkFieldKey'] as const)
        if (typeof cfg[k] === 'string') add(cfg[k]);
      keysIn([f.rules ?? [], f.visibility ?? null] as unknown as Json, add);
    }
  }
  // dashboard widgets on the dependency's sheets: the field they show and the fields their conditions name
  for (const d of m.dashboards)
    for (const w of d.widgets) {
      const t = w.sheetRef ? splitSheetRef(w.sheetRef, m.key) : null;
      if (!t || t.pack !== depKey) continue;
      mark(t.ref, w.fieldKey);
      for (const c of w.conditions ?? []) mark(t.ref, c.fieldKey);
    }
  // the pack's own links into the dependency's sheets, and what lookups and roll-ups read through them
  for (const s of m.sheets)
    for (const f of s.fields) {
      const raw = (f.config as Obj | undefined)?.targetSheetRef;
      const t = typeof raw === 'string' ? splitSheetRef(raw, m.key) : null;
      if (!t || t.pack !== depKey) continue;
      mark(t.ref);
      for (const x of s.fields) {
        const c = (x.config ?? {}) as Obj;
        if (c.linkFieldKey === f.key && typeof c.targetFieldKey === 'string')
          mark(t.ref, c.targetFieldKey);
      }
    }
  return out;
}

/**
 * The lowest level of a required pack that installs every sheet and folder this manifest needs from it; null when it
 * has no levels (it installs whole).
 */
export function neededLevel(m: PackManifest, dep: PackManifest): string | null {
  if (!dep.levels?.length) return null;
  let rank = 0;
  const rankOf = (l: string | undefined) => Math.max(0, levelRank(dep, l));
  for (const f of foreignSheets(m)) {
    if (f.pack !== dep.key) continue;
    const s = dep.sheets.find((x) => x.ref === f.sheet);
    if (s) rank = Math.max(rank, rankOf(s.level));
  }
  for (const raw of foreignFolders(m)) {
    const [pack, ref] = raw.split(':');
    if (pack !== dep.key) continue;
    const f = dep.folders.find((x) => x.ref === ref);
    if (f) rank = Math.max(rank, rankOf(f.level));
  }
  return dep.levels[rank]!.key;
}

/**
 * Problems of a manifest's extends against the manifest of the pack it extends (the catalogue's checks): the sheet,
 * its groups and every field key used exist; option fields are option fields; new keys are new.
 */
export function extendsAgainst(m: PackManifest, dep: PackManifest): string[] {
  const out: string[] = [];
  for (const [sheetRef, keys] of extensionUses(m, dep.key)) {
    const s = dep.sheets.find((x) => x.ref === sheetRef);
    if (!s) {
      out.push(`"${dep.key}:${sheetRef}" is not a sheet of ${dep.key}.`);
      continue;
    }
    for (const k of keys)
      if (!s.fields.some((f) => f.key === k)) out.push(`${s.name} has no field "${k}".`);
  }
  for (const e of m.extends ?? []) {
    if (e.pack !== dep.key) continue;
    const s = dep.sheets.find((x) => x.ref === e.sheet);
    if (!s) continue;
    for (const f of e.fields ?? [])
      if (s.fields.some((x) => x.key === f.key))
        out.push(`${s.name} already has a field "${f.key}".`);
    for (const key of Object.keys(e.options ?? {})) {
      const f = s.fields.find((x) => x.key === key) ?? e.fields?.find((x) => x.key === key);
      if (f && !OPTION_TYPES(f.type)) out.push(`${s.name} › ${f.name} has no options to add to.`);
    }
    for (const i of e.items ?? [])
      for (const [key, refs] of Object.entries(i.links ?? {})) {
        if (e.fields?.some((x) => x.key === key)) continue;
        const f = s.fields.find((x) => x.key === key);
        const target = (f?.config as Obj | undefined)?.targetSheetRef;
        if (!f || f.type !== 'link' || typeof target !== 'string') {
          out.push(`${s.name} has no link field "${key}".`);
          continue;
        }
        const into = (m.extends ?? []).find((x) => x.pack === dep.key && x.sheet === target);
        for (const r of refs)
          if (!into?.items?.some((x) => x.ref === r))
            out.push(
              `${s.name} › ${f.name} links to "${r}", which this pack does not add to "${target}".`,
            );
      }
    const groups = new Set([...s.groups.map((g) => g.ref), ...(e.groups ?? []).map((g) => g.ref)]);
    for (const i of e.items ?? [])
      if (!groups.has(i.group)) out.push(`${s.name} has no group "${i.group}".`);
    for (const f of e.forms ?? [])
      if (f.groupRef && !groups.has(f.groupRef))
        out.push(`${s.name} has no group "${f.groupRef}".`);
  }
  return out;
}

// ───────────────────────── the planner's view ─────────────────────────

export interface VirtualSheet {
  /** `<pack>:<sheet>` */
  key: string;
  pack: string;
  sheet: string;
  foreign: ForeignSheet;
  /** Keys of the sheet's existing fields (planned for reference only, never written). */
  existingFields: Map<string, string>;
  /** Group refs of the sheet's existing groups → their ids. */
  existingGroups: Map<string, string>;
  /** How many views the extension adds before the standard view (refs `<key>.view.<n>`). */
  extensionViews: number;
  standardView: boolean;
}

export interface OptionAddition {
  /** `<pack>:<sheet>.<field key>.<option id>` */
  ref: string;
  fieldId: string;
  fieldKey: string;
  sheetName: string;
  fieldName: string;
  option: ExtensionOption;
}

export interface Augmented {
  /** The manifest with a virtual sheet per foreign sheet and the extension automations among its own. */
  manifest: PackManifest;
  /** vref → the foreign sheet it stands for */
  virtual: Map<string, VirtualSheet>;
  options: OptionAddition[];
  /** Why the extension cannot be planned (conflicts). */
  problems: string[];
  /** Foreign sheets of packs installed first (the install plans again then). */
  pending: string[];
}

/**
 * The manifest as the planner plans it: every foreign sheet it reaches into becomes a virtual sheet (its existing
 * fields, with the options added, and groups; what the extension adds), links and actions name the virtual sheets,
 * and the extension automations join the pack's own. `selfInstall` is the install being upgraded or extended: its
 * own rows on the foreign sheets are what it plans again, not existing columns.
 */
export function augmentManifest(
  m: PackManifest,
  foreign: Record<string, ForeignSheet>,
  opts: { selfInstall?: string | null; pending?: ReadonlySet<string> } = {},
): Augmented {
  const problems: string[] = [];
  const pending: string[] = [];
  const virtual = new Map<string, VirtualSheet>();
  const options: OptionAddition[] = [];
  const sheets: PackSheet[] = [];
  const resolved = new Map<string, string>(); // `<pack>:<sheet>` → vref
  const own = (installId: string | null) => !!installId && installId === (opts.selfInstall ?? null);

  for (const need of foreignSheets(m)) {
    const key = foreignKey(need.pack, need.sheet);
    const f = foreign[key];
    if (!f) {
      if (opts.pending?.has(need.pack)) pending.push(key);
      else
        problems.push(
          `This pack needs the sheet "${need.sheet}" of "${need.pack}", which is not installed here.`,
        );
      continue;
    }
    const vref = virtualRef(need.pack, need.sheet);
    resolved.set(key, vref);
    const ext = (m.extends ?? []).find((e) => e.pack === need.pack && e.sheet === need.sheet);
    const existing = f.fields.filter((x) => !own(x.installId));
    const existingKeys = new Map(existing.map((x) => [x.key, x.id]));
    for (const x of ext?.fields ?? [])
      if (existingKeys.has(x.key)) problems.push(`${f.name} already has a column "${x.key}".`);

    // options merged by id: an option already there is left as it is
    const added = new Map<string, ExtensionOption[]>();
    const addOptions = (fieldKey: string, list: ExtensionOption[]) => {
      const field = existing.find((x) => x.key === fieldKey);
      const extField = ext?.fields?.find((x) => x.key === fieldKey);
      if (extField) return; // a new field carries its own options
      if (!field) {
        problems.push(`${f.name} has no field "${fieldKey}" to add options to.`);
        return;
      }
      const cfg = isObj(field.config) ? field.config : {};
      if (!OPTION_TYPES(field.type) || !Array.isArray(cfg.options)) {
        problems.push(`${f.name} › ${field.name} has no options to add to.`);
        return;
      }
      const have = new Set(
        (cfg.options as Json[]).flatMap((o) =>
          isObj(o) && typeof o.id === 'string' ? [o.id] : [],
        ),
      );
      for (const o of list) {
        if (have.has(o.id)) continue;
        have.add(o.id);
        added.set(fieldKey, [...(added.get(fieldKey) ?? []), o]);
        options.push({
          ref: `${key}.${fieldKey}.${o.id}`,
          fieldId: field.id,
          fieldKey,
          sheetName: f.name,
          fieldName: field.name,
          option: o,
        });
      }
    };
    for (const [k, list] of Object.entries(ext?.options ?? {})) addOptions(k, list);
    const standardField = existing.find((x) => x.key === STANDARDS_KEY);
    const standardView = !!(ext && m.standard && standardField);
    if (standardView && m.standard)
      addOptions(STANDARDS_KEY, [
        {
          id: m.standard.id,
          label: m.standard.label,
          ...(m.standard.color ? { color: m.standard.color } : {}),
        },
      ]);

    const fields: PackSheet['fields'] = existing.map((x) => {
      const cfg = isObj(x.config) ? { ...x.config } : {};
      const more = added.get(x.key);
      if (more && Array.isArray(cfg.options))
        cfg.options = [...(cfg.options as Json[]), ...(more as unknown as Json[])];
      return {
        key: x.key,
        name: x.name,
        type: x.type as PackSheet['fields'][number]['type'],
        required: x.required,
        locked: x.locked,
        ...(x.description ? { description: x.description } : {}),
        config: cfg,
      };
    });
    const existingGroups = new Map<string, string>();
    const groups: PackSheet['groups'] = f.groups
      .filter((g) => !own(g.installId))
      .map((g, i) => {
        const ref = g.ref ?? `zz_group_${i}`;
        existingGroups.set(ref, g.id);
        return { ref, name: g.name, color: g.color as PackSheet['groups'][number]['color'] };
      });
    const views: PackSheet['views'] = [...(ext?.views ?? [])];
    if (standardView && m.standard)
      views.push({
        name: standardViewName(m.standard.label),
        type: 'table',
        config: {
          filters: [{ fieldKey: STANDARDS_KEY, op: 'has_any_of', value: [m.standard.id] }],
        },
      });
    virtual.set(vref, {
      key,
      pack: need.pack,
      sheet: need.sheet,
      foreign: f,
      existingFields: existingKeys,
      existingGroups,
      extensionViews: ext?.views?.length ?? 0,
      standardView,
    });
    sheets.push({
      ref: vref,
      name: f.name,
      itemLabel: f.itemLabel,
      idPrefix: f.idPrefix || 'EXT-',
      isLibrary: false,
      fields: [...fields, ...(ext?.fields ?? [])],
      groups: [...groups, ...(ext?.groups ?? [])],
      views,
      forms: ext?.forms ?? [],
      items: ext?.items ?? [],
      columnGroups: [],
    } as PackSheet);
  }
  if (!m.extends?.length && !resolved.size)
    return { manifest: m, virtual, options, problems, pending };

  // existing link fields between two foreign sheets name the virtual sheets, so example items this pack adds to
  // both can be linked (a risk to the category it adds); their inverse by key
  const byId = new Map([...virtual].map(([vref, v]) => [v.foreign.sheetId, { vref, v }]));
  for (const s of sheets)
    for (const f of s.fields) {
      const v = virtual.get(s.ref)!;
      if (f.type !== 'link' || !v.existingFields.has(f.key)) continue;
      const cfg = (f.config ?? {}) as Obj;
      const to = typeof cfg.targetSheetId === 'string' ? byId.get(cfg.targetSheetId) : undefined;
      if (!to) continue;
      const inverse = to.v.foreign.fields.find((x) => x.id === cfg.inverseFieldId)?.key;
      const next: Obj = { ...cfg, targetSheetRef: to.vref };
      delete next.targetSheetId;
      delete next.inverseFieldId;
      if (inverse) next.inverseKey = inverse;
      f.config = next;
    }

  // links and actions into foreign sheets name the virtual sheets now (unresolved ones stay foreign: not linked)
  const rewrite = (raw: unknown): unknown =>
    typeof raw === 'string' && raw.includes(':') ? (resolved.get(raw) ?? raw) : raw;
  const withTargets = (fields: PackSheet['fields']): PackSheet['fields'] =>
    fields.map((f) => {
      const cfg = f.config as Obj | undefined;
      if (!cfg || typeof cfg.targetSheetRef !== 'string' || !cfg.targetSheetRef.includes(':'))
        return f;
      return { ...f, config: { ...cfg, targetSheetRef: rewrite(cfg.targetSheetRef) as Json } };
    });
  type Auto = PackManifest['automations'][number];
  const withActions = (a: Auto): Auto => ({
    ...a,
    actions: a.actions.map((x) =>
      typeof x.sheetRef === 'string' ? { ...x, sheetRef: rewrite(x.sheetRef) as Json } : x,
    ),
  });
  const ownSheets = m.sheets.map((s) => ({ ...s, fields: withTargets(s.fields) }));
  const virtualSheets = sheets.map((s) => ({ ...s, fields: withTargets(s.fields) }));
  const extAutomations: PackManifest['automations'] = [];
  for (const e of m.extends ?? []) {
    const vref = resolved.get(foreignKey(e.pack, e.sheet));
    if (!vref) continue;
    for (const a of e.automations ?? []) extAutomations.push(withActions({ ...a, sheet: vref }));
  }
  return {
    manifest: {
      ...m,
      sheets: [...ownSheets, ...virtualSheets],
      automations: [...m.automations.map((a) => withActions(a)), ...extAutomations],
    },
    virtual,
    options,
    problems,
    pending,
  };
}

/** The extension rows' ref: the virtual sheet's internal ref swapped for `<pack>:<sheet>`. */
export function extensionRef(ref: string, virtual: ReadonlyMap<string, VirtualSheet>): string {
  const dot = ref.indexOf('.');
  const head = dot < 0 ? ref : ref.slice(0, dot);
  const v = virtual.get(head);
  return v ? `${v.key}${dot < 0 ? '' : ref.slice(dot)}` : ref;
}

/** Extension entries as the preview lists them. */
export function extensionSummary(e: PackExtension): string[] {
  const out: string[] = [];
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  if (e.fields?.length) out.push(n(e.fields.length, 'column'));
  if (e.groups?.length) out.push(n(e.groups.length, 'group'));
  if (e.views?.length) out.push(n(e.views.length, 'view'));
  if (e.forms?.length) out.push(n(e.forms.length, 'form'));
  if (e.items?.length) out.push(n(e.items.length, 'example item'));
  if (e.automations?.length) out.push(n(e.automations.length, 'automation'));
  return out;
}
