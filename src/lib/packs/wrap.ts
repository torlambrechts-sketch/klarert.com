// Sheet templates and wizard starts as packs (docs/11): the same content, with the refs a pack needs. Pure.
import { LABEL_COLORS } from '@/engine/labels';
import { fieldKeyFromName, suggestIdPrefix } from '@/engine/ordering';
import type { PackManifest, PackSheet } from '@/engine/packs/types';
import type { SheetTemplate } from '@/engine/templates/schema';
import { startFieldKeys, type Start } from '@/lib/starts';

const ITEM = /^\$item:([a-z][a-z0-9_]*):(.+)$/;
const refFrom = (name: string, taken: Set<string>) => {
  const r = fieldKeyFromName(name, taken);
  taken.add(r);
  return r;
};

/**
 * A sheet template as a pack: its folder (and any per-sheet folders) become folder refs, items get refs made from
 * their names, `$item:<sheet>:<name>` links become item refs and automations get refs made from their names.
 */
export function templateToPack(
  t: SheetTemplate,
  meta: { version: string; title: string; description?: string },
): PackManifest {
  const folderRefs = new Map<string, string>();
  const folders: PackManifest['folders'] = [];
  const takenFolders = new Set<string>();
  const folderRef = (name: string) => {
    const k = name.trim().toLowerCase();
    if (!folderRefs.has(k)) {
      const ref = refFrom(name, takenFolders);
      folderRefs.set(k, ref);
      folders.push({ ref, name });
    }
    return folderRefs.get(k)!;
  };
  // item refs first, so links can be rewritten from names to refs
  const itemRefs = new Map<string, Map<string, string>>(); // sheet ref → name → ref
  for (const s of t.sheets) {
    const taken = new Set<string>();
    itemRefs.set(s.ref, new Map(s.items.map((i) => [i.name, i.ref ?? refFrom(i.name, taken)])));
  }
  const sheets: PackSheet[] = t.sheets.map((s) => {
    const { folder, items, ...rest } = s;
    return {
      ...rest,
      folder: folderRef(folder ?? t.folder),
      isLibrary: false,
      items: items.map((i) => ({
        ref: itemRefs.get(s.ref)!.get(i.name)!,
        group: i.group,
        name: i.name,
        values: i.values,
        ...(i.links
          ? {
              links: Object.fromEntries(
                Object.entries(i.links).map(([key, tokens]) => [
                  key,
                  tokens.map((tok) => {
                    const m = tok.match(ITEM)!;
                    return itemRefs.get(m[1]!)?.get(m[2]!) ?? m[2]!;
                  }),
                ]),
              ),
            }
          : {}),
      })),
    };
  });
  const takenAutomations = new Set<string>();
  return {
    key: t.id,
    version: meta.version,
    title: meta.title,
    description: meta.description ?? t.description,
    requires: [],
    people: t.people,
    folders,
    sheets,
    automations: t.automations.map((a) => ({ ...a, ref: refFrom(a.name, takenAutomations) })),
    dashboards: [],
  };
}

/**
 * A wizard start (templates/starts.json) as a one-sheet pack: the sheet the wizard would make with its defaults, plus
 * the start's `pack` additions (version, automations, dashboards; checked when the manifest is parsed).
 */
export function startToPack(start: Start, version = start.pack?.version ?? '1.0.0'): PackManifest {
  const cols = start.fields ?? [];
  const keys = startFieldKeys(cols);
  const groupNames = start.groups?.length ? start.groups : ['Group 1'];
  const takenGroups = new Set<string>();
  const groups = groupNames.map((name, i) => ({
    ref: refFrom(name, takenGroups),
    name,
    color: LABEL_COLORS[i % LABEL_COLORS.length]!,
  }));
  const groupRef = (name: string | undefined) => groups.find((g) => g.name === name)?.ref;
  const folder = start.folder ? fieldKeyFromName(start.folder, []) : undefined;
  return {
    key: `start-${start.id}`,
    version,
    title: start.title,
    description: start.description,
    requires: [],
    people: [],
    folders: start.folder && folder ? [{ ref: folder, name: start.folder }] : [],
    sheets: [
      {
        ref: fieldKeyFromName(start.id, []),
        name: start.title.slice(0, 120),
        description: start.description,
        itemLabel: start.itemLabel ?? 'Item',
        idPrefix: suggestIdPrefix(start.title, []),
        ...(folder ? { folder } : {}),
        isLibrary: false,
        ...(start.register ? { register: start.register } : {}),
        groups,
        fields: cols.map(([name, type, config], i) => {
          const key = keys[i]!;
          const rules = (start.rules ?? []).filter((r) => r.whenFieldKey === key);
          return {
            key,
            name,
            type,
            ...(config ? { config } : {}),
            ...(rules.length ? { rules } : {}),
          };
        }),
        views: [],
        items: [],
        ...(start.tabs ? { tabs: start.tabs } : {}),
        ...(start.subitems ? { subitems: start.subitems } : {}),
        forms: (start.forms ?? []).map((f) => {
          const g = groupRef(f.groupRef);
          const { groupRef: _g, ...rest } = f;
          void _g;
          return { ...rest, ...(g ? { groupRef: g } : {}) };
        }),
        columnGroups: [],
      },
    ],
    automations: (start.pack?.automations ?? []) as unknown as PackManifest['automations'],
    dashboards: (start.pack?.dashboards ?? []) as unknown as PackManifest['dashboards'],
  };
}
