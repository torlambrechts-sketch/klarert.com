// Wizard starts from templates/starts.json, validated at load (CLAUDE.md: templates are validated by Zod).
import { z } from 'zod';
import raw from '../../templates/starts.json';
import { isFieldTypeId } from '@/engine/fields/registry';
import { subitemSetSchema, templateTab } from '@/lib/templates/schema';

const startSchema = z.object({
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
  /** Starts that come with sub-items (CAPA, audit, incident, control, treatment): the set the wizard turns on. */
  subitems: subitemSetSchema.optional(),
  /** The sheet's starting tabs (built-in view types; the ones left out are hidden in More). */
  tabs: z.array(templateTab).min(1).optional(),
});

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
