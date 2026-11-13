// Wizard starts from templates/starts.json, validated at load (CLAUDE.md: templates are validated by Zod).
import { z } from 'zod';
import raw from '../../templates/starts.json';
import { isFieldTypeId } from '@/engine/fields/registry';
import { fieldKeyFromName } from '@/engine/ordering';
import { formProblems, subitemSetSchema, templateForm, templateTab } from '@/lib/templates/schema';

const startSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    itemLabel: z.string().optional(),
    groups: z.array(z.string()).optional(),
    fields: z
      .array(
        z.tuple([
          z.string(),
          z.string().refine(isFieldTypeId, { message: 'Unknown field type in starts.json' }),
        ]),
      )
      .optional(),
    /** The side-menu folder a sheet from this start goes into (created when missing, docs/02 §1). */
    folder: z.string().trim().min(1).max(80).optional(),
    /** Starts that come with sub-items (CAPA, audit, incident, control, treatment): the set the wizard turns on. */
    subitems: subitemSetSchema.optional(),
    /** The sheet's starting tabs (built-in view types; the ones left out are hidden in More). */
    tabs: z.array(templateTab).min(1).optional(),
    /** Ready-made forms (group by name, fields by the keys the columns get). Created as drafts for owners and admins. */
    forms: z.array(templateForm).optional(),
  })
  .superRefine((s, ctx) => {
    const keys = startFieldKeys(s.fields ?? []);
    for (const p of formProblems(s.forms ?? [], new Set(keys), (g) => (s.groups ?? []).includes(g)))
      ctx.addIssue({ code: 'custom', path: ['forms', p.index], message: p.message });
  });

/** The keys a start's columns get (the same rule createSheet uses). */
export function startFieldKeys(fields: readonly (readonly [string, string])[]): string[] {
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
  'csv',
  'copy',
] as const;
export type StartId = (typeof START_IDS)[number];

/** Starts that come with a column list (everything but CSV import and copy). */
export const COLUMN_STARTS = STARTS.filter((s) => s.fields);

export function startById(id: string): Start | undefined {
  return STARTS.find((s) => s.id === id);
}
