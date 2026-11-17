// Pack entries of the activity log (pack.installed, pack.archived on the workspace chain) as sentences. Pure.
import type { Json } from '../types';
import { countsText, type PackCounts } from './plan';
import { levelName, packTitle } from './words';

export const PACK_ACTIONS = [
  'pack.installed',
  'pack.extended',
  'pack.upgraded',
  'pack.archived',
  'bundle.created',
  'bundle.reviewed',
  'pack.automations_mode',
  'pack.settings_changed',
  // a workspace's own packs (docs/11 Your own packs)
  'pack.published',
  'pack.withdrawn',
  'pack.shared',
] as const;

type Obj = Record<string, Json>;
const obj = (v: Json | null | undefined): Obj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
const num = (v: Json | undefined) => (typeof v === 'number' ? v : 0);
/** The pack's title as people see it (engine/packs/words.ts), also for entries written before the rename. */
const titleOf = (v: Obj) =>
  typeof v.title === 'string' ? packTitle(v.title) : String(v.pack_key ?? 'a pack');

/** "Installed Supplier management 1.0.0: 3 sheets, …" / "Archived Supplier management 1.0.0: …". */
export function packLogText(action: string, newValue: Json | null): string {
  const v = obj(newValue);
  const name = `${titleOf(v)} ${String(v.version ?? '')}`.trim();
  const c = obj(v.counts);
  if (action === 'pack.installed' || action === 'pack.extended') {
    const counts: PackCounts = {
      folders: num(c.folders),
      sheets: num(c.sheets),
      fields: num(c.fields),
      views: num(c.views),
      forms: num(c.forms),
      items: num(c.items),
      documents: 0,
      libraryItems: 0,
      links: num(c.links),
      automations: num(c.automations),
      dashboards: num(c.dashboards),
    };
    const level =
      typeof v.level_name === 'string'
        ? levelName(v.level_name)
        : typeof v.level === 'string'
          ? v.level
          : null;
    if (action === 'pack.extended')
      return `Added the ${level ?? 'next'} level to ${name}: ${countsText(counts)}.`;
    const from = v.source === 'private' ? ' (your own pack, from another workspace)' : '';
    return `Installed ${name}${level ? ` (${level})` : ''}${from}: ${countsText(counts)}.`;
  }
  if (action === 'pack.upgraded') {
    const title = titleOf(v);
    const added = obj(c.added);
    const nAdded = Object.values(added).reduce<number>((n, x) => n + num(x), 0);
    const s = obj(v.summary);
    const conflicts = num(s.conflicts);
    const parts = [
      `${nAdded} added`,
      `${num(c.changed)} changed`,
      `${num(c.archived) + num(c.turned_off)} archived or turned off`,
    ];
    const settled = conflicts
      ? `; ${conflicts} ${conflicts === 1 ? 'conflict' : 'conflicts'} (${num(s.theirs)} took the pack's)`
      : '';
    return `Updated ${title} from ${String(v.from_version ?? '?')} to ${String(v.version ?? '?')}: ${parts.join(', ')}${settled}.`;
  }
  if (action === 'pack.archived') {
    const parts = [
      `${num(c.sheets)} ${num(c.sheets) === 1 ? 'sheet' : 'sheets'} archived`,
      num(c.folders)
        ? `${num(c.folders)} ${num(c.folders) === 1 ? 'folder' : 'folders'} archived`
        : '',
      `${num(c.automations)} ${num(c.automations) === 1 ? 'automation' : 'automations'} turned off`,
      num(c.dashboards)
        ? `${num(c.dashboards)} ${num(c.dashboards) === 1 ? 'dashboard' : 'dashboards'} archived`
        : '',
    ].filter(Boolean);
    return `Archived ${name}: ${parts.join(', ')}. Items and the activity log are kept.`;
  }
  if (action === 'pack.automations_mode') {
    const title = titleOf(v);
    const n = num(v.count);
    const what = `${n} ${n === 1 ? 'automation' : 'automations'}`;
    return v.mode === 'test'
      ? `Put ${what} from ${title} in test mode.`
      : `Turned on ${what} from ${title}: they now notify people and change items.`;
  }
  if (action === 'pack.settings_changed') {
    const title = titleOf(v);
    const labels = Object.entries(obj(v.labels)).map(([k, x]) => `${k}: ${String(x)}`);
    const n = num(v.fields);
    return `Changed the settings of ${title}${labels.length ? ` (${labels.join(', ')})` : ''}${
      n ? `: ${n} ${n === 1 ? 'default' : 'defaults'} updated` : ''
    }.`;
  }
  if (action === 'pack.published') {
    const left = Array.isArray(v.left_out) ? v.left_out.length : 0;
    const counts = obj(v.counts);
    const what = [
      num(counts.sheets)
        ? `${num(counts.sheets)} ${num(counts.sheets) === 1 ? 'sheet' : 'sheets'}`
        : '',
      num(counts.automations)
        ? `${num(counts.automations)} ${num(counts.automations) === 1 ? 'automation' : 'automations'}`
        : '',
    ].filter(Boolean);
    return `Published ${name}${what.length ? `: ${what.join(', ')}` : ''}${
      left ? `; ${left} ${left === 1 ? 'thing' : 'things'} left out` : ''
    }.`;
  }
  if (action === 'pack.withdrawn')
    return `Withdrew ${titleOf(v)}: no new installs. Workspaces that have it keep it.`;
  if (action === 'pack.shared')
    return `Installed ${name} in ${typeof v.org_name === 'string' ? v.org_name : 'another workspace'}: its admins can now take updates.`;
  // Create wizard bundles (docs/11 Bundles): the name the person gave, the pack it came from
  const bundle = typeof v.name === 'string' ? v.name : name;
  if (action === 'bundle.created') return `Created ${bundle} via Create from ${name}.`;
  if (action === 'bundle.reviewed') return `Marked ${bundle} reviewed.`;
  return action;
}
