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
  const name =
    `${titleOf(v)} ${String(v.version ?? '')}`.trim();
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
    return `Installed ${name}${level ? ` (${level})` : ''}: ${countsText(counts)}.`;
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
  // Create wizard bundles (docs/11 Bundles): the name the person gave, the pack it came from
  const bundle = typeof v.name === 'string' ? v.name : name;
  if (action === 'bundle.created') return `Created ${bundle} via Create from ${name}.`;
  if (action === 'bundle.reviewed') return `Marked ${bundle} reviewed.`;
  return action;
}
