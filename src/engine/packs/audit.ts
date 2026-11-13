// Pack entries of the activity log (pack.installed, pack.archived on the workspace chain) as sentences. Pure.
import type { Json } from '../types';
import { countsText, type PackCounts } from './plan';

export const PACK_ACTIONS = [
  'pack.installed',
  'pack.extended',
  'pack.upgraded',
  'pack.archived',
] as const;

type Obj = Record<string, Json>;
const obj = (v: Json | null | undefined): Obj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
const num = (v: Json | undefined) => (typeof v === 'number' ? v : 0);

/** "Installed Supplier management 1.0.0: 3 sheets, …" / "Archived Supplier management 1.0.0: …". */
export function packLogText(action: string, newValue: Json | null): string {
  const v = obj(newValue);
  const name =
    `${typeof v.title === 'string' ? v.title : String(v.pack_key ?? 'a pack')} ${String(v.version ?? '')}`.trim();
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
        ? v.level_name
        : typeof v.level === 'string'
          ? v.level
          : null;
    if (action === 'pack.extended')
      return `Added the ${level ?? 'next'} level to ${name}: ${countsText(counts)}.`;
    return `Installed ${name}${level ? ` (${level})` : ''}: ${countsText(counts)}.`;
  }
  if (action === 'pack.upgraded') {
    const title = typeof v.title === 'string' ? v.title : String(v.pack_key ?? 'a pack');
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
  return action;
}
