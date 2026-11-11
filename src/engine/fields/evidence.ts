import { z } from 'zod';
import type { FileRow, TriggerId } from '../types';
import { base, cmpNumber, cmpText, daysBetween, emptyLast, isIsoDate, parseJson } from './helpers';
import type { FieldTypeDef } from './types';

export type Freshness = 'current' | 'expiring' | 'expired' | 'none';

/** Days before expiry when evidence counts as expiring (docs/01 FR-31). */
export const EXPIRING_DAYS = 30;

export const fileRowSchema = z.object({
  id: z.string().min(1),
  itemId: z.string().min(1),
  fieldId: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  source: z.string(),
  collectedAt: z.string().min(1),
  validUntil: z.string().refine(isIsoDate).nullable(),
  replacedBy: z.string().nullable(),
});

const isEmpty = (v: FileRow[] | null) => !Array.isArray(v) || v.length === 0;

/** Earliest valid_until among current files, or null. */
export function earliestValidUntil(rows: FileRow[] | null): string | null {
  let min: string | null = null;
  for (const r of rows ?? [])
    if (r.validUntil && (min === null || r.validUntil < min)) min = r.validUntil;
  return min;
}

export function freshness(rows: FileRow[] | null, today: string): Freshness {
  if (isEmpty(rows)) return 'none';
  const exp = earliestValidUntil(rows);
  if (exp === null) return 'current';
  const left = daysBetween(exp, today);
  if (left < 0) return 'expired';
  return left <= EXPIRING_DAYS ? 'expiring' : 'current';
}

function normalizeRows(input: unknown, multiple: boolean): FileRow[] | null {
  const arr = Array.isArray(input) ? input : input && typeof input === 'object' ? [input] : null;
  if (!arr) return null;
  const rows: FileRow[] = [];
  for (const x of arr) {
    const r = fileRowSchema.safeParse(x);
    if (!r.success) return null;
    if (r.data.replacedBy === null) rows.push(r.data);
  }
  if (rows.length === 0) return null;
  return multiple ? rows : rows.slice(0, 1);
}

const count = (n: number) => (n === 1 ? '1 file' : `${n} files`);

/** File types (evidence, attachment). Values are the current rows of the files table, read via ctx.files. */
export function fileType<C extends { multiple: boolean; accept: string[] }>(spec: {
  id: string;
  label: string;
  description: string;
  defaultWidth: number;
  expiry: boolean;
  configSchema: z.ZodType<C>;
  defaultConfig: () => C;
}): FieldTypeDef<FileRow[], C> {
  const triggers: TriggerId[] = spec.expiry
    ? ['field_changed', 'date_arrives', 'evidence_expiring']
    : ['field_changed'];
  const exp = (v: FileRow[] | null) => (spec.expiry ? earliestValidUntil(v) : null);
  return base<FileRow[], C>({
    id: spec.id,
    label: spec.label,
    family: 'compliance',
    description: spec.description,
    storage: 'files',
    kind: 'file',
    valueSchema: z.array(fileRowSchema),
    configSchema: spec.configSchema,
    defaultConfig: spec.defaultConfig,
    defaultWidth: spec.defaultWidth,
    formAllowed: true,
    kanbanCapable: false,
    calendarCapable: spec.expiry,
    triggers,
    normalize: (input, cfg) => normalizeRows(input, cfg.multiple),
    // Pasted text cannot carry a file; only our own JSON export round-trips.
    parseText: (t, cfg) => {
      const j = parseJson(t.trim());
      return j === undefined ? null : normalizeRows(j, cfg.multiple);
    },
    compute: (item, field, ctx) => {
      const rows = ctx.files(item.id, field.id);
      return rows.length ? rows : null;
    },
    isEmpty,
    toText: (v, _cfg, ctx) => {
      if (isEmpty(v)) return '';
      return spec.expiry ? `${count(v!.length)} · ${freshness(v, ctx.today)}` : count(v!.length);
    },
    toNumber: (v) => (isEmpty(v) ? null : v!.length),
    toDate: (v) => exp(v),
    compare: (a, b) =>
      emptyLast(a, b, isEmpty, (x, y) => {
        const ex = exp(x);
        const ey = exp(y);
        if (ex !== ey) return ex === null ? 1 : ey === null ? -1 : cmpText(ex, ey);
        return cmpNumber(x.length, y.length);
      }),
  });
}

export interface EvidenceConfig {
  validDays: number;
  multiple: boolean;
  accept: string[];
}

export const evidence = fileType<EvidenceConfig>({
  id: 'evidence',
  label: 'Evidence',
  description: 'Files that prove something, with a date they stay valid until.',
  defaultWidth: 150,
  expiry: true,
  configSchema: z.object({
    validDays: z.number().int().positive(),
    multiple: z.boolean(),
    accept: z.array(z.string()),
  }),
  defaultConfig: () => ({ validDays: 365, multiple: true, accept: [] }),
});
