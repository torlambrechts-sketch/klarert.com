// The statement of applicability export (docs/11 Audit outputs): one row per requirement of an adopted library (docs/12),
// narrowed by the library's SoA view when it has one. Values are read through the field registry (visibleTextOf), so
// a restricted field reads "Restricted" and nothing is made from what the person cannot see. Nothing here knows a
// framework: the library's field keys (LIBRARY_KEYS) are data written at adoption. Pure.
import { applicabilityState } from '../fields/applicability';
import { formatDateTime } from '../fields/helpers';
import { LIBRARY_KEYS } from '../frameworks/pack';
import { matchesAll } from '../conditions';
import { hiddenFor, isDoneOf, RESTRICTED_TEXT, visibleTextOf } from '../values';
import type { Condition, Ctx, Field, Item } from '../types';
import { toCsv } from './csv';

export const SOA_COLUMNS = [
  'Ref',
  'Title',
  'Applicable',
  'Justification',
  'Implementation status',
  'Owner',
  'Evidence',
  'Linked controls and risks',
  'Last reviewed',
] as const;

export interface SoaEvidence {
  name: string;
  /** A link back to the item that holds the file (files themselves need a signed link). */
  href?: string;
}

export interface SoaLinked {
  displayId: string;
  name: string;
  sheetName: string;
}

export interface SoaInput {
  fields: Field[];
  items: Item[];
  ctx: Ctx;
  /** sheets.settings.framework.refFieldKey */
  refFieldKey: string;
  /** The SoA view's filters (empty: every requirement). */
  filters?: Condition[];
  /** Current evidence files per library item. */
  evidence: ReadonlyMap<string, SoaEvidence[]>;
  /** Items linked to each requirement (controls, risks, documents), either direction. */
  linked: ReadonlyMap<string, SoaLinked[]>;
}

export interface SoaRow {
  itemId: string;
  displayId: string;
  ref: string;
  title: string;
  applicability: 'applicable' | 'not_applicable' | null;
  applicable: string;
  justification: string;
  status: string;
  implemented: boolean;
  owner: string;
  evidence: SoaEvidence[];
  linked: string[];
  lastReviewed: string;
}

export interface SoaCounts {
  total: number;
  applicable: number;
  notApplicable: number;
  undecided: number;
  implemented: number;
}

export interface Soa {
  rows: SoaRow[];
  counts: SoaCounts;
}

export interface SoaHeader {
  workspace: string;
  framework: string;
  licence: string;
  generatedAt: string;
  generatedBy: string;
  timeZone: string;
  /** "Statement of applicability" or "All requirements". */
  scope: string;
}

const byRef = (a: SoaRow, b: SoaRow) =>
  a.ref.localeCompare(b.ref, 'en', { numeric: true, sensitivity: 'base' });

export function buildSoa(input: SoaInput): Soa {
  const { ctx, fields } = input;
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const field = (key: string) => byKey.get(key);
  const text = (item: Item, f: Field | undefined) => (f ? visibleTextOf(item, f, ctx) : '');
  const ref = field(input.refFieldKey);
  const applicable = field(LIBRARY_KEYS.applicable);
  const justification = field(LIBRARY_KEYS.justification);
  const status = field(LIBRARY_KEYS.status);
  const owner = field(LIBRARY_KEYS.owner);
  const evidence = field(LIBRARY_KEYS.evidence);
  const reviewed = field(LIBRARY_KEYS.lastReviewed);
  const statusHidden = !status || hiddenFor(status, ctx);
  const applicableHidden = !applicable || hiddenFor(applicable, ctx);
  const evidenceHidden = !!evidence && hiddenFor(evidence, ctx);
  const filters = input.filters ?? [];
  const rows = input.items
    .filter((it) => !it.archivedAt && (filters.length === 0 || matchesAll(filters, it, ctx)))
    .map((it): SoaRow => {
      return {
        itemId: it.id,
        displayId: it.displayId,
        ref: text(it, ref) || it.displayId,
        title: it.name,
        applicability: applicableHidden
          ? null
          : applicabilityState(applicable ? it.values[applicable.id] : null),
        applicable: text(it, applicable),
        justification: text(it, justification),
        status: text(it, status),
        implemented: !statusHidden && !!status && isDoneOf(it, status, ctx),
        owner: text(it, owner),
        evidence: evidenceHidden ? [{ name: RESTRICTED_TEXT }] : (input.evidence.get(it.id) ?? []),
        linked: (input.linked.get(it.id) ?? []).map((l) => `${l.displayId} ${l.name} (${l.sheetName})`),
        lastReviewed: text(it, reviewed),
      };
    })
    .sort(byRef);
  const counts: SoaCounts = {
    total: rows.length,
    applicable: rows.filter((r) => r.applicability === 'applicable').length,
    notApplicable: rows.filter((r) => r.applicability === 'not_applicable').length,
    undecided: rows.filter((r) => r.applicability === null).length,
    implemented: rows.filter((r) => r.implemented).length,
  };
  return { rows, counts };
}

/** The header lines every SoA output carries (print page, CSV preamble, the audit pack). */
export function soaHeaderLines(h: SoaHeader): [string, string][] {
  return [
    ['Workspace', h.workspace],
    ['Framework', h.framework],
    ['Scope', h.scope],
    ['Licence', h.licence],
    ['Generated', `${formatDateTime(h.generatedAt, h.timeZone)} by ${h.generatedBy}`],
  ];
}

export function soaTable(soa: Soa): string[][] {
  return [
    [...SOA_COLUMNS],
    ...soa.rows.map((r) => [
      r.ref,
      r.title,
      r.applicable,
      r.justification,
      r.status,
      r.owner,
      r.evidence.map((e) => (e.href ? `${e.name} <${e.href}>` : e.name)).join('; '),
      r.linked.join('; '),
      r.lastReviewed,
    ]),
  ];
}

/** The SoA as CSV: a short header block, an empty row, then the table. */
export function soaCsv(soa: Soa, header: SoaHeader): string {
  return toCsv(
    [['Statement of applicability'], ...soaHeaderLines(header), [], ...soaTable(soa)],
    { bom: true },
  );
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * The SoA as one standalone HTML page that prints to PDF cleanly (the audit pack's copy; the app has its own print
 * page). Black on white, system fonts, a repeating table header, no scripts and nothing loaded from elsewhere.
 */
export function soaHtml(soa: Soa, header: SoaHeader): string {
  const head = soaHeaderLines(header)
    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`)
    .join('');
  const rows = soaTable(soa)
    .slice(1)
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('\n');
  const c = soa.counts;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Statement of applicability · ${escapeHtml(header.framework)}</title>
<style>
@page { size: A4 landscape; margin: 12mm; }
body { font: 10pt/1.4 system-ui, sans-serif; color: black; background: white; margin: 0; }
h1 { font-size: 16pt; margin: 0 0 8px; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0 0 12px; }
dt { font-weight: 600; } dd { margin: 0; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid silver; padding: 4px 6px; text-align: left; vertical-align: top; }
thead { display: table-header-group; } tr { break-inside: avoid; }
p { margin: 0 0 12px; }
</style></head><body>
<h1>Statement of applicability</h1>
<dl>${head}</dl>
<p>${c.total} requirements · ${c.applicable} applicable · ${c.notApplicable} not applicable · ${c.undecided} to decide · ${c.implemented} implemented</p>
<table><thead><tr>${SOA_COLUMNS.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
<tbody>
${rows}
</tbody></table>
</body></html>
`;
}
