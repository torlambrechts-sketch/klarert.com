import { z } from 'zod';
import type { Ctx, Json } from '../types';
import { base, cmpNumber, cmpText, emptyLast, isBlank, parseJson } from './helpers';
import { resolveFieldType } from './resolve';
import type { FieldTypeDef, LabelOption } from './types';

export const AI_STATUSES = ['proposed', 'accepted', 'rejected'] as const;
export type AiStatus = (typeof AI_STATUSES)[number];

export interface AiValue {
  proposal: Json;
  source: string;
  model: string;
  status: AiStatus;
  /** Who accepted or rejected the proposal; null while proposed. */
  by: string | null;
  at: string;
}

export interface AiConfig {
  targetFieldKey: string;
}

const json = z.custom<Json>((x) => x !== undefined);

const valueSchema = z.object({
  proposal: json,
  source: z.string(),
  model: z.string(),
  status: z.enum(AI_STATUSES),
  by: z.string().min(1).nullable(),
  at: z.string().min(1),
});

// The status is the option a filter, condition or kanban sees.
const OPTIONS: LabelOption[] = [
  { id: 'proposed', label: 'Proposed', color: 'blue' },
  { id: 'accepted', label: 'Accepted', color: 'green' },
  { id: 'rejected', label: 'Rejected', color: 'grey' },
];

const isEmpty = (v: AiValue | null) => !v || isBlank(v.proposal);

/** A full stored value, or a bare proposal (text, number, list) as a new proposal. */
function normalize(input: unknown, _cfg: AiConfig, ctx: Ctx): AiValue | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'object' && !Array.isArray(input)) {
    const raw = input as Record<string, unknown>;
    const parsed = valueSchema.safeParse({
      source: '',
      model: '',
      status: 'proposed',
      by: null,
      at: ctx.now.toISOString(),
      ...raw,
    });
    return parsed.success && !isBlank(parsed.data.proposal) ? parsed.data : null;
  }
  if (
    isBlank(input) ||
    (!['string', 'number', 'boolean'].includes(typeof input) && !Array.isArray(input))
  )
    return null;
  const proposal = typeof input === 'string' ? input.trim() : (input as Json);
  return {
    proposal,
    source: '',
    model: '',
    status: 'proposed',
    by: null,
    at: ctx.now.toISOString(),
  };
}

function proposalText(proposal: Json, cfg: AiConfig, ctx: Ctx): string {
  const target = cfg.targetFieldKey ? ctx.fieldsByKey.get(cfg.targetFieldKey) : undefined;
  const def = target && resolveFieldType(target.type);
  const nv = target && def ? def.normalize(proposal, target.config, ctx) : null;
  if (target && def && nv !== null) return def.toText(nv, target.config, ctx);
  if (Array.isArray(proposal)) return proposal.filter((x) => typeof x !== 'object').join(', ');
  return proposal === null || typeof proposal === 'object' ? '' : String(proposal);
}

const text = (v: AiValue | null, cfg: AiConfig, ctx: Ctx) => {
  if (isEmpty(v)) return '';
  const label = OPTIONS.find((o) => o.id === v!.status)!.label;
  const shown = proposalText(v!.proposal, cfg, ctx);
  return shown ? `${label}: ${shown}` : '';
};

export const ai: FieldTypeDef<AiValue, AiConfig> = base<AiValue, AiConfig>({
  id: 'ai',
  label: 'AI proposal',
  family: 'computed',
  description: 'A value suggested by AI that a person accepts into another field or rejects.',
  storage: 'values',
  kind: 'option',
  valueSchema,
  configSchema: z.object({ targetFieldKey: z.string() }),
  defaultConfig: () => ({ targetFieldKey: '' }),
  defaultWidth: 180,
  formAllowed: false,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed'],
  normalize,
  parseText: (t, cfg, ctx) => {
    const trimmed = t.trim();
    const parsed = trimmed.startsWith('{') ? parseJson(trimmed) : undefined;
    return normalize(parsed ?? trimmed, cfg, ctx);
  },
  isEmpty,
  toText: text,
  compare: (a, b, cfg, ctx) =>
    emptyLast(a, b, isEmpty, (x, y) => {
      const rank = (v: AiValue) => AI_STATUSES.indexOf(v.status);
      return cmpNumber(rank(x), rank(y)) || cmpText(text(x, cfg, ctx), text(y, cfg, ctx));
    }),
  options: () => OPTIONS.map((o) => ({ ...o })),
});
