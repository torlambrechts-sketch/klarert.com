// The 58 field types (docs/03). A new type is one file plus one line here. Installs itself into the resolver
// so computed types can reach other types without import cycles.
import { text } from './text';
import { longtext } from './longtext';
import { comment } from './comment';
import { number } from './number';
import { value } from './value';
import { percent } from './percent';
import { yesno } from './yesno';
import { check } from './check';
import { date } from './date';
import { datetime } from './datetime';
import { duration } from './duration';
import { timeline } from './timeline';
import { recurrence } from './recurrence';
import { rating } from './rating';
import { email } from './email';
import { phone } from './phone';
import { url } from './url';
import { location } from './location';
import { status } from './status';
import { dropdown } from './dropdown';
import { multiselect } from './multiselect';
import { people } from './people';
import { role } from './role';
import { team } from './team';
import { entity } from './entity';
import { country } from './country';
import { classification } from './classification';
import { severity } from './severity';
import { requirement } from './requirement';
import { controllink } from './controllink';
import { evidence } from './evidence';
import { attachment } from './attachment';
import { signature } from './signature';
import { ack } from './ack';
import { justification } from './justification';
import { applicability } from './applicability';
import { finding } from './finding';
import { checklist } from './checklist';
import { question } from './question';
import { riskmatrix } from './riskmatrix';
import { maturity } from './maturity';
import { measurement } from './measurement';
import { clock } from './clock';
import { protectedText } from './protected';
import { pdmarker } from './pdmarker';
import { retention } from './retention';
import { version } from './version';
import { link } from './link';
import { lookup } from './lookup';
import { rollup } from './rollup';
import { formula } from './formula';
import { progress } from './progress';
import { autoid } from './autoid';
import { meta } from './meta';
import { workflowstep } from './workflowstep';
import { button } from './button';
import { ai } from './ai';
import { subitems } from './subitems';
import { installFieldTypes } from './resolve';
import type { AnyFieldType, Family } from './types';

export const FIELD_TYPES = {
  text,
  longtext,
  comment,
  number,
  value,
  percent,
  yesno,
  check,
  date,
  datetime,
  duration,
  timeline,
  recurrence,
  rating,
  email,
  phone,
  url,
  location,
  status,
  dropdown,
  multiselect,
  people,
  role,
  team,
  entity,
  country,
  classification,
  severity,
  requirement,
  controllink,
  evidence,
  attachment,
  signature,
  ack,
  justification,
  applicability,
  finding,
  checklist,
  question,
  riskmatrix,
  maturity,
  measurement,
  clock,
  protected: protectedText,
  pdmarker,
  retention,
  version,
  link,
  lookup,
  rollup,
  formula,
  progress,
  autoid,
  meta,
  workflowstep,
  button,
  ai,
  subitems,
} as const satisfies Record<string, AnyFieldType>;

export type FieldTypeId = keyof typeof FIELD_TYPES;

export const FIELD_TYPE_IDS = Object.keys(FIELD_TYPES) as FieldTypeId[];

installFieldTypes(Object.values(FIELD_TYPES));

export function fieldType(id: string): AnyFieldType | undefined {
  return (FIELD_TYPES as Record<string, AnyFieldType>)[id];
}

export function isFieldTypeId(id: string): id is FieldTypeId {
  return id in FIELD_TYPES;
}

/** Families in the order pickers show them (docs/03). */
export const FAMILIES: { id: Family; label: string }[] = [
  { id: 'basic', label: 'Basic' },
  { id: 'choice', label: 'Choice' },
  { id: 'compliance', label: 'Compliance' },
  { id: 'computed', label: 'Computed' },
];

/** Field types grouped by family, for type pickers. Optionally limited by a predicate. */
export function typesByFamily(
  keep: (t: AnyFieldType) => boolean = () => true,
): { family: Family; label: string; types: AnyFieldType[] }[] {
  const all = Object.values(FIELD_TYPES) as AnyFieldType[];
  return FAMILIES.map((f) => ({
    family: f.id,
    label: f.label,
    types: all.filter((t) => t.family === f.id && keep(t)),
  })).filter((g) => g.types.length > 0);
}
