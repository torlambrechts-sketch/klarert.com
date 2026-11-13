'use client';

import { useId, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { COLORS } from '@/engine/fields/helpers';
import type { LabelOption } from '@/engine/fields/types';
import { DURATION_UNITS } from '@/engine/fields/duration';
import { META_WHICH } from '@/engine/fields/meta';
import { ROLLUP_FNS } from '@/engine/fields/rollup';
import { resolveFieldType } from '@/engine/fields/resolve';
import { valueOf } from '@/engine/values';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { colorVar, inputClass } from './shared';
import type { ConfigFormProps } from './types';

// Type settings (the ConfigForm of each type, docs/03 §3). Every form edits a copy of the config and hands it back
// whole; the field settings sheet saves it through updateField, which validates it with the type's config schema.

type C = Record<string, unknown>;
type Props = ConfigFormProps<C>;

const newOptionId = () => `opt_${Math.random().toString(36).slice(2, 7)}`;

export function Row({
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

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(v: boolean): void;
}) {
  return (
    <label className="text-label-13 flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function TextIn({
  label,
  value,
  onChange,
  hint,
  mono,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <Row label={label} hint={hint}>
      {(id) => (
        <input
          id={id}
          className={cn(inputClass, mono && 'font-mono')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Row>
  );
}

function NumIn({
  label,
  value,
  onChange,
  min,
  max,
  hint,
}: {
  label: string;
  value: number | null;
  onChange(v: number | null): void;
  min?: number;
  max?: number;
  hint?: string;
}) {
  return (
    <Row label={label} hint={hint}>
      {(id) => (
        <input
          id={id}
          type="number"
          className={inputClass}
          min={min}
          max={max}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      )}
    </Row>
  );
}

function Pick({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange(v: string): void;
  hint?: string;
}) {
  return (
    <Row label={label} hint={hint}>
      {(id) => (
        <select
          id={id}
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Row>
  );
}

const set = (p: Props, patch: C) => p.onChange({ ...p.config, ...patch });

const fieldOptions = (p: Props, keep: (type: string) => boolean = () => true, none = 'None') => [
  { value: '', label: none },
  ...p.env.fields
    .filter((f) => f.id !== p.field.id && keep(f.type))
    .map((f) => ({ value: f.key, label: f.name })),
];

const storageIs = (s: string) => (type: string) => resolveFieldType(type)?.storage === s;

// ───────────── options of label types ─────────────

export function OptionsConfig(p: Props) {
  const options = (p.config.options as LabelOption[]) ?? [];
  const update = (next: LabelOption[]) => set(p, { options: next });
  const edit = (i: number, patch: Partial<LabelOption>) =>
    update(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...options];
    const [o] = next.splice(i, 1);
    next.splice(i + d, 0, o!);
    update(next);
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-label-13 mb-1 font-semibold">Options</legend>
      <ul className="flex flex-col gap-1.5">
        {options.map((o, i) => (
          <li key={o.id} className="flex items-center gap-1.5">
            <span
              className="size-4 shrink-0 rounded-sm"
              style={{ background: colorVar(o.color) }}
              aria-hidden
            />
            <input
              className={cn(inputClass, 'min-w-0 flex-1')}
              aria-label={`Option ${i + 1} label`}
              value={o.label}
              maxLength={80}
              onChange={(e) => edit(i, { label: e.target.value })}
            />
            <select
              className={cn(inputClass, 'w-24')}
              aria-label={`Option ${i + 1} colour`}
              value={o.color}
              onChange={(e) => edit(i, { color: e.target.value })}
            >
              {COLORS.map((c) => (
                <option key={c} value={c}>
                  {c[0]!.toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
            <label
              className="text-label-12 flex items-center gap-1"
              title="Counts as done for My work, overdue and progress"
            >
              <input
                type="checkbox"
                checked={!!o.done}
                onChange={(e) => edit(i, { done: e.target.checked || undefined })}
              />
              Done
            </label>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={`Move ${o.label || 'option'} up`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              <ArrowUp aria-hidden />
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={`Move ${o.label || 'option'} down`}
              disabled={i === options.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown aria-hidden />
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={`Remove ${o.label || 'option'}`}
              disabled={options.length <= 1}
              onClick={() => update(options.filter((_, j) => j !== i))}
            >
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="self-start"
        onClick={() =>
          update([
            ...options,
            {
              id: newOptionId(),
              label: `Option ${options.length + 1}`,
              color: COLORS[(options.length + 1) % COLORS.length]!,
            },
          ])
        }
      >
        <Plus aria-hidden /> Add option
      </Button>
      <p className="text-muted-foreground text-label-12">
        Renaming an option keeps every value that uses it.
      </p>
    </fieldset>
  );
}

export function FixedOptions(p: Props) {
  const options = resolveFieldType(p.field.type)?.options?.(p.config, p.env.ctx) ?? [];
  return (
    <div className="flex flex-col gap-1">
      <p className="text-copy-13 font-semibold">Options</p>
      <p className="text-muted-foreground text-copy-13">{options.map((o) => o.label).join(', ')}</p>
      <p className="text-muted-foreground text-label-12">These options are fixed.</p>
    </div>
  );
}

// ───────────── small forms ─────────────

export function NumberConfig(p: Props) {
  const saved = p.config.bands as [number, number, number] | undefined;
  const [bands, setBands] = useState<string[]>(saved ? saved.map(String) : ['', '', '']);
  const changeBand = (i: number, v: string) => {
    const next = bands.map((b, j) => (j === i ? v : b));
    setBands(next);
    if (next.every((b) => b.trim() === '')) return set(p, { bands: undefined });
    const n = next.map((b) => (b.trim() === '' ? NaN : Number(b)));
    if (n.every(Number.isFinite) && n[0]! < n[1]! && n[1]! < n[2]!) set(p, { bands: n });
  };
  const partial =
    bands.some((b) => b.trim() !== '') &&
    !(saved && saved.every((b, i) => String(b) === bands[i]!.trim()));
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <TextIn
          label="Unit"
          value={String(p.config.unit ?? '')}
          onChange={(v) => set(p, { unit: v.slice(0, 12) })}
        />
        <NumIn
          label="Decimals"
          min={0}
          max={6}
          value={Number(p.config.decimals ?? 2)}
          onChange={(v) => set(p, { decimals: v ?? 0 })}
        />
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-label-13 font-medium">Meter bands (optional)</legend>
        <p className="text-muted-foreground text-copy-13">
          Three thresholds, each higher than the last. The Table shows a four-bar meter beside the
          number: one bar up to the first, four above the last.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {['First', 'Second', 'Third'].map((label, i) => (
            <label key={label} className="text-label-12 flex flex-col gap-1">
              {label}
              <input
                type="number"
                className={inputClass}
                value={bands[i]}
                onChange={(e) => changeBand(i, e.target.value)}
              />
            </label>
          ))}
        </div>
        {partial ? (
          <p className="text-muted-foreground text-copy-13" role="status">
            Fill all three, each higher than the last, to show the meter.
          </p>
        ) : null}
      </fieldset>
      {saved ? (
        <Pick
          label="A rising value is"
          value={
            p.config.higherIsBetter === true
              ? 'better'
              : p.config.higherIsBetter === false
                ? 'worse'
                : ''
          }
          options={[
            { value: '', label: 'Neither good nor bad' },
            { value: 'better', label: 'Better' },
            { value: 'worse', label: 'Worse' },
          ]}
          onChange={(v) =>
            set(p, { higherIsBetter: v === 'better' ? true : v === 'worse' ? false : undefined })
          }
          hint="Colours the Table's trend line: green when it moves the good way, red when it moves the bad way."
        />
      ) : null}
    </div>
  );
}

export const ValueConfig = (p: Props) => (
  <div className="flex flex-col gap-3">
    <TextIn
      label="Currency"
      hint="Three-letter code, like EUR or GBP."
      value={String(p.config.currency ?? '')}
      onChange={(v) => set(p, { currency: v.toUpperCase().slice(0, 3) })}
    />
    <Toggle
      label="Allow other currencies"
      checked={!!p.config.allowOther}
      onChange={(v) => set(p, { allowOther: v })}
    />
  </div>
);

export const PercentConfig = (p: Props) => (
  <Toggle label="Show a bar" checked={!!p.config.bar} onChange={(v) => set(p, { bar: v })} />
);
export const YesNoConfig = (p: Props) => (
  <Toggle label="Allow N/A" checked={!!p.config.allowNA} onChange={(v) => set(p, { allowNA: v })} />
);
export const DateConfig = (p: Props) => (
  <Toggle
    label='Show time left, like "in 3 days", until the item is done'
    checked={!!p.config.relative}
    onChange={(v) => set(p, { relative: v })}
  />
);
export const DurationConfig = (p: Props) => (
  <Pick
    label="Default unit"
    value={String(p.config.unit)}
    options={DURATION_UNITS.map((u) => ({ value: u, label: u }))}
    onChange={(v) => set(p, { unit: v })}
  />
);
export const RatingConfig = (p: Props) => (
  <NumIn
    label="Number of stars"
    min={3}
    max={10}
    value={Number(p.config.scale ?? 5)}
    onChange={(v) => set(p, { scale: v ?? 5 })}
  />
);
export const PhoneConfig = (p: Props) => (
  <TextIn
    label="Default country"
    hint="Two-letter code used for numbers without a country code."
    value={String(p.config.defaultCountry ?? '')}
    onChange={(v) => set(p, { defaultCountry: v.toUpperCase().slice(0, 2) })}
  />
);
export const PeopleConfig = (p: Props) => (
  <Toggle
    label="Allow several people"
    checked={p.config.multiple !== false}
    onChange={(v) => set(p, { multiple: v })}
  />
);

function LinkTarget(p: Props & { library: boolean }) {
  const sheets = p.env.sheets.filter((s) => !p.library || s.isLibrary);
  return (
    <div className="flex flex-col gap-3">
      <Pick
        label={p.library ? 'Library sheet' : 'Links to sheet'}
        hint={
          p.library && sheets.length === 0
            ? 'No library sheets yet. Adopt a framework, or mark a sheet as a library in its settings.'
            : p.library && !p.config.targetSheetId
              ? 'Links to items of every library sheet, such as the requirements of each adopted framework.'
              : undefined
        }
        value={String(p.config.targetSheetId ?? '')}
        options={[
          // requirement and control links may point at every library sheet: a control can cover several frameworks
          { value: '', label: p.library ? 'Any library sheet' : 'Choose a sheet' },
          ...sheets.map((s) => ({ value: s.id, label: s.name })),
        ]}
        onChange={(v) => set(p, { targetSheetId: p.library && !v ? null : v })}
      />
      <Toggle
        label="Allow several items"
        checked={p.config.multiple !== false}
        onChange={(v) => set(p, { multiple: v })}
      />
      <TwoWay {...p} />
    </div>
  );
}

/**
 * "Show on <target sheet> too": saving with it on creates the inverse field on the target sheet (two-way link);
 * turning it off makes both fields one-way again. The command keeps inverseFieldId itself.
 */
function TwoWay(p: Props) {
  const target = p.env.sheets.find((s) => s.id === p.config.targetSheetId);
  const on =
    typeof p.config.twoWay === 'boolean' ? p.config.twoWay : Boolean(p.config.inverseFieldId);
  if (!target) return null;
  return (
    <div className="flex flex-col gap-1">
      <Toggle
        label={`Show on ${target.name} too`}
        checked={on}
        onChange={(v) => set(p, { twoWay: v })}
      />
      <p className="text-muted-foreground text-label-12">
        {on
          ? `${target.name} gets a field listing the items that link to it. Changing either side changes both.`
          : `Adds a field to ${target.name} that lists the items linking to it.`}
      </p>
    </div>
  );
}
export const LinkConfig = (p: Props) => <LinkTarget {...p} library={false} />;
export const LibraryLinkConfig = (p: Props) => <LinkTarget {...p} library />;

export const EvidenceConfig = (p: Props) => (
  <div className="flex flex-col gap-3">
    <NumIn
      label="Valid for (days)"
      min={1}
      value={Number(p.config.validDays ?? 365)}
      onChange={(v) => set(p, { validDays: v ?? 365 })}
    />
    <Toggle
      label="Allow several files"
      checked={p.config.multiple !== false}
      onChange={(v) => set(p, { multiple: v })}
    />
  </div>
);
export const AttachmentConfig = (p: Props) => (
  <Toggle
    label="Allow several files"
    checked={p.config.multiple !== false}
    onChange={(v) => set(p, { multiple: v })}
  />
);

export const SignatureConfig = (p: Props) => (
  <div className="flex flex-col gap-3">
    <TextIn
      label="Meaning"
      hint="What signing means, like Approved or Reviewed."
      value={String(p.config.meaning ?? '')}
      onChange={(v) => set(p, { meaning: v.slice(0, 80) })}
    />
    <Toggle
      label="Remove the signature when another value changes"
      checked={!!p.config.clearOnChange}
      onChange={(v) => set(p, { clearOnChange: v })}
    />
  </div>
);

function Checks({
  legend,
  all,
  chosen,
  onChange,
}: {
  legend: string;
  all: { id: string; name: string }[];
  chosen: string[];
  onChange(ids: string[]): void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-label-13 mb-1 font-semibold">{legend}</legend>
      {all.length === 0 ? (
        <p className="text-muted-foreground text-label-12">None in this workspace yet.</p>
      ) : null}
      <div className="flex max-h-36 flex-col gap-0.5 overflow-auto">
        {all.map((x) => (
          <label key={x.id} className="text-label-13 flex items-center gap-2">
            <input
              type="checkbox"
              checked={chosen.includes(x.id)}
              onChange={(e) =>
                onChange(e.target.checked ? [...chosen, x.id] : chosen.filter((y) => y !== x.id))
              }
            />
            {x.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function AckConfig(p: Props) {
  const audience = (p.config.audience as {
    userIds: string[];
    teamIds: string[];
    jobRoleIds: string[];
  }) ?? { userIds: [], teamIds: [], jobRoleIds: [] };
  return (
    <div className="flex flex-col gap-3">
      <Checks
        legend="People"
        all={[...p.env.ctx.people.values()]}
        chosen={audience.userIds}
        onChange={(ids) => set(p, { audience: { ...audience, userIds: ids } })}
      />
      <Checks
        legend="Teams"
        all={[...p.env.ctx.teams.values()]}
        chosen={audience.teamIds}
        onChange={(ids) => set(p, { audience: { ...audience, teamIds: ids } })}
      />
      <Pick
        label="Version field"
        hint="A new version asks everyone again."
        value={String(p.config.versionFieldKey ?? '')}
        options={fieldOptions(p, (t) => t === 'version')}
        onChange={(v) => set(p, { versionFieldKey: v || null })}
      />
    </div>
  );
}

export function JustificationConfig(p: Props) {
  const key = (p.config.whenFieldKey as string | null) ?? '';
  const when = p.env.fields.find((f) => f.key === key);
  const opts = when ? (resolveFieldType(when.type)?.options?.(when.config, p.env.ctx) ?? []) : [];
  const values = (p.config.whenValues as string[]) ?? [];
  return (
    <div className="flex flex-col gap-3">
      <Pick
        label="Required when"
        value={key}
        options={fieldOptions(p, (t) => !!resolveFieldType(t)?.options, 'Never')}
        onChange={(v) => set(p, { whenFieldKey: v || null, whenValues: [] })}
      />
      {when ? (
        <Checks
          legend={`${when.name} is one of`}
          all={opts.map((o) => ({ id: o.id, name: o.label }))}
          chosen={values}
          onChange={(ids) => set(p, { whenValues: ids })}
        />
      ) : null}
    </div>
  );
}

export const ApplicabilityConfig = (p: Props) => (
  <Toggle
    label="Ask for a reason when it does not apply"
    checked={!!p.config.reasonRequiredWhenNot}
    onChange={(v) => set(p, { reasonRequiredWhenNot: v })}
  />
);

export function ChecklistConfig(p: Props) {
  const lines = (p.config.lines as { id: string; text: string; noteOnNo: boolean }[]) ?? [];
  const update = (next: typeof lines) => set(p, { lines: next });
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-label-13 mb-1 font-semibold">Lines</legend>
      <ol className="flex flex-col gap-1.5">
        {lines.map((l, i) => (
          <li key={l.id} className="flex items-center gap-1.5">
            <input
              className={cn(inputClass, 'flex-1')}
              aria-label={`Line ${i + 1}`}
              value={l.text}
              onChange={(e) =>
                update(lines.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
              }
            />
            <label className="text-label-12 flex items-center gap-1">
              <input
                type="checkbox"
                checked={l.noteOnNo}
                onChange={(e) =>
                  update(lines.map((x, j) => (j === i ? { ...x, noteOnNo: e.target.checked } : x)))
                }
              />
              Note on No
            </label>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={`Remove line ${i + 1}`}
              onClick={() => update(lines.filter((_, j) => j !== i))}
            >
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
      </ol>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="self-start"
        onClick={() =>
          update([
            ...lines,
            {
              id: `l${Math.random().toString(36).slice(2, 7)}`,
              text: `Check ${lines.length + 1}`,
              noteOnNo: true,
            },
          ])
        }
      >
        <Plus aria-hidden /> Add line
      </Button>
    </fieldset>
  );
}

export function QuestionConfig(p: Props) {
  const options = (p.config.options as { id: string; label: string; score: number }[]) ?? [];
  const update = (next: typeof options) => set(p, { options: next });
  return (
    <div className="flex flex-col gap-3">
      <TextIn
        label="Question"
        value={String(p.config.question ?? '')}
        onChange={(v) => set(p, { question: v })}
      />
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-label-13 mb-1 font-semibold">Answers and scores</legend>
        {options.map((o, i) => (
          <div key={o.id} className="flex items-center gap-1.5">
            <input
              className={cn(inputClass, 'flex-1')}
              aria-label={`Answer ${i + 1}`}
              value={o.label}
              onChange={(e) =>
                update(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
              }
            />
            <input
              className={cn(inputClass, 'w-20')}
              type="number"
              aria-label={`Score of answer ${i + 1}`}
              value={o.score}
              onChange={(e) =>
                update(
                  options.map((x, j) => (j === i ? { ...x, score: Number(e.target.value) } : x)),
                )
              }
            />
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={`Remove answer ${i + 1}`}
              disabled={options.length <= 1}
              onClick={() => update(options.filter((_, j) => j !== i))}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() =>
            update([
              ...options,
              {
                id: `q${Math.random().toString(36).slice(2, 6)}`,
                label: `Answer ${options.length + 1}`,
                score: options.length,
              },
            ])
          }
        >
          <Plus aria-hidden /> Add answer
        </Button>
      </fieldset>
      <NumIn
        label="Weight"
        min={0}
        value={Number(p.config.weight ?? 1)}
        onChange={(v) => set(p, { weight: v ?? 1 })}
      />
    </div>
  );
}

export function RiskConfig(p: Props) {
  const bands = (p.config.bands as number[]) ?? [4, 9, 15];
  return (
    <div className="flex flex-col gap-3">
      <NumIn
        label="Matrix size"
        min={3}
        max={10}
        value={Number(p.config.size ?? 5)}
        onChange={(v) => set(p, { size: v ?? 5 })}
      />
      <div className="grid grid-cols-3 gap-2">
        {['Low up to', 'Medium up to', 'High up to'].map((label, i) => (
          <NumIn
            key={label}
            label={label}
            min={1}
            value={bands[i] ?? null}
            onChange={(v) => set(p, { bands: bands.map((b, j) => (j === i ? (v ?? b) : b)) })}
          />
        ))}
      </div>
    </div>
  );
}

export const MeasurementConfig = (p: Props) => (
  <div className="flex flex-col gap-3">
    <TextIn
      label="Unit"
      value={String(p.config.unit ?? '')}
      onChange={(v) => set(p, { unit: v })}
    />
    <NumIn
      label="Target"
      value={(p.config.target as number | null) ?? null}
      onChange={(v) => set(p, { target: v })}
    />
    <Pick
      label="Better when"
      value={String(p.config.direction ?? 'down')}
      options={[
        { value: 'down', label: 'Lower' },
        { value: 'up', label: 'Higher' },
      ]}
      onChange={(v) => set(p, { direction: v })}
    />
  </div>
);

export const ClockConfig = (p: Props) => (
  <div className="flex flex-col gap-3">
    <Pick
      label="Starts when"
      value={String(p.config.startFieldKey ?? '')}
      options={fieldOptions(p, (t) => ['date', 'datetime', 'check'].includes(t))}
      onChange={(v) => set(p, { startFieldKey: v || null })}
    />
    <NumIn
      label="Hours"
      min={1}
      value={Number(p.config.hours ?? 72)}
      onChange={(v) => set(p, { hours: v ?? 72 })}
    />
    <Pick
      label="Stops when"
      value={String(p.config.stopFieldKey ?? '')}
      options={fieldOptions(p, (t) => ['date', 'datetime', 'check'].includes(t))}
      onChange={(v) => set(p, { stopFieldKey: v || null })}
    />
  </div>
);

export const ProtectedConfig = (p: Props) => (
  <Checks
    legend="People who can see and change it (admins always can)"
    all={[...p.env.ctx.people.values()]}
    chosen={(p.config.allowedUserIds as string[]) ?? []}
    onChange={(ids) => set(p, { allowedUserIds: ids })}
  />
);

export const RetentionConfig = (p: Props) => (
  <div className="flex flex-col gap-3">
    <NumIn
      label="Keep for (years)"
      min={0}
      value={Number(p.config.years ?? 6)}
      onChange={(v) => set(p, { years: v ?? 6 })}
    />
    <Pick
      label="Counted from"
      value={String(p.config.fromFieldKey ?? '')}
      options={fieldOptions(
        p,
        (t) => ['date', 'datetime'].includes(t),
        'When the item was created',
      )}
      onChange={(v) => set(p, { fromFieldKey: v || null })}
    />
  </div>
);

export const LookupConfig = (p: Props) => (
  <div className="flex flex-col gap-3">
    <Pick
      label="Through link field"
      value={String(p.config.linkFieldKey ?? '')}
      options={fieldOptions(p, storageIs('links'), 'Choose a link field')}
      onChange={(v) => set(p, { linkFieldKey: v })}
    />
    <TextIn
      label="Field key on the linked sheet"
      mono
      hint="The key of the field to show, like due_date."
      value={String(p.config.targetFieldKey ?? '')}
      onChange={(v) => set(p, { targetFieldKey: v.trim() })}
    />
  </div>
);

export const RollupConfig = (p: Props) => (
  <div className="flex flex-col gap-3">
    <Pick
      label="Through link field"
      value={String(p.config.linkFieldKey ?? '')}
      options={fieldOptions(p, storageIs('links'), 'Choose a link field')}
      onChange={(v) => set(p, { linkFieldKey: v })}
    />
    <Pick
      label="Calculation"
      value={String(p.config.fn ?? 'count')}
      options={ROLLUP_FNS.map((f) => ({ value: f, label: f }))}
      onChange={(v) => set(p, { fn: v })}
    />
    <TextIn
      label="Field key on the linked sheet"
      mono
      hint="Leave empty to count items."
      value={String(p.config.targetFieldKey ?? '')}
      onChange={(v) => set(p, { targetFieldKey: v.trim() || null })}
    />
  </div>
);

export function FormulaConfig(p: Props) {
  const first = p.env.ctx.item(p.env.firstItemId ?? '');
  let preview = '';
  if (first) {
    const field = { ...p.field, config: p.config };
    const v = valueOf(first, field, p.env.ctx);
    preview = resolveFieldType(field.type)!.toText(v, p.config, p.env.ctx) || String(v ?? '');
  }
  return (
    <div className="flex flex-col gap-3">
      <Row label="Formula" hint='Use {field_key} for fields, like IF({score} > 10, "High", "Low").'>
        {(id) => (
          <textarea
            id={id}
            rows={3}
            spellCheck={false}
            className={cn(inputClass, 'h-auto py-1.5 font-mono')}
            value={String(p.config.expr ?? '')}
            onChange={(e) => set(p, { expr: e.target.value })}
          />
        )}
      </Row>
      <p className="text-muted-foreground text-label-12">
        Keys:{' '}
        {p.env.fields
          .filter((f) => f.id !== p.field.id)
          .map((f) => `{${f.key}}`)
          .join(' ') || 'none yet'}
      </p>
      {first ? (
        <p className="text-copy-13">
          On {first.displayId}: <span className="font-semibold">{preview || 'empty'}</span>
        </p>
      ) : null}
      <Pick
        label="Result"
        value={String(p.config.result ?? 'auto')}
        options={['auto', 'number', 'text', 'date', 'boolean'].map((r) => ({
          value: r,
          label: r === 'auto' ? 'Automatic' : r[0]!.toUpperCase() + r.slice(1),
        }))}
        onChange={(v) => set(p, { result: v })}
      />
    </div>
  );
}

export const ProgressConfig = (p: Props) => (
  <Pick
    label="Progress of"
    value={String(p.config.sourceFieldKey ?? '')}
    options={fieldOptions(
      p,
      (t) => t === 'checklist' || storageIs('links')(t),
      'Choose a checklist or link field',
    )}
    onChange={(v) => set(p, { sourceFieldKey: v })}
  />
);

export const MetaConfig = (p: Props) => (
  <Pick
    label="Show"
    value={String(p.config.which ?? 'created_at')}
    options={META_WHICH.map((w) => ({
      value: w,
      label: {
        created_at: 'Created at',
        created_by: 'Created by',
        updated_at: 'Updated at',
        updated_by: 'Updated by',
      }[w],
    }))}
    onChange={(v) => set(p, { which: v })}
  />
);

export const ButtonConfig = (p: Props) => (
  <div className="flex flex-col gap-3">
    <TextIn
      label="Button label"
      value={String(p.config.label ?? '')}
      onChange={(v) => set(p, { label: v.slice(0, 40) })}
    />
    <TextIn
      label="Ask before running"
      hint="Leave empty to run straight away."
      value={String(p.config.confirm ?? '')}
      onChange={(v) => set(p, { confirm: v || null })}
    />
  </div>
);

export const AiConfig = (p: Props) => (
  <Pick
    label="Proposal fills"
    value={String(p.config.targetFieldKey ?? '')}
    options={fieldOptions(p, storageIs('values'), 'Choose a field')}
    onChange={(v) => set(p, { targetFieldKey: v })}
  />
);
