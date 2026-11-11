import { z } from 'zod';
import { base, cmpNumber, emptyLast, isBlank } from './helpers';
import type { LabelOption } from './types';

export interface QuestionOption {
  id: string;
  label: string;
  score: number;
}

export interface QuestionConfig {
  question: string;
  options: QuestionOption[];
  weight: number;
}

function find(cfg: QuestionConfig, input: unknown): QuestionOption | undefined {
  if (typeof input === 'number') return cfg.options.find((o) => o.score === input);
  if (typeof input !== 'string') return undefined;
  const t = input.trim().toLowerCase();
  return (
    cfg.options.find((o) => o.id === input.trim()) ??
    cfg.options.find((o) => o.label.toLowerCase() === t) ??
    cfg.options.find((o) => t !== '' && String(o.score) === t)
  );
}

const optionOf = (v: string | null, cfg: QuestionConfig) => cfg.options.find((o) => o.id === v);
const scoreOf = (v: string | null, cfg: QuestionConfig) => optionOf(v, cfg)?.score ?? null;

export const question = base<string, QuestionConfig>({
  id: 'question',
  label: 'Question',
  family: 'compliance',
  description: 'A scored question with fixed answers.',
  storage: 'values',
  kind: 'option',
  valueSchema: z.string().min(1),
  configSchema: z.object({
    question: z.string(),
    options: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1).max(80),
          score: z.number().finite(),
        }),
      )
      .min(1),
    weight: z.number().finite(),
  }),
  defaultConfig: () => ({
    question: 'How well is this in place?',
    options: [
      { id: 'q0', label: 'Not in place', score: 0 },
      { id: 'q1', label: 'Partly', score: 1 },
      { id: 'q2', label: 'Fully', score: 2 },
    ],
    weight: 1,
  }),
  defaultWidth: 160,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed'],
  normalize: (input, cfg) => find(cfg, input)?.id ?? null,
  parseText: (t, cfg) => find(cfg, t)?.id ?? null,
  isEmpty: (v) => isBlank(v),
  toText: (v, cfg) => optionOf(v, cfg)?.label ?? '',
  toNumber: (v, cfg) => {
    const s = scoreOf(v, cfg);
    return s === null ? null : s * cfg.weight;
  },
  compare: (a, b, cfg) =>
    emptyLast(
      a,
      b,
      (v) => scoreOf(v, cfg) === null,
      (x, y) => cmpNumber(scoreOf(x, cfg)!, scoreOf(y, cfg)!),
    ),
  options: (cfg): LabelOption[] =>
    cfg.options.map((o) => ({ id: o.id, label: o.label, color: 'grey' })),
});
