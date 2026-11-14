// Test support (docs/11 Extends): the snapshot a workspace has after a plan was installed, made from the plan's
// payload, so tests can plan an add-on on top of the pack it requires without a database. Pure.
import type { Json } from '../types';
import type { ForeignSheet } from './extend';
import type { InstallPayload, PackSnapshot } from './plan';

type Row = Record<string, Json>;

/** The payload's ref map, as install_pack writes it. */
export function refMapOf(p: InstallPayload): Record<string, string> {
  const out: Record<string, string> = {};
  const kinds: [keyof InstallPayload, string][] = [
    ['folders', 'folder'],
    ['sheets', 'sheet'],
    ['fields', 'field'],
    ['groups', 'group'],
    ['views', 'view'],
    ['items', 'item'],
    ['automations', 'automation'],
    ['dashboards', 'dashboard'],
  ];
  for (const [list, kind] of kinds)
    for (const r of (p[list] as Row[] | undefined) ?? [])
      out[`${kind}:${String(r.ref)}`] = String(r.id);
  for (const o of p.options ?? []) out[`option:${o.ref}`] = o.field_id;
  return out;
}

/**
 * The snapshot after installing `p` (install id `installId`) into `snap`: the install, its prefixes and folders, and
 * its sheets as foreign sheets of the packs that require it. Options a payload adds are merged into the fields.
 */
export function afterInstall(
  snap: PackSnapshot,
  p: InstallPayload,
  installId: string,
  extra: InstallPayload[] = [],
): PackSnapshot {
  const all = [p, ...extra];
  const foreign: Record<string, ForeignSheet> = { ...(snap.foreign ?? {}) };
  const foreignFolders: Record<string, string> = { ...(snap.foreignFolders ?? {}) };
  for (const f of p.folders) foreignFolders[`${p.pack.key}:${String(f.ref)}`] = String(f.id);
  const fieldsOf = (sheetId: string) =>
    all.flatMap((x) => x.fields.filter((f) => f.sheet_id === sheetId));
  for (const s of p.sheets) {
    if (s.parent_sheet_id) continue;
    const sheetId = String(s.id);
    const fields = fieldsOf(sheetId).map((f) => {
      const added = all.flatMap((x) =>
        (x.options ?? []).filter((o) => o.field_id === f.id).map((o) => o.option),
      );
      const cfg = (f.config ?? {}) as Record<string, Json>;
      return {
        id: String(f.id),
        key: String(f.key),
        name: String(f.name),
        type: String(f.type),
        config: added.length
          ? { ...cfg, options: [...((cfg.options as Json[]) ?? []), ...added] }
          : (f.config as Json),
        required: !!f.required,
        locked: !!f.locked,
        description: (f.description as string | null) ?? null,
        installId: p.fields.includes(f) ? installId : 'other',
      };
    });
    const groups = all
      .flatMap((x) => x.groups.filter((g) => g.sheet_id === sheetId))
      .map((g) => ({
        id: String(g.id),
        ref: p.groups.includes(g) ? String(g.ref).slice(String(s.ref).length + 1) : null,
        name: String(g.name),
        color: String(g.color),
        installId: p.groups.includes(g) ? installId : 'other',
      }));
    const last = (rows: Row[]) =>
      rows
        .map((r) => String(r.position))
        .sort()
        .at(-1) ?? null;
    foreign[`${p.pack.key}:${String(s.ref)}`] = {
      sheetId,
      pack: p.pack.key,
      ref: String(s.ref),
      name: String(s.name),
      itemLabel: String(s.item_label),
      idPrefix: String(s.id_prefix ?? ''),
      fields,
      groups,
      lastFieldPosition: last(all.flatMap((x) => x.fields.filter((f) => f.sheet_id === sheetId))),
      lastGroupPosition: last(all.flatMap((x) => x.groups.filter((g) => g.sheet_id === sheetId))),
      lastViewPosition: last(all.flatMap((x) => x.views.filter((v) => v.sheet_id === sheetId))),
      lastItemPosition: Object.fromEntries(
        groups.flatMap((g) => {
          const at = last(all.flatMap((x) => x.items.filter((i) => i.group_id === g.id)));
          return at ? [[g.id, at]] : [];
        }),
      ),
    };
  }
  return {
    ...snap,
    prefixes: [
      ...snap.prefixes,
      ...p.sheets.flatMap((s) => (s.id_prefix ? [String(s.id_prefix)] : [])),
    ],
    folders: [
      ...snap.folders,
      ...p.folders.map((f) => ({ id: String(f.id), name: String(f.name), archived: false })),
    ],
    installs: [
      ...snap.installs,
      {
        id: installId,
        packKey: p.pack.key,
        version: p.pack.version,
        status: 'installed',
        level: p.pack.level ?? null,
        refMap: refMapOf(p),
      },
    ],
    foreign,
    foreignFolders,
  };
}
