import { z } from 'zod';
import { base, cmpNumber, emptyLast, issue, parseJson, splitList } from './helpers';

export type ChecklistAnswer = 'yes' | 'no' | 'na';

export interface ChecklistEntry {
  a: ChecklistAnswer;
  note?: string;
  by?: string;
  at?: string;
}

export interface ChecklistValue {
  answers: Record<string, ChecklistEntry>;
}

export interface ChecklistLine {
  id: string;
  text: string;
  noteOnNo: boolean;
}

export interface ChecklistConfig {
  lines: ChecklistLine[];
}

const entrySchema = z.object({
  a: z.enum(['yes', 'no', 'na']),
  note: z.string().optional(),
  by: z.string().optional(),
  at: z.string().optional(),
});

function answerOf(input: unknown): ChecklistAnswer | null {
  if (typeof input === 'boolean') return input ? 'yes' : 'no';
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (s === 'yes' || s === 'y') return 'yes';
  if (s === 'no' || s === 'n') return 'no';
  if (s === 'na' || s === 'n/a' || s === 'not applicable') return 'na';
  return null;
}

function normalizeChecklist(input: unknown, cfg: ChecklistConfig): ChecklistValue | null {
  const answers: Record<string, ChecklistEntry> = {};
  const lineIds = cfg.lines.map((l) => l.id);
  if (Array.isArray(input)) {
    // Answers in line order: ["yes", "no", "na"]; blanks leave a line open.
    if (input.length > lineIds.length) return null;
    for (const [i, x] of input.entries()) {
      if (x === null || x === '') continue;
      const a = answerOf(x);
      if (!a) return null;
      answers[lineIds[i]!] = { a };
    }
  } else if (input && typeof input === 'object') {
    const raw = (input as Record<string, unknown>).answers;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    for (const [id, e] of Object.entries(raw as Record<string, unknown>)) {
      if (!lineIds.includes(id)) continue;
      const obj = e && typeof e === 'object' ? (e as Record<string, unknown>) : { a: e };
      const r = entrySchema.safeParse({ ...obj, a: answerOf(obj.a) });
      if (!r.success) return null;
      answers[id] = Object.fromEntries(Object.entries(r.data).filter(([, x]) => x !== undefined)) as ChecklistEntry;
    }
  } else {
    return null;
  }
  return Object.keys(answers).length ? { answers } : null;
}

function counts(v: ChecklistValue | null, cfg: ChecklistConfig) {
  let yes = 0;
  let no = 0;
  let na = 0;
  for (const l of cfg.lines) {
    const a = v?.answers[l.id]?.a;
    if (a === 'yes') yes += 1;
    else if (a === 'no') no += 1;
    else if (a === 'na') na += 1;
  }
  return { yes, no, na, open: cfg.lines.length - yes - no - na };
}

/** Number of "No" answers; the checklist_no trigger fires when it increases. */
export function countNo(v: ChecklistValue | null, cfg: ChecklistConfig): number {
  return counts(v, cfg).no;
}

/** Answered lines out of all lines (the progress field reads this). */
export function checklistProgress(v: ChecklistValue | null, cfg: ChecklistConfig) {
  const c = counts(v, cfg);
  const lines = cfg.lines.length;
  const answered = lines - c.open;
  return { answered, lines, pct: lines ? (answered / lines) * 100 : null };
}

/** Score % = yes / (yes + no); null when there is no yes or no answer. */
function score(v: ChecklistValue | null, cfg: ChecklistConfig): number | null {
  const { yes, no } = counts(v, cfg);
  return yes + no === 0 ? null : (yes / (yes + no)) * 100;
}

const isEmpty = (v: ChecklistValue | null) => !v || !v.answers || Object.keys(v.answers).length === 0;

export const checklist = base<ChecklistValue, ChecklistConfig>({
  id: 'checklist',
  label: 'Checklist',
  family: 'compliance',
  description: 'A list of checks answered Yes, No or N/A, with a score.',
  storage: 'values',
  kind: 'number',
  valueSchema: z.object({ answers: z.record(z.string(), entrySchema) }),
  configSchema: z.object({
    lines: z.array(z.object({ id: z.string().min(1), text: z.string().min(1), noteOnNo: z.boolean() })).min(1),
  }),
  defaultConfig: () => ({ lines: [{ id: 'l1', text: 'First check', noteOnNo: true }] }),
  defaultWidth: 150,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed', 'number_above', 'number_below', 'checklist_no'],
  normalize: (input, cfg) => normalizeChecklist(input, cfg),
  parseText: (t, cfg) => {
    const s = t.trim();
    if (s.startsWith('{')) return normalizeChecklist(parseJson(s), cfg);
    if (!s) return null;
    return normalizeChecklist(s.startsWith('[') ? parseJson(s) : splitList(s), cfg);
  },
  validate: (v, field) =>
    field.config.lines
      .filter((l) => l.noteOnNo && v?.answers[l.id]?.a === 'no' && !v.answers[l.id]?.note?.trim())
      .map((l) => issue(field, 'note_required', `Add a note to "${l.text}" explaining the No.`, 'warning')),
  isEmpty,
  toText: (v, cfg) => {
    if (isEmpty(v)) return '';
    const c = counts(v, cfg);
    return `${c.yes} yes, ${c.no} no, ${c.na} n/a, ${c.open} open`;
  },
  toNumber: (v, cfg) => score(v, cfg),
  compare: (a, b, cfg) =>
    emptyLast(a, b, isEmpty, (x, y) => cmpNumber(score(x, cfg) ?? -1, score(y, cfg) ?? -1)),
});
