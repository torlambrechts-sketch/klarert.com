'use client';

// The UI field registry (docs/03 §1): Cell, Editor, ConfigForm and icon per field type id. The grid, the list and
// the item panel look types up here; nothing else in the UI branches on a field type.
import { FIELD_TYPE_IDS, type FieldTypeId } from '@/engine/fields/registry';
import * as basic from './basic';
import * as choice from './choice';
import * as compliance from './compliance';
import * as computed from './computed';
import * as cfg from './config-forms';
import type { ConfigFormProps, FieldTypeUI } from './types';
import { Lock } from 'lucide-react';
import { hiddenFor } from '@/engine/values';
import { ExplainEditor } from './shared';

type AnyConfigForm = React.FC<ConfigFormProps<Record<string, unknown>>>;

const ui = (entry: FieldTypeUI, ConfigForm?: AnyConfigForm): FieldTypeUI =>
  ({ ...entry, ...(ConfigForm ? { ConfigForm } : {}) }) as FieldTypeUI;

export const FIELD_UI: Record<FieldTypeId, FieldTypeUI> = {
  text: basic.textFieldUI,
  longtext: basic.longtextUI,
  comment: basic.commentUI,
  number: ui(basic.numberUI, cfg.NumberConfig),
  value: ui(basic.valueUI, cfg.ValueConfig),
  percent: ui(basic.percentUI, cfg.PercentConfig),
  yesno: ui(basic.yesnoUI, cfg.YesNoConfig),
  check: basic.checkUI,
  date: ui(basic.dateUI, cfg.DateConfig),
  datetime: basic.datetimeUI,
  duration: ui(basic.durationUI, cfg.DurationConfig),
  timeline: basic.timelineUI,
  recurrence: basic.recurrenceUI,
  rating: ui(basic.ratingUI, cfg.RatingConfig),
  email: basic.emailUI,
  phone: ui(basic.phoneUI, cfg.PhoneConfig),
  url: basic.urlUI,
  location: basic.locationUI,

  status: ui(choice.statusUI, cfg.OptionsConfig),
  dropdown: ui(choice.dropdownUI, cfg.OptionsConfig),
  multiselect: ui(choice.multiselectUI, cfg.OptionsConfig),
  people: ui(choice.peopleUI, cfg.PeopleConfig),
  role: choice.roleUI,
  team: choice.teamUI,
  entity: choice.entityUI,
  country: choice.countryUI,
  classification: ui(choice.classificationUI, cfg.OptionsConfig),
  severity: ui(choice.severityUI, cfg.OptionsConfig),

  requirement: ui(compliance.requirementUI, cfg.LibraryLinkConfig),
  controllink: ui(compliance.controllinkUI, cfg.LibraryLinkConfig),
  evidence: ui(compliance.evidenceUI, cfg.EvidenceConfig),
  attachment: ui(compliance.attachmentUI, cfg.AttachmentConfig),
  signature: ui(compliance.signatureUI, cfg.SignatureConfig),
  ack: ui(compliance.ackUI, cfg.AckConfig),
  justification: ui(compliance.justificationUI, cfg.JustificationConfig),
  applicability: ui(compliance.applicabilityUI, cfg.ApplicabilityConfig),
  finding: ui(compliance.findingUI, cfg.FixedOptions),
  checklist: ui(compliance.checklistUI, cfg.ChecklistConfig),
  question: ui(compliance.questionUI, cfg.QuestionConfig),
  riskmatrix: ui(compliance.riskmatrixUI, cfg.RiskConfig),
  maturity: ui(compliance.maturityUI, cfg.FixedOptions),
  measurement: ui(compliance.measurementUI, cfg.MeasurementConfig),
  clock: ui(compliance.clockUI, cfg.ClockConfig),
  protected: ui(compliance.protectedUI, cfg.ProtectedConfig),
  pdmarker: ui(compliance.pdmarkerUI, cfg.FixedOptions),
  retention: ui(compliance.retentionUI, cfg.RetentionConfig),
  version: compliance.versionUI,

  link: ui(computed.linkUI, cfg.LinkConfig),
  lookup: ui(computed.lookupUI, cfg.LookupConfig),
  rollup: ui(computed.rollupUI, cfg.RollupConfig),
  formula: ui(computed.formulaUI, cfg.FormulaConfig),
  progress: ui(computed.progressUI, cfg.ProgressConfig),
  autoid: computed.autoidUI,
  meta: ui(computed.metaUI, cfg.MetaConfig),
  workflowstep: ui(computed.workflowstepUI, cfg.OptionsConfig),
  button: ui(computed.buttonUI, cfg.ButtonConfig),
  ai: ui(computed.aiUI, cfg.AiConfig),
  subitems: computed.subitemsUI,
};

// Restricted fields (docs/02 §16): a field whose values the person may not see shows "Restricted" in every cell, card
// and panel, and explains itself instead of opening an editor. The values never reached the browser; this only says
// so instead of showing an empty cell.
const guarded = new Map<string, FieldTypeUI>();

function guard(entry: FieldTypeUI): FieldTypeUI {
  const { Cell, Editor } = entry;
  const RestrictedCell: FieldTypeUI['Cell'] = (props) =>
    hiddenFor(props.field, props.ctx) ? <RestrictedValue /> : <Cell {...props} />;
  const RestrictedEditor: FieldTypeUI['Editor'] = (props) =>
    hiddenFor(props.field, props.ctx) ? (
      <ExplainEditor title={props.field.name} onCancel={props.onCancel}>
        <p>
          This field is restricted. Only the people it lists, and the workspace owners, can see it.
        </p>
      </ExplainEditor>
    ) : (
      <Editor {...props} />
    );
  return { ...entry, Cell: RestrictedCell, Editor: RestrictedEditor };
}

export function RestrictedValue() {
  return (
    <span className="text-muted-foreground text-label-12 flex items-center gap-1">
      <Lock className="size-3.5" aria-hidden /> Restricted
    </span>
  );
}

export function fieldUI(type: string): FieldTypeUI {
  const hit = guarded.get(type);
  if (hit) return hit;
  const entry = (FIELD_UI as Record<string, FieldTypeUI>)[type];
  if (!entry) throw new Error(`No UI for field type ${type}`);
  const g = guard(entry);
  guarded.set(type, g);
  return g;
}

/** Every engine type has a UI entry (checked by registry.test.ts). */
export const UI_TYPE_IDS = Object.keys(FIELD_UI);
export const ENGINE_TYPE_IDS = FIELD_TYPE_IDS;
