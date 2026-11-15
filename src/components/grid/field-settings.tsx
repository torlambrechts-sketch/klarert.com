'use client';

import { RestrictedFieldSection } from '@/components/access/restricted-field';
import { useEffect, useId, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { OPERATORS } from '@/engine/conditions';
import { FIELD_TYPE_IDS, fieldType } from '@/engine/fields/registry';
import { resolveFieldType } from '@/engine/fields/resolve';
import { formEligible } from '@/engine/fields/view-support';
import { typeChangeMode, type TypeChangeMode } from '@/engine/fields/type-change';
import type { Condition, Ctx, Field, Json, StatusRule, Validation } from '@/engine/types';
import { kindOf } from '@/engine/values';
import { fieldUI } from '@/components/fields/registry';
import { inputClass } from '@/components/fields/shared';
import type { ConfigEnv } from '@/components/fields/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogTitle, SideSheetContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { systemColumnText } from '@/engine/packs/system';
import type { SheetActions } from './use-sheet';

// Field settings (docs/05 §3.5, FR-16): General, Type settings, Validation, Rules (status rules and comment on
// value), Visibility, Danger zone. Saved together through updateField; type changes preview first (docs/03 §5).

const OP_LABELS: Record<string, string> = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  eq: 'equals',
  neq: 'does not equal',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  is_any_of: 'is any of',
  is_none_of: 'is none of',
  is_done: 'is done',
  is_not_done: 'is not done',
  at_least: 'is at least',
  at_most: 'is at most',
  has_any_of: 'has any of',
  has_all_of: 'has all of',
  has_none_of: 'has none of',
  includes_any_of: 'includes any of',
  includes_me: 'includes me',
  excludes: 'excludes',
  is_checked: 'is checked',
  is_not_checked: 'is not checked',
  has_any: 'has links',
  has_none: 'has no links',
  has_files: 'has files',
  is_signed: 'is signed',
  is_not_signed: 'is not signed',
};
const NO_VALUE = new Set([
  'is_empty',
  'is_not_empty',
  'is_done',
  'is_not_done',
  'includes_me',
  'is_checked',
  'is_not_checked',
  'has_any',
  'has_none',
  'has_files',
  'is_signed',
  'is_not_signed',
  'is_today',
  'overdue',
]);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-line flex flex-col gap-3 border-t pt-4" aria-label={title}>
      <h3 className="text-label-13 font-bold">{title}</h3>
      {children}
    </section>
  );
}

function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-label-13 font-semibold">
        {label}
      </label>
      {children(id)}
      {hint ? <p className="text-muted-foreground text-label-12">{hint}</p> : null}
    </div>
  );
}

const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

export function FieldSettings({
  field,
  ctx,
  env,
  canEdit,
  isAdmin,
  actions,
  onClose,
}: {
  field: Field | null;
  ctx: Ctx;
  env: ConfigEnv;
  canEdit: boolean;
  isAdmin: boolean;
  actions: SheetActions;
  onClose(): void;
}) {
  return (
    <Dialog open={!!field} onOpenChange={(o) => !o && onClose()}>
      {field ? (
        <SideSheetContent aria-describedby={undefined}>
          <FieldSettingsBody
            key={field.id}
            field={field}
            ctx={ctx}
            env={env}
            canEdit={canEdit && (!field.locked || isAdmin)}
            isAdmin={isAdmin}
            actions={actions}
            onClose={onClose}
          />
        </SideSheetContent>
      ) : null}
    </Dialog>
  );
}

export function FieldSettingsBody({
  field,
  ctx,
  env,
  canEdit,
  isAdmin,
  actions,
  onClose,
}: {
  field: Field;
  ctx: Ctx;
  env: ConfigEnv;
  canEdit: boolean;
  isAdmin: boolean;
  actions: SheetActions;
  onClose(): void;
}) {
  const def = resolveFieldType(field.type)!;
  const ui = fieldUI(field.type);
  const kind = kindOf(field, ctx);
  const stored = def.storage === 'values';
  const [name, setName] = useState(field.name);
  const [description, setDescription] = useState(field.description ?? '');
  const [required, setRequired] = useState(field.required);
  const [locked, setLocked] = useState(field.locked);
  const [width, setWidth] = useState(String(field.width ?? def.defaultWidth));
  const [config, setConfig] = useState<Record<string, unknown>>(() => ({
    ...(field.config as object),
  }));
  const [validation, setValidation] = useState<Validation>(() => ({ ...field.validation }));
  const [rules, setRules] = useState<StatusRule[]>(() =>
    (field.rules ?? []).map((r) => ({ ...r })),
  );
  const [visibility, setVisibility] = useState<Condition | null>(field.visibility ?? null);
  const [busy, setBusy] = useState(false);
  const options = def.options?.(config, ctx) ?? [];
  const others = env.fields.filter((f) => f.id !== field.id);

  const save = async () => {
    setBusy(true);
    const { default: dflt, ...rest } = config;
    const change: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() || null,
      required,
      width: Math.max(60, Math.min(600, Number(width) || def.defaultWidth)),
      config: {
        ...rest,
        ...(typeof dflt === 'string' && dflt.trim() ? { default: dflt.trim() } : {}),
      },
      validation: Object.fromEntries(
        Object.entries(validation).filter(([, v]) => v !== undefined && v !== '' && v !== false),
      ),
      rules: rules.map((r) => ({
        ...r,
        whenFieldKey: field.key,
        message: r.message?.trim() || undefined,
      })),
      visibility: visibility && visibility.fieldKey ? visibility : null,
      ...(isAdmin ? { locked } : {}),
    };
    const saved = await actions.updateField(field, change, 'Field settings saved.');
    setBusy(false);
    if (saved) onClose();
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="border-line border-b px-5 py-4 pr-12">
        <DialogTitle className="text-heading-16">{field.name}</DialogTitle>
        <DialogDescription className="text-muted-foreground text-label-12">
          {def.label} · key <span className="font-mono">{field.key}</span>
          {field.system ? ' · system column' : field.locked ? ' · kept by the app' : ''}
        </DialogDescription>
      </div>
      <fieldset
        disabled={!canEdit}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4"
      >
        {!canEdit ? (
          <p role="status" className="bg-soft text-copy-13 rounded-md px-3 py-2">
            {field.locked
              ? 'This field is kept by the app. Only owners and admins can change it.'
              : 'You can view these settings. Ask an editor or admin to change them.'}
          </p>
        ) : null}
        <section className="flex flex-col gap-3" aria-label="General">
          <Labelled label="Field name">
            {(id) => (
              <input
                id={id}
                className={inputClass}
                value={name}
                maxLength={80}
                required
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Labelled>
          <Labelled label="Description" hint="Help text shown in the item panel and on forms.">
            {(id) => (
              <textarea
                id={id}
                rows={2}
                maxLength={2000}
                className={cn(inputClass, 'h-auto py-1.5')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </Labelled>
          {stored ? (
            <label className="text-label-13 flex items-center gap-2">
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
              />
              Required
            </label>
          ) : null}
          {formEligible(field) ? (
            <div className="flex flex-col gap-1">
              <label className="text-label-13 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={required || config.askWhenAdding === true}
                  disabled={required}
                  aria-describedby={`${field.id}-ask-hint`}
                  onChange={(e) =>
                    setConfig((c) => {
                      const rest = { ...c };
                      delete rest.askWhenAdding;
                      return e.target.checked ? { ...rest, askWhenAdding: true } : rest;
                    })
                  }
                />
                Ask when adding
              </label>
              <p id={`${field.id}-ask-hint`} className="text-muted-foreground text-label-12">
                {required
                  ? 'Required fields are always asked in the New item dialog.'
                  : 'The New item dialog asks for it with the name. Other fields are under More fields.'}
              </p>
            </div>
          ) : null}
          {stored ? (
            <Labelled
              label="Default value"
              hint='Used for new items. You can write today, me or "in 7 days".'
            >
              {(id) => (
                <input
                  id={id}
                  className={inputClass}
                  value={String(config.default ?? '')}
                  onChange={(e) => setConfig((c) => ({ ...c, default: e.target.value }))}
                />
              )}
            </Labelled>
          ) : null}
          <Labelled label="Column width (px)">
            {(id) => (
              <input
                id={id}
                type="number"
                min={60}
                max={600}
                className={inputClass}
                value={width}
                onChange={(e) => setWidth(e.target.value)}
              />
            )}
          </Labelled>
          {def.storage !== 'computed' ? (
            <Labelled
              label="Personal data"
              hint="Values are kept out of the activity log in clear and can be erased under the sheet's retention rules (Sheet settings › Retention). Mark the field before it holds data: earlier log entries cannot change."
            >
              {(id) => (
                <label htmlFor={id} className="text-label-13 flex items-center gap-2">
                  <input
                    id={id}
                    type="checkbox"
                    checked={config.personalData === true}
                    onChange={(e) =>
                      setConfig((c) => {
                        const rest = { ...c };
                        delete rest.personalData;
                        return e.target.checked ? { ...rest, personalData: true } : rest;
                      })
                    }
                  />
                  This field holds personal data
                </label>
              )}
            </Labelled>
          ) : null}
          {isAdmin ? (
            <label className="text-label-13 flex items-center gap-2">
              <input
                type="checkbox"
                checked={locked}
                onChange={(e) => setLocked(e.target.checked)}
              />
              Locked: only owners and admins can change or delete it
            </label>
          ) : null}
        </section>

        {isAdmin || field.restrictedTo ? (
          <Section title="Who sees its values">
            <RestrictedFieldSection field={field} ctx={ctx} canManage={isAdmin && canEdit} />
          </Section>
        ) : null}

        {field.system ? (
          <Section title="Field type">
            <p className="text-muted-foreground text-copy-13" data-testid="system-column-note">
              {systemColumnText([...ctx.fieldsByKey.values()])}
            </p>
          </Section>
        ) : (
          <TypeSection
            field={field}
            ctx={ctx}
            canEdit={canEdit}
            actions={actions}
            onChanged={onClose}
          />
        )}

        {ui.ConfigForm ? (
          <Section title="Type settings">
            <ui.ConfigForm
              config={config}
              onChange={setConfig}
              sheet={env.sheet}
              env={env}
              field={{ ...field, config }}
            />
          </Section>
        ) : null}

        {stored ? (
          <ValidationSection kind={kind} validation={validation} onChange={setValidation} />
        ) : null}

        {stored && options.length > 0 ? (
          <Section title="Rules">
            <p className="text-muted-foreground text-label-12">
              When this field changes to one of the chosen values, require other fields to be filled
              or ask for a comment.
            </p>
            {rules.map((r, i) => (
              <RuleEditor
                key={r.id}
                index={i}
                rule={r}
                options={options}
                fields={others}
                onChange={(next) => setRules((rs) => rs.map((x, j) => (j === i ? next : x)))}
                onRemove={() => setRules((rs) => rs.filter((_, j) => j !== i))}
              />
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() =>
                setRules((rs) => [
                  ...rs,
                  {
                    id: `r${Math.random().toString(36).slice(2, 7)}`,
                    whenFieldKey: field.key,
                    whenValues: [],
                    require: [],
                  },
                ])
              }
            >
              <Plus aria-hidden /> Add rule
            </Button>
          </Section>
        ) : null}

        <Section title="Visibility">
          <VisibilityEditor value={visibility} fields={others} ctx={ctx} onChange={setVisibility} />
        </Section>

        <Section title="Danger zone">
          <Button
            type="button"
            variant="outline"
            className="text-crit self-start"
            disabled={field.locked || field.system}
            onClick={() => {
              onClose();
              void actions.deleteField(field);
            }}
          >
            <Trash2 aria-hidden /> Delete field
          </Button>
          {field.system ? (
            <p className="text-muted-foreground text-label-12">
              A system column. You can hide it in a view, not delete it.
            </p>
          ) : field.locked ? (
            <p className="text-muted-foreground text-label-12">
              Kept by the app. You can hide it, not delete it.
            </p>
          ) : null}
        </Section>
      </fieldset>
      <div className="border-line flex justify-end gap-2 border-t px-5 py-3">
        <Button type="button" variant="outline" onClick={onClose}>
          {canEdit ? 'Cancel' : 'Close'}
        </Button>
        {canEdit ? (
          <Button type="submit" disabled={busy || !name.trim()}>
            Save settings
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function TypeSection({
  field,
  ctx,
  canEdit,
  actions,
  onChanged,
}: {
  field: Field;
  ctx: Ctx;
  canEdit: boolean;
  actions: SheetActions;
  onChanged(): void;
}) {
  const [to, setTo] = useState('');
  const [preview, setPreview] = useState<{ mode: TypeChangeMode; summary: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const targets = useMemo(
    () =>
      FIELD_TYPE_IDS.map((id) => ({ id, mode: typeChangeMode(field.type, id) })).filter(
        (t) => t.mode !== 'none',
      ),
    [field.type],
  );
  useEffect(() => setPreview(null), [to]);
  void ctx;
  if (!canEdit) return null;
  return (
    <Section title="Field type">
      {targets.length === 0 ? (
        <p className="text-muted-foreground text-copy-13">
          A {fieldType(field.type)?.label.toLowerCase()} field cannot change type.
        </p>
      ) : (
        <>
          <Labelled
            label="Change type to"
            hint="Compatible types convert in place. Others create a new field with the values copied."
          >
            {(id) => (
              <select
                id={id}
                className={inputClass}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              >
                <option value="">Choose a type</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {fieldType(t.id)!.label}
                    {t.mode === 'copy' ? ' (new field)' : ''}
                  </option>
                ))}
              </select>
            )}
          </Labelled>
          {to ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await actions.changeType(field, to, false);
                  setBusy(false);
                  if (r) setPreview({ mode: r.mode, summary: r.summary });
                }}
              >
                Preview
              </Button>
              {preview ? (
                <>
                  <p role="status" className="text-copy-13">
                    {preview.summary}
                  </p>
                  {preview.mode === 'copy' ? (
                    <>
                      <p className="text-muted-foreground text-copy-13 basis-full">
                        This type can&apos;t be converted in place. Replace this field with a new
                        one (the old field can be restored for 30 days; formulas and automations
                        that use it need updating), or keep both.
                      </p>
                      {field.locked ? null : (
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            const r = await actions.changeType(field, to, true, true);
                            setBusy(false);
                            if (r) onChanged();
                          }}
                        >
                          Replace this field
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          const r = await actions.changeType(field, to, true, false);
                          setBusy(false);
                          if (r) onChanged();
                        }}
                      >
                        Keep both
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        const r = await actions.changeType(field, to, true);
                        setBusy(false);
                        if (r) onChanged();
                      }}
                    >
                      Change type
                    </Button>
                  )}
                </>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </Section>
  );
}

function ValidationSection({
  kind,
  validation,
  onChange,
}: {
  kind: string;
  validation: Validation;
  onChange(v: Validation): void;
}) {
  const set = (patch: Partial<Validation>) => onChange({ ...validation, ...patch });
  const isText = kind === 'text';
  const isNumber = kind === 'number';
  const isCount = ['multi', 'people', 'link', 'file'].includes(kind);
  if (!isText && !isNumber && !isCount) return null;
  const minLabel = isText ? 'Minimum length' : isNumber ? 'Minimum' : 'Choose at least';
  const maxLabel = isText ? 'Maximum length' : isNumber ? 'Maximum' : 'Choose at most';
  return (
    <Section title="Validation">
      <div className="grid grid-cols-2 gap-3">
        <Labelled label={minLabel}>
          {(id) => (
            <input
              id={id}
              type="number"
              className={inputClass}
              value={validation.min ?? ''}
              onChange={(e) => set({ min: num(e.target.value) })}
            />
          )}
        </Labelled>
        <Labelled label={maxLabel}>
          {(id) => (
            <input
              id={id}
              type="number"
              className={inputClass}
              value={validation.max ?? ''}
              onChange={(e) => set({ max: num(e.target.value) })}
            />
          )}
        </Labelled>
      </div>
      {isText ? (
        <Labelled
          label="Pattern"
          hint="A regular expression the text must match, like ^[A-Z]{2}-\d+$."
        >
          {(id) => (
            <input
              id={id}
              className={cn(inputClass, 'font-mono')}
              maxLength={200}
              value={validation.pattern ?? ''}
              onChange={(e) => set({ pattern: e.target.value || undefined })}
            />
          )}
        </Labelled>
      ) : null}
      {isText || isNumber ? (
        <label className="text-label-13 flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!validation.unique}
            onChange={(e) => set({ unique: e.target.checked || undefined })}
          />
          Unique: no two items may have the same value
        </label>
      ) : null}
    </Section>
  );
}

function RuleEditor({
  index,
  rule,
  options,
  fields,
  onChange,
  onRemove,
}: {
  index: number;
  rule: StatusRule;
  options: { id: string; label: string }[];
  fields: Field[];
  onChange(r: StatusRule): void;
  onRemove(): void;
}) {
  const when = rule.whenValues.map(String);
  const require = rule.require ?? [];
  return (
    <fieldset className="border-line flex flex-col gap-2 rounded-md border p-3">
      <legend className="text-label-12 px-1 font-semibold">Rule {index + 1}</legend>
      <div className="flex flex-col gap-1">
        <p className="text-copy-13 font-semibold">When it becomes</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {options.map((o) => (
            <label key={o.id} className="text-label-13 flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={when.includes(o.id)}
                onChange={(e) =>
                  onChange({
                    ...rule,
                    whenValues: (e.target.checked
                      ? [...when, o.id]
                      : when.filter((x) => x !== o.id)) as Json[],
                  })
                }
              />
              {o.label}
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-copy-13 font-semibold">Require these fields</p>
        <div className="flex max-h-32 flex-wrap gap-x-3 gap-y-1 overflow-auto">
          {fields.map((f) => (
            <label key={f.id} className="text-label-13 flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={require.includes(f.key)}
                onChange={(e) =>
                  onChange({
                    ...rule,
                    require: e.target.checked
                      ? [...require, f.key]
                      : require.filter((k) => k !== f.key),
                  })
                }
              />
              {f.name}
            </label>
          ))}
        </div>
      </div>
      <label className="text-label-13 flex items-center gap-2">
        <input
          type="checkbox"
          checked={!!rule.requireComment}
          onChange={(e) => onChange({ ...rule, requireComment: e.target.checked || undefined })}
        />
        Ask for a comment
      </label>
      <Labelled label="Message when blocked">
        {(id) => (
          <input
            id={id}
            className={inputClass}
            maxLength={300}
            value={rule.message ?? ''}
            placeholder="Add the root cause before closing."
            onChange={(e) => onChange({ ...rule, message: e.target.value })}
          />
        )}
      </Labelled>
      <Button type="button" size="sm" variant="ghost" className="self-start" onClick={onRemove}>
        <Trash2 aria-hidden /> Remove rule
      </Button>
    </fieldset>
  );
}

function VisibilityEditor({
  value,
  fields,
  ctx,
  onChange,
}: {
  value: Condition | null;
  fields: Field[];
  ctx: Ctx;
  onChange(c: Condition | null): void;
}) {
  const field = value ? fields.find((f) => f.key === value.fieldKey) : undefined;
  const kind = field ? kindOf(field, ctx) : null;
  const ops = kind ? OPERATORS[kind] : [];
  const options = field ? (resolveFieldType(field.type)?.options?.(field.config, ctx) ?? []) : [];
  const listValue = Array.isArray(value?.value) ? (value!.value as string[]) : [];
  return (
    <div className="flex flex-col gap-2">
      <label className="text-label-13 flex items-center gap-2">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) =>
            onChange(
              e.target.checked ? { fieldKey: fields[0]?.key ?? '', op: 'is_not_empty' } : null,
            )
          }
        />
        Show this field in the item panel and forms only when
      </label>
      {value ? (
        <div className="flex flex-col gap-2 pl-6">
          <select
            aria-label="Field"
            className={inputClass}
            value={value.fieldKey}
            onChange={(e) => onChange({ fieldKey: e.target.value, op: 'is_not_empty' })}
          >
            {fields.map((f) => (
              <option key={f.id} value={f.key}>
                {f.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Condition"
            className={inputClass}
            value={value.op}
            onChange={(e) => onChange({ fieldKey: value.fieldKey, op: e.target.value })}
          >
            {ops.map((op) => (
              <option key={op} value={op}>
                {OP_LABELS[op] ?? op.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          {!NO_VALUE.has(value.op) ? (
            options.length > 0 ? (
              <div className="flex flex-wrap gap-x-3 gap-y-1" role="group" aria-label="Values">
                {options.map((o) => (
                  <label key={o.id} className="text-label-13 flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={listValue.includes(o.id)}
                      onChange={(e) =>
                        onChange({
                          ...value,
                          value: e.target.checked
                            ? [...listValue, o.id]
                            : listValue.filter((x) => x !== o.id),
                        })
                      }
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            ) : (
              <input
                aria-label="Value"
                className={inputClass}
                value={
                  typeof value.value === 'string' || typeof value.value === 'number'
                    ? String(value.value)
                    : ''
                }
                onChange={(e) => onChange({ ...value, value: e.target.value })}
              />
            )
          ) : null}
          <p className="text-muted-foreground text-label-12">
            Hidden fields keep their value. A hidden required field is not required.
          </p>
        </div>
      ) : null}
    </div>
  );
}
