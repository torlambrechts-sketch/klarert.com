// A pack manifest as a sheet template (docs/11), so the template's checks (schema.ts) and the template planner
// (planTemplateImport) do the sheet-level work for packs too. Pure.
import type { Json } from '../types';
import type { SheetTemplate } from '../templates/schema';
import { splitSheetRef, type PackManifest, type PackSheet } from './types';

type Obj = Record<string, Json>;

/** The link target of a field config, within this pack, or null (no link, or another pack's sheet). */
export function ownTarget(config: Obj | undefined, key: string): string | null {
  const raw = config?.targetSheetRef;
  if (typeof raw !== 'string') return null;
  const split = splitSheetRef(raw, key);
  return split && split.pack === null ? split.ref : null;
}

/** Link fields of a sheet that point into another pack: `{ fieldKey, pack, sheetRef }`. */
export function foreignLinks(
  m: PackManifest,
): { sheet: string; fieldKey: string; pack: string; ref: string }[] {
  const out: { sheet: string; fieldKey: string; pack: string; ref: string }[] = [];
  for (const s of m.sheets)
    for (const f of s.fields) {
      const raw = (f.config as Obj | undefined)?.targetSheetRef;
      if (typeof raw !== 'string') continue;
      const split = splitSheetRef(raw, m.key);
      if (split?.pack)
        out.push({ sheet: s.ref, fieldKey: f.key, pack: split.pack, ref: split.ref });
    }
  return out;
}

function templateSheet(
  m: PackManifest,
  s: PackSheet,
  prefix: string | undefined,
): SheetTemplate['sheets'][number] {
  const linkTarget = new Map<string, string>();
  const fields = s.fields.map((f) => {
    const cfg = f.config as Obj | undefined;
    if (!cfg || typeof cfg.targetSheetRef !== 'string') return f;
    const own = ownTarget(cfg, m.key);
    const rest: Obj = { ...cfg };
    delete rest.targetSheetRef;
    if (!own) {
      // another pack's sheet: not resolved in P1 (the planner reports it); the field stays unlinked here
      delete rest.inverseKey;
      return { ...f, config: rest };
    }
    linkTarget.set(f.key, own);
    return { ...f, config: { ...rest, targetSheetRef: own } };
  });
  // the pack's own keys (isLibrary, register) stay out of the template sheet
  const {
    isLibrary: _lib,
    register: _reg,
    folder: _folder,
    framework: _framework,
    restricted: _restricted,
    items,
    ...rest
  } = s;
  void _framework;
  void _restricted;
  void _lib;
  void _reg;
  void _folder;
  return {
    ...rest,
    idPrefix: prefix ?? s.idPrefix,
    fields,
    items: items.map((i) => {
      const links: Record<string, string[]> = {};
      for (const [key, refs] of Object.entries(i.links ?? {})) {
        const target = linkTarget.get(key);
        if (target) links[key] = refs.map((r) => `$item:${target}:${r}`);
      }
      return {
        ref: i.ref,
        group: i.group,
        name: i.name,
        values: i.values,
        ...(Object.keys(links).length ? { links } : {}),
      };
    }),
  };
}

/**
 * The manifest as a template: same sheets, fields, groups, views, forms, tabs, column groups, sub-items and
 * automations; items keep their refs and their links become `$item:<sheet>:<ref>` tokens. `prefixes` replaces ID
 * prefixes (sheet ref → prefix) when the workspace already uses them.
 */
export function packToTemplate(
  m: PackManifest,
  prefixes: Record<string, string> = {},
): SheetTemplate {
  return {
    id: m.key,
    version: Math.max(1, Number(m.version.split('.')[0]) || 1),
    description: m.description,
    people: m.people,
    folder: m.folders[0]?.name ?? m.title,
    sheets: m.sheets.map((s) => templateSheet(m, s, prefixes[s.ref])),
    automations: m.automations.map(({ ref: _ref, ...a }) => {
      void _ref;
      return a;
    }),
  };
}
