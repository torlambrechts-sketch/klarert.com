// The Exports list on Audit outputs (docs/11 Audit outputs, owner decision 15 Nov 2026): the workspace's audit exports
// as `log_audit_export` wrote them on the workspace chain (`audit.exported`: the kind and a flat scope of known keys),
// in words: what was exported, who exported it, when and the filters used. Pure: names come in from the server.
import { formatDate, formatDateTime } from '../fields/helpers';
import type { Json } from '../types';

export const AUDIT_EXPORT_KINDS = [
  'soa.csv',
  'soa.print',
  'audit_pack',
  'management_review',
  'management_review.item',
  'data_flow_record',
] as const;
export type AuditExportKind = (typeof AUDIT_EXPORT_KINDS)[number];

export const AUDIT_EXPORT_LABEL: Record<AuditExportKind, string> = {
  'soa.print': 'Statement of applicability (print)',
  'soa.csv': 'Statement of applicability (CSV)',
  audit_pack: 'Audit pack',
  management_review: 'Management review inputs',
  'management_review.item': 'Management review inputs, added to a review',
  data_flow_record: 'Data-flow record',
};

/** Who may see the Exports list: the people who can make every export (the data-flow record included). */
export const canSeeExports = (role: string) =>
  role === 'owner' || role === 'admin' || role === 'auditor';

/** One `audit.exported` entry as the server read it. */
export interface ExportEntry {
  id: number;
  at: string;
  actorKind: string;
  actorId: string | null;
  newValue: Json | null;
}

/** Names the scope refers to by id or key; null when it is gone or not visible. */
export interface ExportNames {
  person(id: string | null): string;
  folder(id: string): string | null;
  install(id: string): string | null;
  pack(key: string): string | null;
  app(key: string): string | null;
}

export interface ExportRow {
  id: number;
  kind: string;
  what: string;
  who: string;
  /** ISO instant, for the time element. */
  atIso: string;
  /** "15 Nov 2026, 10:42" in the workspace time zone. */
  at: string;
  /** The filters used, one phrase each; "No filters" when there were none. */
  filters: string[];
  /** What the export covered, in counts, when it says. */
  covered: string | null;
}

type Scope = Record<string, Json | undefined>;

const str = (v: Json | undefined): string | null =>
  typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : null;
const num = (v: Json | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const isoDay = (v: Json | undefined): string | null => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function period(s: Scope): string | null {
  const from = isoDay(s.from);
  const to = isoDay(s.to);
  return from && to ? `Period ${formatDate(from)} to ${formatDate(to)}` : null;
}

function packScope(s: Scope, names: ExportNames): string {
  const id = str(s.folder_id);
  if (s.scope === 'folder' && id) return `Folder: ${names.folder(id) ?? 'a folder since removed'}`;
  const install = str(s.install_id);
  if (s.scope === 'install' && install)
    return `Pack: ${names.install(install) ?? 'a pack since archived'}`;
  return 'Whole workspace';
}

function filtersOf(kind: string, s: Scope, names: ExportNames): string[] {
  switch (kind) {
    case 'soa.csv':
    case 'soa.print':
      return [str(s.sheet) ?? str(s.framework), str(s.scope)].filter((x): x is string => !!x);
    case 'audit_pack': {
      const included = num(s.files_included) ?? 0;
      return [
        packScope(s, names),
        period(s),
        included > 0 ? `With ${count(included, 'evidence file', 'evidence files')}` : null,
      ].filter((x): x is string => !!x);
    }
    case 'management_review':
      return [period(s)].filter((x): x is string => !!x);
    case 'management_review.item':
      return [period(s), 'Added to a management review'].filter((x): x is string => !!x);
    case 'data_flow_record': {
      const app = str(s.app);
      const pack = str(s.pack);
      const folder = str(s.folder_id);
      const domain = str(s.domain);
      return [
        app ? `App: ${names.app(app) ?? app}` : null,
        pack ? `Pack: ${names.pack(pack) ?? pack}` : null,
        folder ? `Folder: ${names.folder(folder) ?? 'No folder'}` : null,
        domain ? `Registers domain: ${domain}` : null,
        s.differs === true ? 'Only sheets that differ from their pack' : null,
      ].filter((x): x is string => !!x);
    }
    default:
      return [];
  }
}

function coveredOf(kind: string, s: Scope): string | null {
  switch (kind) {
    case 'soa.csv':
    case 'soa.print': {
      const n = num(s.items);
      return n === null ? null : count(n, 'requirement', 'requirements');
    }
    case 'audit_pack': {
      const parts: string[] = [];
      const sheets = num(s.sheets);
      const entries = num(s.entries);
      const chains = num(s.chains);
      if (sheets !== null) parts.push(count(sheets, 'sheet', 'sheets'));
      if (entries !== null) parts.push(count(entries, 'log entry', 'log entries'));
      if (chains !== null) {
        const broken = num(s.chains_broken) ?? 0;
        parts.push(
          `${count(chains, 'chain', 'chains')} checked, ${num(s.chains_ok) ?? 0} ok${broken ? `, ${broken} broken` : ''}`,
        );
      }
      return parts.length ? parts.join(' · ') : null;
    }
    case 'data_flow_record': {
      const sheets = num(s.sheets);
      const destinations = num(s.destinations);
      if (sheets === null || destinations === null) return null;
      return `${count(sheets, 'sheet', 'sheets')} · ${count(destinations, 'destination', 'destinations')}`;
    }
    default:
      return null;
  }
}

/** One export in words. */
export function exportRow(e: ExportEntry, names: ExportNames, timeZone: string): ExportRow {
  const scope: Scope =
    e.newValue && typeof e.newValue === 'object' && !Array.isArray(e.newValue)
      ? (e.newValue as Scope)
      : {};
  const kind = str(scope.kind) ?? 'unknown';
  const filters = filtersOf(kind, scope, names);
  return {
    id: e.id,
    kind,
    what: AUDIT_EXPORT_LABEL[kind as AuditExportKind] ?? kind.replace(/[._]/g, ' '),
    who: e.actorKind === 'user' ? names.person(e.actorId) : 'Automation or system',
    atIso: e.at,
    at: formatDateTime(e.at, timeZone),
    filters: filters.length ? filters : ['No filters'],
    covered: coveredOf(kind, scope),
  };
}

/** The ids and keys a page of exports names, so the server reads only those. */
export function exportRefs(entries: ExportEntry[]) {
  const folders = new Set<string>();
  const installs = new Set<string>();
  const packs = new Set<string>();
  const apps = new Set<string>();
  for (const e of entries) {
    const s = (
      e.newValue && typeof e.newValue === 'object' && !Array.isArray(e.newValue) ? e.newValue : {}
    ) as Scope;
    const folder = str(s.folder_id);
    if (folder && folder !== 'none') folders.add(folder);
    const install = str(s.install_id);
    if (install) installs.add(install);
    const pack = str(s.pack);
    if (pack) packs.add(pack);
    const app = str(s.app);
    if (app) apps.add(app);
  }
  return { folders: [...folders], installs: [...installs], packs: [...packs], apps: [...apps] };
}
