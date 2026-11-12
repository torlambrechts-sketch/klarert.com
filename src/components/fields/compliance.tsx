'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BadgeCheck,
  BookCheck,
  CheckCheck,
  ClipboardCheck,
  FileArchive,
  FileCheck2,
  FileText,
  Fingerprint,
  Gauge,
  Grid3x3,
  HelpCircle,
  LineChart,
  Lock,
  Paperclip,
  PenLine,
  Scale,
  ShieldCheck,
  Timer,
  ToggleRight,
  Archive,
} from 'lucide-react';
import { ackAudience, acknowledgedBy, currentAckVersion, type AckEntry } from '@/engine/fields/ack';
import {
  checklistProgress,
  type ChecklistConfig,
  type ChecklistValue,
} from '@/engine/fields/checklist';
import { clockState, formatHours, type ClockConfig } from '@/engine/fields/clock';
import { freshness, type Freshness } from '@/engine/fields/evidence';
import { formatDate, formatDateTime } from '@/engine/fields/helpers';
import { onTarget, type MeasurementConfig, type Reading } from '@/engine/fields/measurement';
import { hasSpecialCategory } from '@/engine/fields/pdmarker';
import { retentionText, type RetentionConfig } from '@/engine/fields/retention';
import { riskLevel, type RiskMatrixConfig } from '@/engine/fields/riskmatrix';
import type { FileRow, Field } from '@/engine/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { computedUI, Empty, Muted, optionUI, textUI, OptionCell } from './kit';
import { LinkCell, LinkEditor } from './links';
import {
  Chip,
  defOf,
  EditorFrame,
  ExplainEditor,
  inputClass,
  SaveCancel,
  Text,
  TextEditor,
} from './shared';
import type { EditorProps, FieldTypeUI } from './types';

// Compliance types (docs/03 §3.3).

function useFocusFirst<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => ref.current?.focus(), []);
  return ref;
}

export const requirementUI: FieldTypeUI = {
  icon: BookCheck,
  Cell: LinkCell,
  Editor: LinkEditor,
  editorWidth: 340,
};
export const controllinkUI: FieldTypeUI = {
  icon: ShieldCheck,
  Cell: LinkCell,
  Editor: LinkEditor,
  editorWidth: 340,
};

// ───────────── files (uploaded in the item panel) ─────────────

const FRESH: Record<Freshness, { label: string; color: string }> = {
  current: { label: 'Current', color: 'green' },
  expiring: { label: 'Expiring', color: 'orange' },
  expired: { label: 'Expired', color: 'red' },
  none: { label: 'No files', color: 'grey' },
};

function filesUI(icon: FieldTypeUI['icon'], expiry: boolean): FieldTypeUI {
  return computedUI({
    icon,
    Cell: ({ value, ctx }) => {
      const rows = (value as FileRow[] | null) ?? [];
      if (rows.length === 0) return <Empty />;
      const count = rows.length === 1 ? '1 file' : `${rows.length} files`;
      if (!expiry) return <Text>{count}</Text>;
      const f = freshness(rows, ctx.today);
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-xs">{count}</span>
          <Chip
            option={{ id: f, label: FRESH[f].label, color: FRESH[f].color, done: f === 'current' }}
          />
        </span>
      );
    },
    explain: (p) => {
      const { value, ctx } = p;
      const rows = (value as FileRow[] | null) ?? [];
      return (
        <>
          {rows.length === 0 ? (
            <Muted>No files yet.</Muted>
          ) : (
            <ul className="flex flex-col gap-1">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <FileText className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{r.filename}</span>
                  {expiry && r.validUntil ? (
                    <Muted className="shrink-0 text-xs">
                      valid until {formatDate(r.validUntil)}
                    </Muted>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <Muted className="text-xs">
            Files are added and replaced in the item panel, with a checksum and version history.
          </Muted>
          {p.onOpenItem ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="self-start"
              onClick={p.onOpenItem}
            >
              Open item to upload
            </Button>
          ) : null}
          {rows.length > 0 && expiry ? (
            <Muted className="text-xs">
              Freshness: {FRESH[freshness(rows, ctx.today)].label.toLowerCase()}.
            </Muted>
          ) : null}
        </>
      );
    },
  });
}

export const evidenceUI = filesUI(FileCheck2, true);
export const attachmentUI = filesUI(Paperclip, false);

// ───────────── signature ─────────────

function SignatureEditor({ value, field, ctx, onCommit, onCancel }: EditorProps) {
  const v = value as { by: string; at: string; meaning: string } | null;
  const meaning = (field.config as { meaning: string }).meaning;
  const me = ctx.people.get(ctx.userId)?.name ?? 'you';
  const ref = useFocusFirst<HTMLButtonElement>();
  if (v?.by) {
    return (
      <EditorFrame
        title={field.name}
        footer={
          <>
            <Button size="sm" variant="outline" onClick={() => onCommit(null)}>
              Remove signature
            </Button>
            <Button ref={ref} size="sm" onClick={onCancel}>
              Close
            </Button>
          </>
        }
      >
        <p className="text-sm">
          {v.meaning} by {ctx.people.get(v.by)?.name ?? 'a former member'} on{' '}
          {formatDateTime(v.at, ctx.timeZone)}.
        </p>
        <Muted className="text-xs">
          The signature holds a fingerprint of the item&apos;s values at signing
          {(field.config as { clearOnChange: boolean }).clearOnChange
            ? ' and is removed when they change'
            : ''}
          .
        </Muted>
      </EditorFrame>
    );
  }
  return (
    <EditorFrame
      title={field.name}
      footer={
        <>
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            ref={ref}
            size="sm"
            onClick={() =>
              onCommit({ by: ctx.userId, at: ctx.now.toISOString(), meaning, hash: '0'.repeat(64) })
            }
          >
            Sign: {meaning}
          </Button>
        </>
      }
    >
      <p className="text-sm">
        You sign as {me} with the meaning &ldquo;{meaning}&rdquo;. The signature records the
        item&apos;s values as they are now.
      </p>
    </EditorFrame>
  );
}

export const signatureUI: FieldTypeUI = {
  icon: PenLine,
  Cell: ({ value, ctx }) => {
    const v = value as { by: string; at: string; meaning: string } | null;
    if (!v?.by) return <Empty />;
    const first = ctx.people.get(v.by)?.name.split(' ')[0] ?? 'Former member';
    return (
      <span className="flex min-w-0 items-center gap-1">
        <BadgeCheck className="text-good size-4 shrink-0" aria-hidden />
        <Text>
          {v.meaning} · {first}, {formatDate(v.at.slice(0, 10)).replace(/ \d{4}$/, '')}
        </Text>
      </span>
    );
  },
  Editor: SignatureEditor,
  editorWidth: 320,
};

// ───────────── acknowledgement ─────────────

function AckEditor({ value, field, item, ctx, onCommit, onCancel }: EditorProps) {
  const cfg = field.config as Parameters<typeof ackAudience>[0];
  const entries = (value as AckEntry[] | null) ?? [];
  const audience = ackAudience(cfg, ctx);
  const version = currentAckVersion(item, field as Field<typeof cfg>, ctx);
  const mine = entries.some(
    (e) => e.userId === ctx.userId && (version === null || e.version === version),
  );
  const inAudience = audience.includes(ctx.userId);
  const { done } = acknowledgedBy(entries, cfg, ctx, version);
  return (
    <EditorFrame
      title={field.name}
      footer={
        inAudience && !mine ? (
          <>
            <Button size="sm" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() =>
                onCommit([...entries, { userId: ctx.userId, at: ctx.now.toISOString(), version }])
              }
            >
              I have read this
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={onCancel}>
            Close
          </Button>
        )
      }
    >
      <p className="text-sm">
        {done} of {audience.length} acknowledged{version ? ` (version ${version})` : ''}.
      </p>
      {mine ? <Muted className="text-xs">You have acknowledged this.</Muted> : null}
      {!inAudience ? (
        <Muted className="text-xs">You are not in the audience for this field.</Muted>
      ) : null}
    </EditorFrame>
  );
}

export const ackUI: FieldTypeUI = {
  icon: CheckCheck,
  Cell: ({ value, field, item, ctx }) => {
    const cfg = field.config as Parameters<typeof ackAudience>[0];
    const version = currentAckVersion(item, field as Field<typeof cfg>, ctx);
    const { done, audience } = acknowledgedBy(
      (value as AckEntry[] | null) ?? [],
      cfg,
      ctx,
      version,
    );
    if (audience === 0) return <Muted className="text-xs">No audience</Muted>;
    return (
      <Text className="tabular-nums">
        {done} of {audience} · {Math.round((done / audience) * 100)}%
      </Text>
    );
  },
  Editor: AckEditor,
  editorWidth: 300,
};

// ───────────── text-like compliance types ─────────────

export const justificationUI: FieldTypeUI = {
  ...textUI({ icon: Scale, multiline: true, toInput: (v) => String(v) }),
  editorWidth: 360,
};
export const versionUI = textUI({
  icon: FileArchive,
  invalid: 'Use v and two numbers, like v1.2.',
  placeholder: 'v1.0',
  toInput: (v) => String(v),
});

// ───────────── applicability ─────────────

function ApplicabilityEditor({ value, field, onCommit, onCancel }: EditorProps) {
  const v = value as { applicable: boolean; reason: string } | null;
  const [applicable, setApplicable] = useState<boolean | null>(v ? v.applicable : null);
  const [reason, setReason] = useState(v?.reason ?? '');
  const ref = useFocusFirst<HTMLInputElement>();
  const save = () => onCommit(applicable === null ? null : { applicable, reason: reason.trim() });
  return (
    <EditorFrame
      title={field.name}
      footer={<SaveCancel onSave={save} onCancel={onCancel} onClear={() => onCommit(null)} />}
    >
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="sr-only">{field.name}</legend>
        <label className="flex items-center gap-2">
          <input
            ref={ref}
            type="radio"
            name="applicable"
            checked={applicable === true}
            onChange={() => setApplicable(true)}
          />
          Applicable
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="applicable"
            checked={applicable === false}
            onChange={() => setApplicable(false)}
          />
          Not applicable
        </label>
      </fieldset>
      <label className="flex flex-col gap-1 text-xs font-semibold">
        Reason
        <textarea
          className={cn(inputClass, 'h-auto py-1.5 font-normal')}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
    </EditorFrame>
  );
}

export const applicabilityUI: FieldTypeUI = {
  icon: ToggleRight,
  Cell: (p) => <OptionCell {...p} />,
  Editor: ApplicabilityEditor,
  editorWidth: 300,
};

export const findingUI: FieldTypeUI = { ...optionUI({ icon: ClipboardCheck }), editorWidth: 300 };
export const questionUI: FieldTypeUI = { ...optionUI({ icon: HelpCircle }), editorWidth: 280 };
export const maturityUI = optionUI({ icon: Gauge });
export const pdmarkerUI: FieldTypeUI = {
  ...optionUI({ icon: Fingerprint, multiple: true }),
  Cell: (p) => (
    <span className="flex min-w-0 items-center gap-1">
      {hasSpecialCategory(p.value as string[] | null) ? (
        <span className="sr-only">Includes special category data.</span>
      ) : null}
      <OptionCell {...p} />
    </span>
  ),
  editorWidth: 300,
};

// ───────────── checklist ─────────────

const ANSWERS = [
  ['yes', 'Yes'],
  ['no', 'No'],
  ['na', 'N/A'],
] as const;

function ChecklistEditor({ value, field, ctx, onCommit, onCancel }: EditorProps) {
  const cfg = field.config as ChecklistConfig;
  const [answers, setAnswers] = useState<ChecklistValue['answers']>(() => ({
    ...((value as ChecklistValue | null)?.answers ?? {}),
  }));
  const ref = useFocusFirst<HTMLButtonElement>();
  const set = (lineId: string, a: 'yes' | 'no' | 'na') =>
    setAnswers((s) =>
      s[lineId]?.a === a
        ? Object.fromEntries(Object.entries(s).filter(([k]) => k !== lineId))
        : { ...s, [lineId]: { ...s[lineId], a, by: ctx.userId, at: ctx.now.toISOString() } },
    );
  const save = () => onCommit(Object.keys(answers).length ? { answers } : null);
  if (cfg.lines.length === 0)
    return (
      <ExplainEditor title={field.name} onCancel={onCancel}>
        <Muted>This checklist has no lines yet. Add them in the field settings.</Muted>
      </ExplainEditor>
    );
  return (
    <EditorFrame title={field.name} footer={<SaveCancel onSave={save} onCancel={onCancel} />}>
      <ol className="flex max-h-80 flex-col gap-2 overflow-auto">
        {cfg.lines.map((line, i) => {
          const e = answers[line.id];
          return (
            <li key={line.id} className="flex flex-col gap-1">
              <span className="text-sm">{line.text}</span>
              <div className="flex gap-1" role="group" aria-label={`Answer to ${line.text}`}>
                {ANSWERS.map(([a, label]) => (
                  <button
                    key={a}
                    ref={i === 0 && a === 'yes' ? ref : undefined}
                    type="button"
                    aria-pressed={e?.a === a}
                    onClick={() => set(line.id, a)}
                    className={cn(
                      'border-line rounded-md border px-2 py-0.5 text-xs font-semibold',
                      e?.a === a &&
                        (a === 'yes'
                          ? 'bg-good border-good text-white'
                          : a === 'no'
                            ? 'bg-crit border-crit text-white'
                            : 'bg-ink text-white'),
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {e?.a === 'no' && line.noteOnNo ? (
                <input
                  className={inputClass}
                  aria-label={`Note for ${line.text}`}
                  placeholder="What is missing?"
                  value={e.note ?? ''}
                  onChange={(ev) =>
                    setAnswers((s) => ({
                      ...s,
                      [line.id]: { ...s[line.id]!, note: ev.target.value },
                    }))
                  }
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </EditorFrame>
  );
}

export const checklistUI: FieldTypeUI = {
  icon: ClipboardCheck,
  Cell: ({ value, field }) => {
    const cfg = field.config as ChecklistConfig;
    const p = checklistProgress(value as ChecklistValue | null, cfg);
    if (!value || p.answered === 0) return <Empty />;
    return (
      <span
        className="flex w-full min-w-0 items-center gap-2"
        title={`${p.answered} of ${p.lines} answered`}
      >
        <span
          className="bg-soft block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
          aria-hidden
        >
          <span className="bg-brand block h-full" style={{ width: `${p.pct ?? 0}%` }} />
        </span>
        <span className="shrink-0 text-[12.5px] tabular-nums">
          {p.answered}/{p.lines}
          <span className="sr-only"> answered</span>
        </span>
      </span>
    );
  },
  Editor: ChecklistEditor,
  editorWidth: 360,
  conflictCheck: true,
};

// ───────────── risk matrix ─────────────

const LEVEL_COLOR = { Low: 'green', Medium: 'yellow', High: 'orange', Critical: 'red' } as const;

function RiskEditor({ value, field, onCommit, onCancel }: EditorProps) {
  const cfg = field.config as RiskMatrixConfig;
  const v = value as { l: number; i: number } | null;
  const ref = useFocusFirst<HTMLButtonElement>();
  const n = cfg.size;
  return (
    <EditorFrame
      title={field.name}
      footer={
        <>
          {v ? (
            <Button size="sm" variant="ghost" className="mr-auto" onClick={() => onCommit(null)}>
              Clear
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="flex gap-1">
        <span className="text-muted-foreground rotate-180 self-center text-[10px] font-semibold [writing-mode:vertical-rl]">
          Likelihood
        </span>
        <div
          className="grid gap-0.5"
          style={{ gridTemplateColumns: `repeat(${n}, 2rem)` }}
          role="group"
          aria-label="Likelihood by impact"
        >
          {Array.from({ length: n }, (_, r) => n - r).map((l) =>
            Array.from({ length: n }, (_, c) => c + 1).map((i) => {
              const level = riskLevel(l * i, cfg.bands);
              const on = v?.l === l && v?.i === i;
              return (
                <button
                  key={`${l}-${i}`}
                  ref={(v ? on : l === 1 && i === 1) ? ref : undefined}
                  type="button"
                  aria-label={`Likelihood ${cfg.likelihoodLabels[l - 1] ?? l}, impact ${cfg.impactLabels[i - 1] ?? i}: ${l * i} ${level}`}
                  aria-pressed={on}
                  onClick={() => onCommit({ l, i })}
                  className={cn(
                    'h-8 rounded text-xs font-bold',
                    on && 'ring-ink ring-2 ring-offset-1',
                  )}
                  style={{
                    background: `color-mix(in srgb, var(--label-${LEVEL_COLOR[level]}) ${on ? 100 : 35}%, white)`,
                    color: on && level !== 'Medium' ? '#fff' : 'var(--ink)',
                  }}
                >
                  {l * i}
                </button>
              );
            }),
          )}
        </div>
      </div>
      <p className="text-muted-foreground text-center text-[10px] font-semibold">Impact</p>
    </EditorFrame>
  );
}

export const riskmatrixUI: FieldTypeUI = {
  icon: Grid3x3,
  Cell: ({ value, field }) => {
    const v = value as { l: number; i: number } | null;
    if (!v) return <Empty />;
    const level = riskLevel(v.l * v.i, (field.config as RiskMatrixConfig).bands);
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="font-bold tabular-nums">{v.l * v.i}</span>
        <Chip option={{ id: level, label: level, color: LEVEL_COLOR[level] }} />
      </span>
    );
  },
  Editor: RiskEditor,
  editorWidth: 260,
};

// ───────────── measurement ─────────────

function Sparkline({ readings }: { readings: Reading[] }) {
  if (readings.length < 2) return null;
  const vs = readings.map((r) => r.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  const pts = vs
    .map((v, i) => `${(i / (vs.length - 1)) * 40},${12 - ((v - min) / span) * 10 - 1}`)
    .join(' ');
  return (
    <svg width="40" height="12" viewBox="0 0 40 12" aria-hidden className="shrink-0">
      <polyline points={pts} fill="none" stroke="var(--focus)" strokeWidth="1.5" />
    </svg>
  );
}

function MeasurementEditor({ value, field, ctx, onCommit, onCancel }: EditorProps) {
  const readings = (value as Reading[] | null) ?? [];
  const [at, setAt] = useState(ctx.today);
  const [v, setV] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const ref = useFocusFirst<HTMLInputElement>();
  const unit = (field.config as MeasurementConfig).unit;
  const add = () => {
    const next = defOf(field).normalize(
      [...readings, { at, v, note: note || undefined, by: ctx.userId }],
      field.config,
      ctx,
    );
    if (!next) return setError('Enter a number and a date.');
    onCommit(next);
  };
  return (
    <EditorFrame
      title={field.name}
      footer={<SaveCancel onSave={add} onCancel={onCancel} saveLabel="Add reading" />}
    >
      {readings.length ? (
        <ul className="flex max-h-32 flex-col gap-0.5 overflow-auto text-xs">
          {[...readings].reverse().map((r, i) => (
            <li key={`${r.at}-${i}`} className="flex gap-2">
              <span className="w-24 shrink-0">{formatDate(r.at)}</span>
              <span className="font-semibold tabular-nums">
                {r.v}
                {unit ? ` ${unit}` : ''}
              </span>
              {r.note ? <Muted className="truncate">{r.note}</Muted> : null}
            </li>
          ))}
        </ul>
      ) : (
        <Muted className="text-xs">No readings yet.</Muted>
      )}
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1 text-xs font-semibold">
          Value{unit ? ` (${unit})` : ''}
          <input
            ref={ref}
            inputMode="decimal"
            className={inputClass}
            value={v}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs font-semibold">
          Date
          <input
            type="date"
            className={inputClass}
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs font-semibold">
        Note
        <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error ? (
        <p role="alert" className="text-crit text-xs">
          {error}
        </p>
      ) : null}
    </EditorFrame>
  );
}

export const measurementUI: FieldTypeUI = {
  icon: LineChart,
  Cell: ({ value, field, ctx }) => {
    const readings = (value as Reading[] | null) ?? [];
    if (readings.length === 0) return <Empty />;
    const cfg = field.config as MeasurementConfig;
    const hit = onTarget(readings, cfg);
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <Text className="tabular-nums">{defOf(field).toText(readings, cfg, ctx)}</Text>
        <Sparkline readings={readings} />
        {hit === null ? null : (
          <span className={cn('shrink-0 text-xs font-semibold', hit ? 'text-good' : 'text-crit')}>
            {hit ? 'On target' : 'Off target'}
          </span>
        )}
      </span>
    );
  },
  Editor: MeasurementEditor,
  editorWidth: 320,
};

// ───────────── statutory clock ─────────────

const CLOCK_TEXT = {
  not_started: 'Not started',
  running: 'Running',
  warning: 'Running out',
  overdue: 'Overdue',
  met: 'Met',
  missed: 'Missed',
} as const;
const CLOCK_COLOR = {
  not_started: 'grey',
  running: 'blue',
  warning: 'orange',
  overdue: 'red',
  met: 'green',
  missed: 'red',
} as const;

export const clockUI = computedUI({
  icon: Timer,
  Cell: ({ field, item, ctx }) => {
    const s = clockState(item, field as Field<ClockConfig>, ctx);
    if (s.state === 'not_started') return <Muted className="text-xs">Not started</Muted>;
    const left =
      s.hoursLeft !== null
        ? ` · ${formatHours(s.hoursLeft)}${s.hoursLeft < 0 ? ' over' : ' left'}`
        : '';
    return (
      <Chip
        option={{
          id: s.state,
          label: `${CLOCK_TEXT[s.state]}${left}`,
          color: CLOCK_COLOR[s.state],
          done: s.state === 'met',
        }}
      />
    );
  },
  explain: ({ field, item, ctx }) => {
    const cfg = field.config as ClockConfig;
    const s = clockState(item, field as Field<ClockConfig>, ctx);
    const start = cfg.startFieldKey ? ctx.fieldsByKey.get(cfg.startFieldKey)?.name : null;
    const stop = cfg.stopFieldKey ? ctx.fieldsByKey.get(cfg.stopFieldKey)?.name : null;
    return (
      <>
        <p>
          A {cfg.hours} hour clock that starts{' '}
          {start ? `when ${start} is set` : 'once a start field is chosen in the settings'}
          {stop ? ` and stops when ${stop} is set` : ''}.
        </p>
        {s.deadline ? <p>Deadline: {formatDateTime(s.deadline, ctx.timeZone)}.</p> : null}
        <Muted className="text-xs">The app calculates this value; it cannot be typed.</Muted>
      </>
    );
  },
});

// ───────────── protected text ─────────────

export const protectedUI: FieldTypeUI = {
  icon: Lock,
  Cell: ({ value }) =>
    value === undefined ? (
      <span className="text-muted-foreground flex items-center gap-1 text-xs">
        <Lock className="size-3.5" aria-hidden /> Restricted
      </span>
    ) : typeof value === 'string' && value ? (
      <Text>{value}</Text>
    ) : (
      <Empty />
    ),
  Editor: ({ value, field, onCommit, onCancel }) =>
    value === undefined ? (
      <ExplainEditor title={field.name} onCancel={onCancel}>
        <p>Only admins and the people this field lists can see or change this value.</p>
      </ExplainEditor>
    ) : (
      <TextEditor
        title={field.name}
        initial={typeof value === 'string' ? value : ''}
        onCommit={(t) => onCommit(t)}
        onCancel={onCancel}
      />
    ),
};

// ───────────── retention ─────────────

function RetentionEditor({ value, field, item, ctx, onCommit, onCancel }: EditorProps) {
  const v = value as { hold: boolean; holdReason: string } | null;
  const [hold, setHold] = useState(v?.hold ?? false);
  const [reason, setReason] = useState(v?.holdReason ?? '');
  const ref = useFocusFirst<HTMLInputElement>();
  return (
    <EditorFrame
      title={field.name}
      footer={
        <SaveCancel
          onSave={() => onCommit({ hold, holdReason: hold ? reason.trim() : '' })}
          onCancel={onCancel}
        />
      }
    >
      <p className="text-sm">
        {retentionText(item, field as Field<RetentionConfig>, ctx) || 'No deletion date yet.'}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          ref={ref}
          type="checkbox"
          checked={hold}
          onChange={(e) => setHold(e.target.checked)}
        />
        Legal hold
      </label>
      {hold ? (
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Reason for the hold
          <input
            className={inputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      ) : null}
    </EditorFrame>
  );
}

export const retentionUI: FieldTypeUI = {
  icon: Archive,
  Cell: ({ field, item, ctx }) => {
    const t = retentionText(item, field as Field<RetentionConfig>, ctx);
    return t ? <Text>{t}</Text> : <Empty />;
  },
  Editor: RetentionEditor,
  editorWidth: 300,
};
