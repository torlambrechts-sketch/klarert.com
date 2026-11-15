// Wizard starts from templates/starts.json, validated at load (CLAUDE.md: templates are validated by Zod).
import { z } from 'zod';
import raw from '../../templates/starts.json';
import { isFieldTypeId } from '@/engine/fields/registry';
import { fieldKeyFromName } from '@/engine/ordering';
import {
  formProblems,
  statusRuleSchema,
  subitemSetSchema,
  templateForm,
  templateTab,
} from '@/lib/templates/schema';

const startSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    itemLabel: z.string().optional(),
    groups: z.array(z.string()).optional(),
    /** [name, type] or [name, type, config]: the config replaces the type's default (status options …). */
    fields: z
      .array(
        z.union([
          z.tuple([
            z.string(),
            z.string().refine(isFieldTypeId, { message: 'Unknown field type in starts.json' }),
          ]),
          z.tuple([
            z.string(),
            z.string().refine(isFieldTypeId, { message: 'Unknown field type in starts.json' }),
            z.record(z.string(), z.json()),
          ]),
        ]),
      )
      .optional(),
    /** A documents register (docs/02 §14): its items are controlled documents with the approval workflow. */
    register: z.literal('documents').optional(),
    /** Status rules of the start's fields, by field key (docs/03 §6). */
    rules: z.array(statusRuleSchema).optional(),
    /** The side-menu folder a sheet from this start goes into (created when missing, docs/02 §1). */
    folder: z.string().trim().min(1).max(80).optional(),
    /** Starts that come with sub-items (CAPA, audit, incident, control, treatment): the set the wizard turns on. */
    subitems: subitemSetSchema.optional(),
    /** The sheet's starting tabs (built-in view types; the ones left out are hidden in More). */
    tabs: z.array(templateTab).min(1).optional(),
    /** Ready-made forms (group by name, fields by the keys the columns get). Created as drafts for owners and admins. */
    forms: z.array(templateForm).optional(),
    /**
     * What the start adds when it is offered as a pack (docs/11): the pack's version, its automations and dashboards
     * (sheet ref = the start's id as a key) and optional requirements. Checked by the pack manifest schema; the
     * wizard ignores it.
     */
    pack: z
      .object({
        version: z.string(),
        automations: z.array(z.record(z.string(), z.json())).optional(),
        dashboards: z.array(z.record(z.string(), z.json())).optional(),
        /**
         * Packs it works on when they are live (docs/11 Optional requirements), what it adds to their sheets, and the
         * optional pack without which the start's own sheet is made (CAPA: Core's Nonconformities and CAPA).
         */
        requires: z.array(z.record(z.string(), z.json())).optional(),
        extends: z.array(z.record(z.string(), z.json())).optional(),
        onlyWithout: z.string().optional(),
      })
      .optional(),
  })
  .superRefine((s, ctx) => {
    const keys = startFieldKeys(s.fields ?? []);
    for (const p of formProblems(s.forms ?? [], new Set(keys), (g) => (s.groups ?? []).includes(g)))
      ctx.addIssue({ code: 'custom', path: ['forms', p.index], message: p.message });
  });

/** The keys a start's columns get (the same rule createSheet uses). */
export function startFieldKeys(
  fields: readonly (readonly [string, string, ...unknown[]])[],
): string[] {
  const taken: string[] = [];
  for (const [name] of fields) taken.push(fieldKeyFromName(name, taken));
  return taken;
}

const startsFile = z.object({
  starts: z.array(startSchema),
  rules: z.object({ idPrefix: z.string(), fieldKey: z.string(), csvTypes: z.string() }),
});

export type Start = z.infer<typeof startSchema>;
export const STARTS: Start[] = startsFile.parse(raw).starts;

export const START_IDS = [
  'blank',
  'register',
  'tracker',
  'log',
  'inspection',
  'capa',
  'audit',
  'incident',
  'control',
  'treatment',
  'documents',
  'csv',
  'copy',
] as const;
export type StartId = (typeof START_IDS)[number];

/** Starts that come with a column list (everything but CSV import and copy). */
export const COLUMN_STARTS = STARTS.filter((s) => s.fields);

export function startById(id: string): Start | undefined {
  return STARTS.find((s) => s.id === id);
}
