// "Save your setup" (docs/11 Your own packs, P9): a workspace's setup captured as a private pack manifest. Pure: the
// workspace's rows in (read by the server with the person's own client, so only what they can read), a manifest and
// the "Left out" report out. Nothing here knows a field type's meaning beyond the registry-free shapes it rewrites.
//
// - Stable refs come from the source rows' ids (`s_<10 hex>`), so a later version matches the earlier objects in the
//   three-way upgrade diff (planPackUpgrade).
// - The workspace's own sheets become the pack's sheets. What a person added to sheets of our packs (columns, options,
//   groups, views, forms, automations, approval workflows) becomes `extends` entries in the pack's namespace, with
//   every `{field_key}` and key reference rewritten. Changes to what we shipped are not carried (listed).
// - Never captured: items (example items come later) and so no values at all, files, updates, the log, form tokens,
//   people (user ids anywhere, allowed users, named approvers and recipients), webhook addresses (the action is left
//   out) and outside email addresses. Converted: job roles and teams by name; an automation that loses everyone it
//   tells installs off; every automation starts in test mode.
import type { Json, LabelColor } from '../types';
import { LABEL_COLORS } from '../labels';
import { toSavedViewType, toViewType } from '../views/config';
import { inNamespace, namespaceOf, STANDARDS_KEY } from './extend';
import { bundleParts, closeExclusions, selectManifest, type BundlePart } from './select';
import { OUTBOUND_ACTIONS } from './safety';
import { compareVersions, parseVersion } from './semver';
import type {
  ExtensionOption,
  PackAutomation,
  PackDashboard,
  PackExtension,
  PackManifest,
  PackSheet,
  PackWidget,
} from './types';

type Obj = Record<string, Json>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

// ───────────────────────── the snapshot ─────────────────────────

export interface CapturedFolder {
  id: string;
  name: string;
  restricted: boolean;
  packInstallId: string | null;
  packRef: string | null;
}

export interface CapturedSheet {
  id: string;
  name: string;
  description: string | null;
  itemLabel: string;
  idPrefix: string | null;
  folderId: string | null;
  restricted: boolean;
  isLibrary: boolean;
  parentSheetId: string | null;
  packInstallId: string | null;
  packRef: string | null;
  settings: Json;
}

export interface CapturedField {
  id: string;
  sheetId: string;
  key: string;
  name: string;
  type: string;
  description: string | null;
  required: boolean;
  locked: boolean;
  config: Json;
  rules: Json;
  visibility: Json | null;
  restrictedTo: Json | null;
  position: string;
  packInstallId: string | null;
}

export interface CapturedGroup {
  id: string;
  sheetId: string;
  name: string;
  color: string;
  position: string;
  packInstallId: string | null;
  packRef: string | null;
}

export interface CapturedView {
  id: string;
  sheetId: string;
  name: string;
  type: string;
  config: Json;
  position: string;
  ownerId: string | null;
  packInstallId: string | null;
  packRef: string | null;
}

export interface CapturedAutomation {
  id: string;
  sheetId: string;
  name: string;
  enabled: boolean;
  trigger: Json;
  conditions: Json;
  actions: Json;
  packInstallId: string | null;
}

export interface CapturedDashboard {
  id: string;
  name: string;
  config: Json;
  position: string;
  packInstallId: string | null;
}

/** A live install in the workspace. `manifest` for our catalogue's packs (as installed); null for anything else. */
export interface CapturedInstall {
  id: string;
  packKey: string;
  version: string;
  title: string;
  /** Our catalogue's manifest of the installed version; null: a workspace's own pack or a framework library. */
  manifest: PackManifest | null;
}

export interface WorkspaceSnapshot {
  org: { id: string; name: string };
  installs: CapturedInstall[];
  folders: CapturedFolder[];
  sheets: CapturedSheet[];
  fields: CapturedField[];
  groups: CapturedGroup[];
  views: CapturedView[];
  automations: CapturedAutomation[];
  dashboards: CapturedDashboard[];
  jobRoles: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  /** Every member's user id: such an id anywhere is a person and is never copied. */
  memberIds: string[];
  /** The workspace's own frameworks (docs/12), `<key>@<version>`, of its adopted libraries. */
  ownFrameworks: { key: string; version: string }[];
}

export interface CaptureOptions {
  key: string;
  version: string;
  title: string;
  description: string;
  /** Part ids left out (bundleParts of the whole capture). */
  excluded: string[];
}

export type LeftOutKind =
  'items' | 'webhook' | 'people' | 'email' | 'shipped' | 'not_ours' | 'restricted' | 'unsupported';

export interface LeftOutEntry {
  kind: LeftOutKind;
  /** Where: "Supplier checks › Escalate to the owner". */
  where: string;
  text: string;
}

export interface CaptureResult {
  /** The whole capture before the person's selection (its parts are what they tick). */
  parts: BundlePart[];
  /** The selection closed over what depends on it. */
  excluded: string[];
  manifest: PackManifest;
  leftOut: LeftOutEntry[];
}

// ───────────────────────── refs ─────────────────────────

/** A stable 10-hex digest of a row id (FNV-1a, 40 bits): the same row gives the same ref in every version. */
export function shortHash(id: string): string {
  let h = 0xcbf29ce484222325n;
  for (const ch of id) {
    h ^= BigInt(ch.codePointAt(0)!);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return (h & 0xffffffffffn).toString(16).padStart(10, '0');
}

export const stableRef = (prefix: string, id: string) => `${prefix}_${shortHash(id)}`;

/** A key or id in the pack's namespace, at most `max` characters (`<ns>_<key>`, cut with a digest when too long). */
function namespaced(ns: string, key: string, max: number): string {
  if (inNamespace(ns, key) && key.length <= max) return key;
  const full = `${ns}_${key}`;
  if (full.length <= max) return full;
  const room = max - ns.length - 6;
  return `${ns}_${key.slice(0, Math.max(1, room)).replace(/_+$/, '')}_${shortHash(key).slice(0, 4)}`;
}

/** The pack key for a new private pack: `w<first 8 hex of the workspace id>-<slug of the title>` (0074, 0075). */
export function privatePackKey(orgId: string, title: string, taken: Iterable<string> = []): string {
  const prefix = `w${orgId.replace(/-/g, '').slice(0, 8)}-`;
  const slug =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 16)
      .replace(/-+$/, '') || 'setup';
  const used = new Set(taken);
  let key = `${prefix}${slug}`;
  for (let n = 2; used.has(key); n++) key = `${prefix}${slug.slice(0, 13)}-${n}`;
  return key;
}

// ───────────────────────── capture ─────────────────────────

/** A recipient list that lost everyone (marker, never written). */
const NOBODY = '\u0000nobody';
const FORMULA_REF = /\{([a-z][a-z0-9_]*)\}/g;
const KEY_PROPS = new Set([
  'fieldKey',
  'labelFieldKey',
  'dateFieldKey',
  'linkFieldKey',
  'whenFieldKey',
  'sourceFieldKey',
]);
const KEY_LISTS = new Set(['hidden', 'summaryOff', 'require', 'requiredFields', 'fields']);

/**
 * Capture the workspace as a pack manifest and say what was left out. The parts are the whole capture's; the manifest
 * is the person's selection of them (selectManifest), checked by the caller with the manifest schema.
 */
export function captureManifest(snap: WorkspaceSnapshot, opts: CaptureOptions): CaptureResult {
  const leftOut: LeftOutEntry[] = [];
  const left = (kind: LeftOutKind, where: string, text: string) => {
    if (!leftOut.some((x) => x.kind === kind && x.where === where && x.text === text))
      leftOut.push({ kind, where, text });
  };
  const ns = namespaceOf(opts.key);
  const members = new Set(snap.memberIds);
  const roleName = new Map(snap.jobRoles.map((r) => [r.id, r.name]));
  const teamName = new Map(snap.teams.map((t) => [t.id, t.name]));

  // ── which installs are ours (catalogue) and which sheets they made
  const ours = new Map(
    snap.installs
      .filter((i) => i.manifest)
      .map((i) => [i.id, i as CapturedInstall & { manifest: PackManifest }]),
  );
  const otherInstall = new Map(snap.installs.filter((i) => !i.manifest).map((i) => [i.id, i]));
  const sheetById = new Map(snap.sheets.map((s) => [s.id, s]));
  const live = snap.sheets.filter((s) => !s.parentSheetId);
  /** Own sheets: made in the workspace (no provenance), not libraries. */
  const ownSheets = live.filter((s) => !s.packInstallId && !s.isLibrary);
  /** Sheets of our packs: what a person added to them becomes `extends`. */
  const shippedSheets = live.filter(
    (s) => s.packInstallId && ours.has(s.packInstallId) && !s.isLibrary,
  );
  for (const s of live)
    if (
      s.isLibrary &&
      s.packInstallId &&
      snap.fields.some((f) => f.sheetId === s.id && !f.packInstallId)
    )
      left('unsupported', s.name, 'Columns added to a framework library are not carried.');
  for (const s of live)
    if (s.packInstallId && otherInstall.has(s.packInstallId) && !s.isLibrary)
      left(
        'not_ours',
        s.name,
        `Made by ${otherInstall.get(s.packInstallId)!.title}, which is not one of our packs: not carried.`,
      );
  for (const s of live)
    if (!s.packInstallId && s.isLibrary)
      left('unsupported', s.name, 'A library sheet made by hand is not carried.');

  const ownRef = new Map(ownSheets.map((s) => [s.id, stableRef('s', s.id)]));
  const shippedOf = (sheetId: string) => {
    const s = sheetById.get(sheetId);
    if (!s?.packInstallId || !s.packRef || s.isLibrary) return null;
    const inst = ours.get(s.packInstallId);
    if (!inst) return null;
    const ms = inst.manifest.sheets.find((x) => x.ref === s.packRef);
    return { sheet: s, inst, pack: inst.packKey, ref: s.packRef, manifestSheet: ms ?? null };
  };
  /** A sheet as the manifest names it: own ref, `<pack>:<ref>` of our pack, or null (not in the pack). */
  const sheetRefOf = (sheetId: string): string | null => {
    if (ownRef.has(sheetId)) return ownRef.get(sheetId)!;
    const sh = shippedOf(sheetId);
    return sh ? `${sh.pack}:${sh.ref}` : null;
  };
  /** The library a sheet holds (`<key>@<version>`), for widgets; null when it is not a library. */
  const libraryOf = (sheetId: string): string | null => {
    const s = sheetById.get(sheetId);
    const fw = isObj(s?.settings) ? (s!.settings as Obj).framework : null;
    return s?.isLibrary && isObj(fw) && typeof fw.key === 'string' && typeof fw.version === 'string'
      ? `${fw.key}@${fw.version}`
      : null;
  };

  // ── per sheet: its live fields and which are new (added by a person)
  const fieldsOf = (sheetId: string) =>
    snap.fields
      .filter((f) => f.sheetId === sheetId)
      .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  /** Key renames per sheet id (extended sheets: the fields a person added go into the pack's namespace). */
  const renames = new Map<string, Map<string, string>>();
  for (const s of shippedSheets) {
    const map = new Map<string, string>();
    for (const f of fieldsOf(s.id)) if (!f.packInstallId) map.set(f.key, namespaced(ns, f.key, 40));
    renames.set(s.id, map);
  }
  const keyOn = (sheetId: string | null, key: string) =>
    (sheetId && renames.get(sheetId)?.get(key)) ?? key;
  const fieldById = new Map(snap.fields.map((f) => [f.id, f]));

  /** Option ids a person added to a field of our packs: renamed into the namespace (exact ids, unique strings). */
  const optionRenames = new Map<string, string>();
  /** Group ids → refs, form (view) ids → refs, workflow ids → ids, per sheet. */
  const groupRef = new Map<string, string>();
  const formRef = new Map<string, string>();
  const workflowRename = new Map<string, Map<string, string>>();

  for (const g of snap.groups) {
    if (ownRef.has(g.sheetId)) groupRef.set(g.id, stableRef('g', g.id));
    else if (shippedOf(g.sheetId)) {
      const sh = shippedOf(g.sheetId)!;
      if (g.packInstallId === sh.inst.id && g.packRef?.startsWith(`${sh.ref}.`))
        groupRef.set(g.id, g.packRef.slice(sh.ref.length + 1));
      else if (!g.packInstallId) groupRef.set(g.id, namespaced(ns, `g${shortHash(g.id)}`, 40));
    }
  }
  for (const v of snap.views)
    if (toViewType(v.type) === 'form' && !v.ownerId) {
      if (ownRef.has(v.sheetId)) formRef.set(v.id, stableRef('f', v.id));
      else if (shippedOf(v.sheetId) && !v.packInstallId)
        formRef.set(v.id, namespaced(ns, `f${shortHash(v.id)}`, 40));
    }

  /** Remove people: member ids anywhere (arrays lose them, a lone id becomes null). Says whether any went. */
  const dropPeople = (v: Json, found: { any: boolean }): Json => {
    if (typeof v === 'string' && members.has(v)) {
      found.any = true;
      return null;
    }
    if (Array.isArray(v))
      return v
        .filter((x) => {
          if (typeof x === 'string' && (members.has(x) || /^user:/.test(x))) {
            found.any = true;
            return false;
          }
          return true;
        })
        .map((x) => dropPeople(x, found));
    if (isObj(v))
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dropPeople(x, found)]));
    return v;
  };

  /** Rewrite field keys (props, lists, `{key}` in strings) of one sheet's context, and renamed option ids. */
  const rekey = (v: Json, sheetId: string | null, inKeyList = false): Json => {
    const map = sheetId ? renames.get(sheetId) : undefined;
    if (typeof v === 'string') {
      if (optionRenames.has(v)) return optionRenames.get(v)!;
      if (!map?.size) return v;
      if (inKeyList) return map.get(v) ?? v;
      return v.replace(FORMULA_REF, (all, k: string) => (map.has(k) ? `{${map.get(k)}}` : all));
    }
    if (Array.isArray(v)) return v.map((x) => rekey(x, sheetId, inKeyList));
    if (isObj(v))
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => {
          if (KEY_PROPS.has(k) && typeof x === 'string') return [k, keyOn(sheetId, x)];
          if (k === 'key' && typeof x === 'string') return [k, keyOn(sheetId, x)];
          if (KEY_LISTS.has(k) && Array.isArray(x))
            return [
              k,
              x.map((y) => (typeof y === 'string' ? keyOn(sheetId, y) : rekey(y, sheetId))),
            ];
          if (k === 'summaries' && isObj(x))
            return [
              k,
              Object.fromEntries(Object.entries(x).map(([kk, y]) => [keyOn(sheetId, kk), y])),
            ];
          if (k === 'to' && Array.isArray(x))
            return [
              k,
              x.map((y) =>
                typeof y === 'string' && y.startsWith('field:')
                  ? `field:${keyOn(sheetId, y.slice(6))}`
                  : y,
              ),
            ];
          return [k, rekey(x, sheetId)];
        }),
      );
    return v;
  };

  // ── fields
  const toField = (f: CapturedField, where: string, keyMap?: Map<string, string>) => {
    const found = { any: false };
    let config = (isObj(f.config) ? { ...(f.config as Obj) } : {}) as Obj;
    if (Array.isArray(config.allowedUserIds) && config.allowedUserIds.length) {
      left(
        'people',
        `${where} › ${f.name}`,
        'The people allowed to see this protected column are not copied.',
      );
    }
    if ('allowedUserIds' in config) config.allowedUserIds = [];
    if (isObj(config.audience)) {
      const a = config.audience as Obj;
      if ([a.userIds, a.teamIds, a.jobRoleIds].some((x) => Array.isArray(x) && x.length))
        left(
          'people',
          `${where} › ${f.name}`,
          'Who must acknowledge is not copied: choose them after install.',
        );
      config.audience = { userIds: [], teamIds: [], jobRoleIds: [] };
    }
    if (f.type === 'people' && 'default' in config) delete config.default;
    if (typeof config.targetSheetId === 'string') {
      const target = sheetRefOf(config.targetSheetId);
      if (!target) return null;
      const inv =
        typeof config.inverseFieldId === 'string'
          ? fieldById.get(config.inverseFieldId)
          : undefined;
      const { targetSheetId, inverseFieldId, ...rest } = config;
      void inverseFieldId;
      config = { ...rest, targetSheetRef: target };
      if (inv) config.inverseKey = keyOn(targetSheetId as string, inv.key);
    }
    if (typeof config.signatureFieldId === 'string') delete config.signatureFieldId;
    config = dropPeople(config, found) as Obj;
    if (found.any)
      left('people', `${where} › ${f.name}`, 'People named in its settings are not copied.');
    const restricted = isObj(f.restrictedTo);
    if (restricted)
      left(
        'restricted',
        `${where} › ${f.name}`,
        'Who may see this restricted column is not carried: restrict it again after install.',
      );
    const key = keyMap?.get(f.key) ?? f.key;
    const out: Obj = { key, name: f.name, type: f.type };
    if (f.required) out.required = true;
    if (f.locked) out.locked = true;
    if (f.description) out.description = f.description.slice(0, 2000);
    const cfg = rekey(config, f.sheetId);
    // a lookup's target field is a key of the linked sheet
    if (
      isObj(cfg) &&
      typeof cfg.linkFieldKey === 'string' &&
      typeof (cfg as Obj).targetFieldKey === 'string'
    ) {
      const link = fieldsOf(f.sheetId).find((x) => x.key === (config as Obj).linkFieldKey);
      const tid = link && isObj(link.config) ? (link.config as Obj).targetSheetId : null;
      if (typeof tid === 'string')
        (cfg as Obj).targetFieldKey = keyOn(tid, str((config as Obj).targetFieldKey));
    }
    if (isObj(cfg) && Object.keys(cfg).length) out.config = cfg;
    if (Array.isArray(f.rules) && f.rules.length) out.rules = rekey(f.rules, f.sheetId);
    if (isObj(f.visibility)) out.visibility = rekey(f.visibility, f.sheetId);
    return out as unknown as PackSheet['fields'][number];
  };

  /** Fields without what they need: a link to a sheet outside the pack, and lookups through it. */
  const fieldsFor = (
    sheet: CapturedSheet,
    list: CapturedField[],
    where: string,
    keyMap?: Map<string, string>,
  ) => {
    const out: PackSheet['fields'] = [];
    const dropped = new Set<string>();
    for (const f of list) {
      if (f.type === 'subitems') continue;
      const cfg = isObj(f.config) ? (f.config as Obj) : {};
      if (typeof cfg.linkFieldKey === 'string' && dropped.has(cfg.linkFieldKey)) {
        dropped.add(f.key);
        continue;
      }
      const field = toField(f, where, keyMap);
      if (!field) {
        dropped.add(f.key);
        left(
          'not_ours',
          `${where} › ${f.name}`,
          'Links to a sheet that is not in the pack: left out.',
        );
        continue;
      }
      out.push(field);
    }
    void sheet;
    return { fields: out, dropped };
  };

  // ── views and forms of a sheet (saved views shared with everyone; personal views stay personal)
  const viewsFor = (sheetId: string, own: boolean, where: string, droppedKeys: Set<string>) => {
    const views: PackSheet['views'] = [];
    const forms: PackSheet['forms'] = [];
    const list = snap.views
      .filter((v) => v.sheetId === sheetId && !v.ownerId && (own || !v.packInstallId))
      .sort((a, b) => (a.position < b.position ? -1 : 1));
    const names = new Set<string>();
    for (const v of list) {
      const type = toSavedViewType(v.type);
      if (!type) continue;
      const raw = (isObj(v.config) ? v.config : {}) as Obj;
      if (type === 'form') {
        const ref = formRef.get(v.id);
        const form = isObj(raw.form) ? (raw.form as Obj) : null;
        if (!ref || !form) continue;
        if (Array.isArray(form.notify) && form.notify.length)
          left('people', `${where} › ${v.name}`, 'Who is told about answers is not copied.');
        const layoutFields = (Array.isArray(form.fields) ? form.fields : []).filter(
          (q) => isObj(q) && !droppedKeys.has(str(q.key)),
        );
        const notice = isObj(form.notice)
          ? Object.fromEntries(
              Object.entries(form.notice as Obj).filter(
                ([k]) => !['version', 'reviewedVersion', 'reviewedAt', 'reviewedBy'].includes(k),
              ),
            )
          : null;
        const gid = typeof form.groupId === 'string' ? groupRef.get(form.groupId) : undefined;
        const settings: Obj = {};
        if (typeof form.confirmation === 'string' && form.confirmation)
          settings.confirmation = form.confirmation;
        if (typeof form.maxResponses === 'number') settings.maxResponses = form.maxResponses;
        if (Array.isArray(form.prefill) && form.prefill.length) settings.prefill = form.prefill;
        const layout: Obj = { fields: layoutFields };
        for (const k of ['title', 'description', 'nameLabel'] as const)
          if (typeof form[k] === 'string' && form[k]) layout[k] = form[k];
        if (form.intake === true && own) layout.intake = true;
        forms.push(
          rekey(
            dropPeople(
              {
                ref,
                name: v.name.slice(0, 60),
                access: form.access === 'public' ? 'public' : 'internal',
                ...(gid ? { groupRef: gid } : {}),
                layout,
                ...(Object.keys(settings).length ? { settings } : {}),
                ...(notice && Object.keys(notice).length ? { notice } : {}),
              } as Obj,
              { any: false },
            ),
            sheetId,
          ) as unknown as PackSheet['forms'][number],
        );
        continue;
      }
      // names are how tab sets point at views: one per name
      if (names.has(v.name)) continue;
      names.add(v.name);
      const found = { any: false };
      const { collapsedGroups, form, ...cfg } = raw;
      void collapsedGroups;
      void form;
      const filters = (Array.isArray(cfg.filters) ? cfg.filters : []).flatMap((c) => {
        if (!isObj(c) || droppedKeys.has(str(c.fieldKey))) return [];
        const clean = dropPeople(c, found) as Obj;
        return Array.isArray(c.value) && Array.isArray(clean.value) && !clean.value.length
          ? []
          : [clean];
      });
      const config = rekey({ ...cfg, filters } as Obj, sheetId) as Obj;
      if (found.any)
        left(
          'people',
          `${where} › ${v.name}`,
          'A filter on named people is left out of this view.',
        );
      views.push({
        name: v.name.slice(0, 80),
        type,
        config,
      } as unknown as PackSheet['views'][number]);
    }
    return { views, forms };
  };

  // ── automations (own sheets, sub-items of own sheets and what a person added on our packs' sheets)
  const autoFor = (a: CapturedAutomation, where: string): PackAutomation | null => {
    const sheet = sheetById.get(a.sheetId);
    const parent = sheet?.parentSheetId ? sheetById.get(sheet.parentSheetId) : null;
    const name = `${where} › ${a.name}`;
    let off = !a.enabled;
    const resolve = (o: Obj, ctxSheet: string): Obj | null => {
      const out: Obj = {};
      for (const [k, v] of Object.entries(o)) {
        if (k === 'sheetId' && typeof v === 'string') {
          const r = sheetRefOf(v);
          if (!r) return null;
          out.sheetRef = r;
        } else if (k === 'formId') {
          if (v === null) out.formId = null;
          else if (typeof v === 'string' && formRef.has(v)) out.formId = formRef.get(v)!;
          else return null;
        } else if (k === 'groupId' && typeof v === 'string') {
          const g = groupRef.get(v);
          if (!g) return null;
          out.groupRef = g;
        } else if (k === 'workflowId' && typeof v === 'string') {
          out.workflowId = workflowRename.get(ctxSheet)?.get(v) ?? v;
        } else if (k === 'to' && Array.isArray(v)) {
          const to: Json[] = [];
          for (const x of v) {
            const s = str(x);
            const [kind, id] = [s.slice(0, s.indexOf(':')), s.slice(s.indexOf(':') + 1)];
            if (kind === 'jobRole' && roleName.has(id)) to.push(`jobRole:${roleName.get(id)}`);
            else if (kind === 'team' && teamName.has(id)) to.push(`team:${teamName.get(id)}`);
            else if (kind === 'jobRole' || kind === 'team') to.push(s);
            else if (kind === 'user' || members.has(s)) {
              left('people', name, 'Named people it tells are not copied.');
            } else if (s.includes('@')) {
              left('email', name, 'Outside email addresses are not copied.');
            } else to.push(x);
          }
          out.to = to;
          // nobody left to tell: the action goes (below) and the automation installs off
          if (v.length && !to.length) out.to = NOBODY;
        } else out[k] = v;
      }
      return out;
    };
    const ctxSheet = a.sheetId;
    const trigger = isObj(a.trigger) ? resolve(a.trigger as Obj, ctxSheet) : null;
    const conditions = (Array.isArray(a.conditions) ? a.conditions : []).map((c) =>
      isObj(c) ? resolve(c, ctxSheet) : null,
    );
    if (!trigger || conditions.some((c) => !c)) {
      left('not_ours', name, 'It uses a sheet, group or form that is not in the pack: left out.');
      return null;
    }
    const actions: Obj[] = [];
    for (const x of Array.isArray(a.actions) ? a.actions : []) {
      if (!isObj(x)) continue;
      if (OUTBOUND_ACTIONS.has(str(x.type))) {
        const host =
          str(x.urlHost) ||
          (() => {
            try {
              return new URL(str(x.url)).host;
            } catch {
              return '';
            }
          })();
        left(
          'webhook',
          name,
          `The webhook${host ? ` to ${host}` : ''} is left out: the address is never copied. Add the address after install.`,
        );
        continue;
      }
      const r = resolve(x, ctxSheet);
      if (!r) {
        left(
          'not_ours',
          name,
          'An action uses a sheet, group or form that is not in the pack: that action is left out.',
        );
        continue;
      }
      if (r.to === NOBODY) {
        off = true;
        left(
          'people',
          name,
          'An action told only named people: it is left out and the automation installs off.',
        );
        continue;
      }
      actions.push(r);
    }
    if (!actions.length) {
      left(
        'people',
        name,
        'Nothing is left for it to do once people and webhook addresses are left out: left out.',
      );
      return null;
    }
    const found = { any: false };
    const clean = (v: Obj | Obj[], s: string | null) => dropPeople(rekey(v as Json, s), found);
    // an action on another sheet sets that sheet's keys
    const acts = actions.map((x) => {
      const target =
        typeof x.sheetRef === 'string'
          ? ([...ownRef].find(([, r]) => r === x.sheetRef)?.[0] ??
            snap.sheets.find((s) => sheetRefOf(s.id) === x.sheetRef)?.id ??
            null)
          : null;
      return clean(x, target ?? ctxSheet) as Obj;
    });
    if (found.any) left('people', name, 'People named in its settings are not copied.');
    const auto: Obj = {
      ref: stableRef('a', a.id),
      sheet: parent ? (ownRef.get(parent.id) ?? '') : (ownRef.get(a.sheetId) ?? ''),
      ...(parent ? { subitems: true } : {}),
      name: a.name.slice(0, 200),
      enabled: !off,
      trigger: clean(trigger, ctxSheet) as Obj,
      conditions: conditions.map((c) => clean(c!, ctxSheet)) as Json,
      actions: acts as Json,
      startInTestMode: true,
    };
    return auto as unknown as PackAutomation;
  };

  // ── workflows: approvers by job role, team or field; named people leave the workflow out
  const workflowsFor = (
    sheetId: string,
    list: Json[],
    where: string,
    rename: (id: string) => string,
  ) => {
    const out: Obj[] = [];
    const map = new Map<string, string>();
    for (const w of list) {
      if (!isObj(w) || typeof w.id !== 'string') continue;
      const steps = Array.isArray(w.steps) ? w.steps : [];
      if (
        steps.some((s) => isObj(s) && isObj(s.approvers) && (s.approvers as Obj).kind === 'people')
      ) {
        left(
          'people',
          `${where} › ${str(w.name) || 'Approval workflow'}`,
          'Its approvers are named people: left out. Name a job role, a team or a people column, then save again.',
        );
        continue;
      }
      const id = rename(w.id);
      map.set(w.id, id);
      out.push(
        rekey(
          {
            ...w,
            id,
            steps: steps.map((s) => {
              if (!isObj(s) || !isObj(s.approvers)) return s;
              const ap = { ...(s.approvers as Obj) };
              delete ap.roleId;
              delete ap.teamId;
              return { ...s, approvers: ap };
            }),
          } as Obj,
          sheetId,
        ) as Obj,
      );
    }
    workflowRename.set(sheetId, map);
    return out;
  };

  // ── own sheets
  const folders: PackManifest['folders'] = [];
  const folderRef = (folderId: string | null): string | undefined => {
    if (!folderId) return undefined;
    const f = snap.folders.find((x) => x.id === folderId);
    if (!f) return undefined;
    if (f.packInstallId) {
      const inst = ours.get(f.packInstallId);
      return inst && f.packRef ? `${inst.packKey}:${f.packRef}` : undefined;
    }
    const ref = stableRef('fo', f.id);
    if (!folders.some((x) => x.ref === ref))
      folders.push({
        ref,
        name: f.name.slice(0, 80),
        ...(f.restricted ? { restricted: true } : {}),
      });
    return ref;
  };

  // workflows first (automations name them)
  const ownWorkflows = new Map<string, Obj[]>();
  for (const s of ownSheets) {
    const list =
      isObj(s.settings) && Array.isArray((s.settings as Obj).workflows)
        ? ((s.settings as Obj).workflows as Json[])
        : [];
    ownWorkflows.set(
      s.id,
      workflowsFor(s.id, list, s.name, (id) => id),
    );
  }

  const sheets: PackSheet[] = [];
  for (const s of ownSheets) {
    const st = (isObj(s.settings) ? s.settings : {}) as Obj;
    const { fields, dropped } = fieldsFor(s, fieldsOf(s.id), s.name);
    const groups = snap.groups
      .filter((g) => g.sheetId === s.id)
      .sort((a, b) => (a.position < b.position ? -1 : 1))
      .map((g) => ({
        ref: groupRef.get(g.id)!,
        name: g.name.slice(0, 80),
        color: (LABEL_COLORS as readonly string[]).includes(g.color)
          ? (g.color as LabelColor)
          : 'grey',
      }));
    const { views, forms } = viewsFor(s.id, true, s.name, dropped);
    const sheet: Obj = {
      ref: ownRef.get(s.id)!,
      name: s.name.slice(0, 120),
      itemLabel: s.itemLabel.slice(0, 60),
      idPrefix:
        s.idPrefix && /^[A-Z0-9]{1,6}-$/.test(s.idPrefix)
          ? s.idPrefix
          : `S${shortHash(s.id).slice(0, 4).toUpperCase()}-`,
      isLibrary: false,
      groups: groups.length ? groups : [{ ref: 'g_default', name: 'Items', color: 'grey' }],
      fields,
      views,
      forms,
      items: [],
      columnGroups: [],
    };
    if (s.description) sheet.description = s.description.slice(0, 2000);
    const folder = folderRef(s.folderId);
    if (folder) sheet.folder = folder;
    if (s.restricted) sheet.restricted = true;
    if (fields.some((f) => isObj(f.config) && (f.config as Obj).personalData === true)) {
      sheet.personalData = true;
      if (!s.restricted)
        left(
          'restricted',
          s.name,
          'It holds personal data, so it installs restricted: owners and the person installing see it until they share it.',
        );
    }
    // column groups by key
    if (Array.isArray(st.columnGroups)) {
      const keys = new Set(fields.map((f) => f.key));
      sheet.columnGroups = st.columnGroups.flatMap((g) => {
        if (!isObj(g) || typeof g.name !== 'string') return [];
        const fk = (Array.isArray(g.fieldKeys) ? g.fieldKeys : []).filter(
          (k): k is string => typeof k === 'string' && keys.has(k),
        );
        return fk.length ? [{ name: g.name.slice(0, 60), fields: fk }] : [];
      });
    }
    // tab set: built-in types or view names
    if (Array.isArray(st.tabs)) {
      const viewName = new Map(
        snap.views.filter((v) => v.sheetId === s.id).map((v) => [v.id, v.name]),
      );
      const shown = new Set(views.map((v) => v.name));
      const tabs = st.tabs.flatMap((t) => {
        if (!isObj(t) || typeof t.id !== 'string') return [];
        const ref = toViewType(t.id) ? t.id : viewName.get(t.id);
        if (!ref || (!toViewType(t.id) && !shown.has(ref))) return [];
        return [
          {
            ref,
            ...(t.hidden === true ? { hidden: true } : {}),
            ...(typeof t.label === 'string' && t.label ? { label: t.label } : {}),
          },
        ];
      });
      if (tabs.length) {
        sheet.tabs = tabs.slice(0, 40);
        const def =
          typeof st.defaultViewId === 'string'
            ? toViewType(st.defaultViewId)
              ? st.defaultViewId
              : viewName.get(st.defaultViewId)
            : undefined;
        if (def && tabs.some((t) => t.ref === def && !t.hidden)) sheet.defaultView = def;
      }
    }
    // sub-items: the hidden child sheet's fields and the "From template" set
    const child = snap.sheets.find((c) => c.parentSheetId === s.id);
    if (child) {
      const sub = isObj(st.subitems) ? (st.subitems as Obj) : {};
      const cf = fieldsFor(child, fieldsOf(child.id), `${s.name} › sub-items`).fields;
      if (cf.length) {
        const peopleKeys = new Set(
          fieldsOf(child.id)
            .filter(
              (f) =>
                f.type === 'people' || (isObj(f.config) && (f.config as Obj).personalData === true),
            )
            .map((f) => f.key),
        );
        sheet.subitems = {
          label: (str(sub.label).trim() || 'Sub-items').slice(0, 40),
          blockClose: sub.blockClose === true,
          lockCascade: sub.lockCascade === true,
          fields: cf.slice(0, 40),
          items: (Array.isArray(sub.template) ? sub.template : [])
            .flatMap((t) => {
              if (!isObj(t) || typeof t.name !== 'string' || !t.name.trim()) return [];
              const values = Object.fromEntries(
                Object.entries(isObj(t.values) ? (t.values as Obj) : {}).filter(
                  ([k, v]) =>
                    !peopleKeys.has(k) && cf.some((f) => f.key === k) && !members.has(str(v)),
                ),
              );
              return [{ name: t.name.slice(0, 500), values }];
            })
            .slice(0, 50),
        };
      }
    }
    const wf = ownWorkflows.get(s.id) ?? [];
    if (wf.length) sheet.workflows = wf;
    sheets.push(sheet as unknown as PackSheet);
  }

  // ── what a person added to our packs' sheets: extends entries
  const extendsList: PackExtension[] = [];
  for (const s of shippedSheets) {
    const sh = shippedOf(s.id)!;
    const where = s.name;
    const st = (isObj(s.settings) ? s.settings : {}) as Obj;
    const ms = sh.manifestSheet;
    // shipped changes, not carried in the MVP
    if (ms && ms.name !== s.name)
      left(
        'shipped',
        where,
        `Renamed from "${ms.name}": changes to what we shipped are not carried.`,
      );
    const live = fieldsOf(s.id);
    const added = live.filter((f) => !f.packInstallId);
    for (const f of live.filter((x) => x.packInstallId === sh.inst.id)) {
      const mf = ms?.fields.find((x) => x.key === f.key);
      if (mf && mf.name !== f.name)
        left(
          'shipped',
          `${where} › ${f.name}`,
          `Renamed from "${mf.name}": changes to what we shipped are not carried.`,
        );
    }
    if (ms)
      for (const mf of ms.fields)
        if (
          !live.some((f) => f.key === mf.key && f.packInstallId === sh.inst.id) &&
          !snap.fields.some((f) => f.sheetId === s.id && f.key === mf.key)
        )
          left(
            'shipped',
            `${where} › ${mf.name}`,
            'Removed or archived here: changes to what we shipped are not carried.',
          );
    // options a person added to shipped option fields (ids not shipped by this pack or an add-on)
    const shippedOptionIds = (key: string) => {
      const ids = new Set<string>();
      const mf = ms?.fields.find((x) => x.key === key);
      for (const o of (isObj(mf?.config) && Array.isArray((mf!.config as Obj).options)
        ? (mf!.config as Obj).options
        : []) as Json[])
        if (isObj(o) && typeof o.id === 'string') ids.add(o.id);
      for (const i of ours.values()) {
        if (key === STANDARDS_KEY && i.manifest.standard) ids.add(i.manifest.standard.id);
        for (const e of i.manifest.extends ?? [])
          if (e.pack === sh.pack && e.sheet === sh.ref)
            for (const o of e.options?.[key] ?? []) ids.add(o.id);
      }
      return ids;
    };
    const options: Record<string, ExtensionOption[]> = {};
    for (const f of live.filter((x) => x.packInstallId)) {
      const opts =
        isObj(f.config) && Array.isArray((f.config as Obj).options)
          ? ((f.config as Obj).options as Json[])
          : [];
      if (!opts.length) continue;
      const shipped = shippedOptionIds(f.key);
      const mf = ms?.fields.find((x) => x.key === f.key);
      const mOpts = (
        isObj(mf?.config) && Array.isArray((mf!.config as Obj).options)
          ? (mf!.config as Obj).options
          : []
      ) as Obj[];
      for (const o of opts) {
        if (!isObj(o) || typeof o.id !== 'string') continue;
        if (shipped.has(o.id)) {
          const mo = mOpts.find((x) => x.id === o.id);
          if (mo && f.packInstallId === sh.inst.id && mo.label !== o.label)
            left(
              'shipped',
              `${where} › ${f.name}`,
              `Option "${str(mo.label)}" renamed to "${str(o.label)}": changes to what we shipped are not carried.`,
            );
          continue;
        }
        if (f.packInstallId !== sh.inst.id) continue;
        const id = namespaced(ns, `o${shortHash(o.id)}`, 40);
        optionRenames.set(o.id, id);
        (options[f.key] ??= []).push({
          id,
          label: str(o.label).slice(0, 80) || 'Option',
          ...((LABEL_COLORS as readonly string[]).includes(str(o.color))
            ? { color: o.color as LabelColor }
            : {}),
          ...(o.done === true ? { done: true } : {}),
        });
      }
    }
    for (const g of snap.groups.filter(
      (x) => x.sheetId === s.id && x.packInstallId === sh.inst.id,
    )) {
      const ref = groupRef.get(g.id);
      const mg = ms?.groups.find((x) => x.ref === ref);
      if (mg && mg.name !== g.name)
        left(
          'shipped',
          `${where} › ${g.name}`,
          `Group renamed from "${mg.name}": changes to what we shipped are not carried.`,
        );
    }
    if (
      Array.isArray(st.columnGroups) &&
      st.columnGroups.length &&
      JSON.stringify(st.columnGroups.map((g) => (isObj(g) ? g.name : null))) !==
        JSON.stringify((ms?.columnGroups ?? []).map((g) => g.name))
    )
      left('shipped', where, 'Column groups on this register are not carried.');
    if (JSON.stringify(st.tabs ?? null) !== JSON.stringify(st.tabsDefault ?? st.tabs ?? null))
      left('shipped', where, 'Tab changes on this register are not carried.');

    const { fields, dropped } = fieldsFor(s, added, where, renames.get(s.id));
    const subFields = fields.filter((f) => f.type === 'subitems');
    if (subFields.length)
      left('unsupported', where, 'Sub-items cannot be added to one of our registers: left out.');
    const child = snap.sheets.find((c) => c.parentSheetId === s.id);
    if (child && fieldsOf(child.id).some((f) => !f.packInstallId))
      left(
        'unsupported',
        `${where} › sub-items`,
        'Columns added to the sub-items of one of our registers are not carried.',
      );
    const groups = snap.groups
      .filter((g) => g.sheetId === s.id && !g.packInstallId)
      .sort((a, b) => (a.position < b.position ? -1 : 1))
      .map((g) => ({
        ref: groupRef.get(g.id)!,
        name: g.name.slice(0, 80),
        color: (LABEL_COLORS as readonly string[]).includes(g.color)
          ? (g.color as LabelColor)
          : 'grey',
      }));
    const { views, forms } = viewsFor(s.id, false, where, dropped);
    const shippedWf = new Set<string>();
    for (const w of ms?.workflows ?? []) shippedWf.add(w.id);
    for (const i of ours.values())
      for (const e of i.manifest.extends ?? [])
        if (e.pack === sh.pack && e.sheet === sh.ref)
          for (const w of e.workflows ?? []) shippedWf.add(w.id);
    const wfList = (Array.isArray(st.workflows) ? st.workflows : []).filter(
      (w) => isObj(w) && !shippedWf.has(str(w.id)),
    );
    const workflows = workflowsFor(s.id, wfList, where, (id) =>
      namespaced(ns, `w${shortHash(id)}`, 40),
    );
    const entry: Obj = { pack: sh.pack, sheet: sh.ref };
    if (fields.length) entry.fields = fields.filter((f) => f.type !== 'subitems');
    if (groups.length) entry.groups = groups;
    if (views.length) entry.views = views;
    if (forms.length) entry.forms = forms;
    if (Object.keys(options).length) entry.options = options as unknown as Json;
    if (workflows.length) entry.workflows = workflows;
    extendsList.push(entry as unknown as PackExtension);
  }

  // ── automations: own sheets (and their sub-items) and those a person added on our sheets
  const automations: PackAutomation[] = [];
  for (const a of snap.automations) {
    const sheet = sheetById.get(a.sheetId);
    if (!sheet) continue;
    const parentId = sheet.parentSheetId;
    if (ownRef.has(a.sheetId) || (parentId && ownRef.has(parentId))) {
      const auto = autoFor(a, (parentId ? sheetById.get(parentId)! : sheet).name);
      if (auto) automations.push(auto);
      continue;
    }
    if (a.packInstallId) continue;
    const sh = shippedOf(a.sheetId);
    if (sh) {
      const auto = autoFor(a, sheet.name);
      if (!auto) continue;
      const entry = extendsList.find((e) => e.pack === sh.pack && e.sheet === sh.ref)!;
      const { sheet: _s, subitems: _u, ...rest } = auto as PackAutomation & { subitems?: boolean };
      void _s;
      void _u;
      entry.automations = [
        ...(entry.automations ?? []),
        rest as NonNullable<PackExtension['automations']>[number],
      ];
      continue;
    }
    if (parentId && shippedOf(parentId))
      left(
        'unsupported',
        `${sheetById.get(parentId)!.name} › ${a.name}`,
        'Automations on the sub-items of one of our registers are not carried.',
      );
  }

  // ── dashboards made here
  const frameworks = new Map<string, { key: string; version: string }>();
  for (const f of snap.ownFrameworks) frameworks.set(`${f.key}@${f.version}`, f);
  const dashboards: PackDashboard[] = [];
  for (const d of snap.dashboards
    .filter((x) => !x.packInstallId)
    .sort((a, b) => (a.position < b.position ? -1 : 1))) {
    const raw =
      isObj(d.config) && Array.isArray((d.config as Obj).widgets)
        ? ((d.config as Obj).widgets as Json[])
        : [];
    const widgets: PackWidget[] = [];
    for (const w of raw) {
      if (!isObj(w) || typeof w.type !== 'string') continue;
      const sid = str(w.sheetId);
      const lib = sid ? libraryOf(sid) : null;
      const sref = sid && !lib ? sheetRefOf(sid) : null;
      if (sid && !lib && !sref) {
        left(
          'not_ours',
          `${d.name} › ${str(w.title) || 'Widget'}`,
          'Reads a sheet that is not in the pack: left out.',
        );
        continue;
      }
      if (lib) {
        const [key, version] = lib.split('@') as [string, string];
        frameworks.set(lib, { key, version });
      }
      const found = { any: false };
      const out: Obj = {
        ref: stableRef('w', `${d.id}:${str(w.id)}`),
        type: w.type,
        title: (str(w.title) || 'Widget').slice(0, 120),
        ...(sref ? { sheetRef: sref } : {}),
        ...(lib ? { library: lib } : {}),
        ...(typeof w.fieldKey === 'string' ? { fieldKey: keyOn(sid || null, w.fieldKey) } : {}),
        ...(Array.isArray(w.conditions)
          ? { conditions: dropPeople(rekey(w.conditions, sid || null), found) }
          : {}),
        ...(Array.isArray(w.scope)
          ? { scope: dropPeople(rekey(w.scope, sid || null), found) }
          : {}),
        ...(typeof w.days === 'number' ? { days: w.days } : {}),
      };
      if (found.any)
        left('people', `${d.name} › ${str(w.title)}`, 'A filter on named people is left out.');
      widgets.push(out as unknown as PackWidget);
    }
    if (!widgets.length) {
      left('not_ours', d.name, 'None of its widgets read a sheet in the pack: left out.');
      continue;
    }
    dashboards.push({ ref: stableRef('d', d.id), name: d.name.slice(0, 120), widgets });
  }

  const requires = [...ours.values()]
    .filter((i) => !i.manifest.sheets.some((s) => s.framework))
    .map((i) => ({ pack: i.packKey, range: `^${i.version}` }))
    .sort((a, b) => a.pack.localeCompare(b.pack));
  const used = new Set(requires.map((r) => r.pack));
  const whole: PackManifest = {
    key: opts.key,
    version: opts.version,
    title: opts.title,
    description: opts.description,
    requires,
    people: [],
    folders,
    sheets,
    automations,
    dashboards,
    ...(frameworks.size ? { frameworks: [...frameworks.values()] } : {}),
    ...(extendsList.length
      ? { extends: extendsList.filter((e) => used.has(e.pack) && Object.keys(e).length > 2) }
      : {}),
  };
  if (whole.extends && !whole.extends.length) delete whole.extends;

  left(
    'items',
    'Items',
    'Items and their values are not copied: example items come later. No people, personal data, files, updates, emails, form links or activity log entries are copied.',
  );

  const parts = bundleParts(whole);
  const excluded = [...closeExclusions(parts, opts.excluded)];
  const manifest = selectManifest(whole, excluded);
  // folders the chosen sheets do not use are dropped by selectManifest; an extends entry with nothing left goes too
  if (manifest.extends) {
    manifest.extends = manifest.extends.filter((e) =>
      Object.keys(e).some(
        (k) =>
          k !== 'pack' &&
          k !== 'sheet' &&
          (Array.isArray((e as unknown as Obj)[k])
            ? ((e as unknown as Obj)[k] as Json[]).length
            : !!(e as unknown as Obj)[k]),
      ),
    );
    if (!manifest.extends.length) delete manifest.extends;
  }
  // every automation starts in test mode (owner decision 3), also those an extends entry keeps
  manifest.automations = manifest.automations.map((a) => ({ ...a, startInTestMode: true }));
  return { parts, excluded, manifest, leftOut };
}

// ───────────────────────── the report ─────────────────────────

const LEFT_OUT_HEADINGS: Record<LeftOutKind, string> = {
  items: 'Items and data',
  webhook: 'Webhook addresses',
  people: 'People',
  email: 'Outside email addresses',
  restricted: 'Restricted and personal data',
  shipped: 'Changes to what we shipped',
  not_ours: 'Not in the pack',
  unsupported: 'Not available yet',
};

/** The "Left out" report, grouped in a fixed order, each line "Where: text". */
export function leftOutReport(
  entries: readonly LeftOutEntry[],
): { kind: LeftOutKind; heading: string; lines: string[] }[] {
  const order: LeftOutKind[] = [
    'items',
    'webhook',
    'people',
    'email',
    'restricted',
    'shipped',
    'not_ours',
    'unsupported',
  ];
  return order.flatMap((kind) => {
    const lines = entries.filter((e) => e.kind === kind).map((e) => `${e.where}: ${e.text}`);
    return lines.length ? [{ kind, heading: LEFT_OUT_HEADINGS[kind], lines }] : [];
  });
}

// ───────────────────────── the version ─────────────────────────

export type VersionKind = 'first' | 'same' | 'patch' | 'minor';

/** Every object's identity in a manifest (refs and keys), to tell additions and removals from wording. */
function identities(m: PackManifest): Set<string> {
  const out = new Set<string>();
  for (const r of m.requires) out.add(`requires:${r.pack}`);
  for (const f of m.frameworks ?? []) out.add(`framework:${f.key}@${f.version}`);
  for (const f of m.folders) out.add(`folder:${f.ref}`);
  for (const s of m.sheets) {
    out.add(`sheet:${s.ref}`);
    for (const f of s.fields) out.add(`field:${s.ref}.${f.key}:${f.type}`);
    for (const g of s.groups) out.add(`group:${s.ref}.${g.ref}`);
    s.views.forEach((v, i) => out.add(`view:${s.ref}.${i}:${v.type}`));
    for (const f of s.forms) out.add(`form:${s.ref}.${f.ref}`);
    for (const w of s.workflows ?? []) out.add(`workflow:${s.ref}.${w.id}`);
    for (const f of s.subitems?.fields ?? []) out.add(`subfield:${s.ref}.${f.key}:${f.type}`);
  }
  for (const a of m.automations) out.add(`automation:${a.ref}`);
  for (const d of m.dashboards) {
    out.add(`dashboard:${d.ref}`);
    for (const w of d.widgets) out.add(`widget:${d.ref}.${w.ref}`);
  }
  for (const e of m.extends ?? []) {
    const at = `${e.pack}:${e.sheet}`;
    out.add(`extends:${at}`);
    for (const f of e.fields ?? []) out.add(`field:${at}.${f.key}:${f.type}`);
    for (const g of e.groups ?? []) out.add(`group:${at}.${g.ref}`);
    (e.views ?? []).forEach((v, i) => out.add(`view:${at}.${i}:${v.type}`));
    for (const f of e.forms ?? []) out.add(`form:${at}.${f.ref}`);
    for (const a of e.automations ?? []) out.add(`automation:${a.ref}`);
    for (const w of e.workflows ?? []) out.add(`workflow:${at}.${w.id}`);
    for (const [k, list] of Object.entries(e.options ?? {}))
      for (const o of list) out.add(`option:${at}.${k}.${o.id}`);
  }
  return out;
}

const WORDING = new Set([
  'name',
  'title',
  'description',
  'label',
  'help',
  'nameLabel',
  'confirmation',
  'message',
  'itemLabel',
  'purpose',
]);

/** The manifest with every wording leaf blanked: two manifests equal here differ only in wording. */
function shape(v: Json, key = ''): Json {
  if (Array.isArray(v)) return v.map((x) => shape(x));
  if (isObj(v))
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, shape(v[k]!, k)]),
    );
  return typeof v === 'string' && WORDING.has(key) ? '' : v;
}

/** Keys sorted at every level: a manifest read back from the database compares like the one just captured. */
function sorted(v: Json): Json {
  if (Array.isArray(v)) return v.map(sorted);
  if (isObj(v))
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sorted(v[k]!)]),
    );
  return v;
}

const body = (m: PackManifest) => {
  const { key, version, title, description, ...rest } = m;
  void key;
  void version;
  void title;
  void description;
  return rest as unknown as Json;
};

/**
 * The version to publish, from the difference with the last one (docs/11 Your own packs): the first is 1.0.0; nothing
 * changed is nothing to publish; only wording changed is a patch; anything added, removed or changed otherwise is a
 * minor version. A major version is never suggested (installed copies cannot update to one).
 */
export function suggestVersion(
  prev: { version: string; manifest: PackManifest } | null,
  next: PackManifest,
): { version: string; kind: VersionKind; reason: string } {
  if (!prev) return { version: '1.0.0', kind: 'first', reason: 'The first version.' };
  const [maj, min, pat] = parseVersion(prev.version) ?? [1, 0, 0];
  const a = JSON.stringify(shape(body(prev.manifest)));
  const b = JSON.stringify(shape(body(next)));
  const same =
    JSON.stringify(sorted(body(prev.manifest))) === JSON.stringify(sorted(body(next))) &&
    prev.manifest.description === next.description &&
    prev.manifest.title === next.title;
  if (same)
    return {
      version: prev.version,
      kind: 'same',
      reason: `Nothing changed since ${prev.version}.`,
    };
  const ia = identities(prev.manifest);
  const ib = identities(next);
  const addedN = [...ib].filter((x) => !ia.has(x)).length;
  const removedN = [...ia].filter((x) => !ib.has(x)).length;
  if (a === b && !addedN && !removedN)
    return { version: `${maj}.${min}.${pat + 1}`, kind: 'patch', reason: 'Only wording changed.' };
  const bits = [
    addedN ? `${addedN} added` : '',
    removedN ? `${removedN} removed` : '',
    !addedN && !removedN ? 'settings changed' : '',
  ].filter(Boolean);
  return {
    version: `${maj}.${min + 1}.0`,
    kind: 'minor',
    reason: `${bits.join(', ')} since ${prev.version}.`,
  };
}

/** Whether `next` may follow `prev`: higher, and the same major (a new major is never offered as an update). */
export function versionProblem(prev: string | null, next: string): string | null {
  if (!parseVersion(next)) return 'Use a version like 1.2.0.';
  if (!prev) return null;
  if (compareVersions(next, prev) <= 0) return `Use a version higher than ${prev}.`;
  return null;
}

/** A new major version: installed copies cannot update to it (docs/11 Upgrades). */
export const isMajorStep = (prev: string | null, next: string) =>
  !!prev && (parseVersion(next)?.[0] ?? 0) > (parseVersion(prev)?.[0] ?? 0);
