'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  AlignLeft,
  AtSign,
  Calendar,
  CalendarClock,
  CalendarRange,
  CheckSquare,
  Clock3,
  Coins,
  ExternalLink,
  Hash,
  Link2,
  MapPin,
  MessageSquare,
  Percent,
  Phone,
  Repeat,
  Star,
  ToggleLeft,
  Type,
} from 'lucide-react';
import { relativeDue } from '@/engine/fields/date';
import { DURATION_UNITS } from '@/engine/fields/duration';
import { addDays, formatDate, isoDateInZone } from '@/engine/fields/helpers';
import { firstLine } from '@/engine/fields/longtext';
import { RECURRENCE_UNITS } from '@/engine/fields/recurrence';
import { urlHost } from '@/engine/fields/url';
import { isItemDone, isOverdueOf } from '@/engine/values';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Bar, Empty, Muted, optionUI, textUI, TextCell } from './kit';
import { defOf, EditorFrame, inputClass, SaveCancel, Text, TextEditor } from './shared';
import type { CellProps, EditorProps, FieldTypeUI } from './types';

// Basic input types (docs/03 §3.1).

function useFocusFirst<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => ref.current?.focus(), []);
  return ref;
}

function Labelled({
  label,
  children,
}: {
  label: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

const onEnter = (save: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    save();
  }
};

// ───────────── text kinds ─────────────

export const textFieldUI = textUI({ icon: Type, maxLength: 500 });

export const longtextUI: FieldTypeUI = {
  ...textUI({ icon: AlignLeft, multiline: true, toInput: (v) => String(v) }),
  conflictCheck: true,
  Cell: ({ value }) => {
    const t = typeof value === 'string' ? value : '';
    if (!t) return <Empty />;
    const head = firstLine(t);
    return <Text>{head !== t.trim() ? `${head} …` : head}</Text>;
  },
  editorWidth: 380,
};

export const commentUI: FieldTypeUI = {
  icon: MessageSquare,
  Cell: (p) => <TextCell {...p} />,
  // The server stamps who and when: the editor sends the text only.
  Editor: ({ value, field, onCommit, onCancel }) => (
    <TextEditor
      title={field.name}
      initial={(value as { text?: string } | null)?.text ?? ''}
      multiline
      onCommit={(t) => onCommit(t)}
      onCancel={onCancel}
    />
  ),
  editorWidth: 340,
};

export const emailUI = textUI({
  icon: AtSign,
  inputMode: 'email',
  invalid: 'Enter an email address, like name@example.com.',
  toInput: (v) => String(v),
  Cell: ({ value }) =>
    typeof value === 'string' && value ? (
      <span className="flex min-w-0 items-center gap-1">
        <Text>{value}</Text>
        <a
          href={`mailto:${value}`}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          className="text-info shrink-0"
          aria-label={`Email ${value}`}
        >
          <AtSign className="size-3.5" aria-hidden />
        </a>
      </span>
    ) : (
      <Empty />
    ),
});

export const phoneUI = textUI({
  icon: Phone,
  inputMode: 'tel',
  invalid: 'Enter a phone number, with the country code if it is not in this country.',
});

export const urlUI = textUI({
  icon: Link2,
  inputMode: 'url',
  invalid: 'Enter a web address, like https://example.com.',
  toInput: (v) => String(v),
  Cell: ({ value }) =>
    typeof value === 'string' && value ? (
      <span className="flex min-w-0 items-center gap-1">
        <Text>{urlHost(value)}</Text>
        <a
          href={value}
          target="_blank"
          rel="noreferrer noopener"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          className="text-info shrink-0"
          aria-label={`Open ${urlHost(value)} in a new tab`}
        >
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </span>
    ) : (
      <Empty />
    ),
});

// ───────────── numbers ─────────────

export const numberUI = textUI({
  icon: Hash,
  inputMode: 'decimal',
  align: 'right',
  invalid: 'Enter a number, like 12.5.',
  toInput: (v) => String(v),
});

export const percentUI: FieldTypeUI = {
  ...textUI({
    icon: Percent,
    inputMode: 'decimal',
    invalid: 'Enter a number from 0 to 100.',
    toInput: (v) => String(v),
  }),
  Cell: ({ value, field, density }) => {
    if (typeof value !== 'number') return <Empty />;
    const bar = (field.config as { bar?: boolean }).bar || density === 'list';
    return (
      <span className="flex w-full min-w-0 items-center gap-2">
        {bar ? <Bar pct={value} color="var(--good)" /> : null}
        <span className="shrink-0 text-right tabular-nums">{Math.round(value * 100) / 100}%</span>
      </span>
    );
  },
};

function ValueEditor({ value, field, ctx, onCommit, onCancel }: EditorProps) {
  const cfg = field.config as { currency: string; allowOther: boolean };
  const v = value as { amount: number; currency: string } | null;
  const [amount, setAmount] = useState(v ? String(v.amount) : '');
  const [currency, setCurrency] = useState(v?.currency ?? cfg.currency);
  const [error, setError] = useState('');
  const ref = useFocusFirst<HTMLInputElement>();
  const save = () => {
    if (!amount.trim()) return onCommit(null);
    const next = defOf(field).normalize({ amount, currency }, field.config, ctx);
    if (!next) return setError('Enter an amount, like 1200.50, and a three-letter currency code.');
    onCommit(next);
  };
  return (
    <EditorFrame title={field.name} footer={<SaveCancel onSave={save} onCancel={onCancel} />}>
      <div className="flex gap-2">
        <Labelled label="Amount">
          {(id) => (
            <input
              id={id}
              ref={ref}
              inputMode="decimal"
              className={inputClass}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={onEnter(save)}
            />
          )}
        </Labelled>
        <div className="w-24">
          <Labelled label="Currency">
            {(id) => (
              <input
                id={id}
                className={cn(inputClass, 'uppercase')}
                maxLength={3}
                value={currency}
                disabled={!cfg.allowOther}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                onKeyDown={onEnter(save)}
              />
            )}
          </Labelled>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-crit text-xs">
          {error}
        </p>
      ) : null}
    </EditorFrame>
  );
}

export const valueUI: FieldTypeUI = {
  icon: Coins,
  Cell: (p) => <TextCell {...p} className="text-right tabular-nums" />,
  Editor: ValueEditor,
};

function UnitAmountEditor({
  field,
  initialN,
  initialUnit,
  units,
  amountLabel,
  build,
  onCommit,
  onCancel,
}: {
  field: EditorProps['field'];
  initialN: string;
  initialUnit: string;
  units: readonly string[];
  amountLabel: string;
  build: (n: string, unit: string) => unknown;
  onCommit(v: unknown): void;
  onCancel(): void;
}) {
  const [n, setN] = useState(initialN);
  const [unit, setUnit] = useState(initialUnit);
  const [error, setError] = useState('');
  const ref = useFocusFirst<HTMLInputElement>();
  const save = () => {
    if (!n.trim()) return onCommit(null);
    const v = build(n, unit);
    if (!v) return setError('Enter a number.');
    onCommit(v);
  };
  return (
    <EditorFrame title={field.name} footer={<SaveCancel onSave={save} onCancel={onCancel} />}>
      <div className="flex gap-2">
        <Labelled label={amountLabel}>
          {(id) => (
            <input
              id={id}
              ref={ref}
              inputMode="decimal"
              className={inputClass}
              value={n}
              onChange={(e) => setN(e.target.value)}
              onKeyDown={onEnter(save)}
            />
          )}
        </Labelled>
        <Labelled label="Unit">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            >
              {units.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          )}
        </Labelled>
      </div>
      {error ? (
        <p role="alert" className="text-crit text-xs">
          {error}
        </p>
      ) : null}
    </EditorFrame>
  );
}

export const durationUI: FieldTypeUI = {
  icon: Clock3,
  Cell: (p) => <TextCell {...p} className="text-right tabular-nums" />,
  Editor: ({ value, field, ctx, onCommit, onCancel }) => {
    const v = value as { n: number; unit: string } | null;
    return (
      <UnitAmountEditor
        field={field}
        initialN={v ? String(v.n) : ''}
        initialUnit={v?.unit ?? (field.config as { unit: string }).unit}
        units={DURATION_UNITS}
        amountLabel="Length"
        build={(n, unit) => defOf(field).normalize({ n, unit }, field.config, ctx)}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    );
  },
};

function StarRow({ value, scale }: { value: number; scale: number }) {
  return (
    <span className="flex items-center" aria-label={`${value} of ${scale} stars`} role="img">
      {Array.from({ length: scale }, (_, i) => (
        <Star
          key={i}
          aria-hidden
          className={cn(
            'size-3.5',
            i < value ? 'fill-[var(--label-yellow)] text-[var(--warn)]' : 'text-line',
          )}
        />
      ))}
    </span>
  );
}

export const ratingUI: FieldTypeUI = {
  icon: Star,
  Cell: ({ value, field }) =>
    typeof value === 'number' ? (
      <StarRow value={value} scale={(field.config as { scale: number }).scale} />
    ) : (
      <Empty />
    ),
  Editor: ({ value, field, onCommit, onCancel }) => {
    const scale = (field.config as { scale: number }).scale;
    const current = typeof value === 'number' ? value : 0;
    const ref = useFocusFirst<HTMLButtonElement>();
    return (
      <EditorFrame
        title={field.name}
        footer={
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        }
      >
        <div className="flex gap-1" role="radiogroup" aria-label={field.name}>
          {Array.from({ length: scale }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              ref={n === Math.max(1, current) ? ref : undefined}
              type="button"
              role="radio"
              aria-checked={current === n}
              aria-label={`${n} of ${scale}${current === n ? ', choose again to clear' : ''}`}
              className="hover:bg-soft rounded p-1"
              // the same star again clears (docs/03 §3.1)
              onClick={() => onCommit(current === n ? null : n)}
            >
              <Star
                aria-hidden
                className={cn(
                  'size-5',
                  n <= current
                    ? 'fill-[var(--label-yellow)] text-[var(--warn)]'
                    : 'text-muted-foreground',
                )}
              />
            </button>
          ))}
        </div>
      </EditorFrame>
    );
  },
};

// ───────────── choice-like basics ─────────────

export const yesnoUI = optionUI({ icon: ToggleLeft });

export const checkUI: FieldTypeUI = {
  icon: CheckSquare,
  toggle: (v) => !(v === true),
  Cell: ({ value }) => (
    <span className="flex w-full justify-center">
      <span
        aria-hidden
        className={cn(
          'flex size-4 items-center justify-center rounded border',
          value === true ? 'bg-good border-good text-white' : 'border-muted-foreground bg-white',
        )}
      >
        {value === true ? '✓' : ''}
      </span>
      <span className="sr-only">{value === true ? 'Checked' : 'Not checked'}</span>
    </span>
  ),
  Editor: ({ value, field, onCommit, onCancel }) => {
    const ref = useFocusFirst<HTMLInputElement>();
    return (
      <EditorFrame
        title={field.name}
        footer={
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        }
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            ref={ref}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onCommit(e.target.checked)}
          />
          Checked
        </label>
      </EditorFrame>
    );
  },
};

// ───────────── dates ─────────────

function DateCell({ value, field, item, ctx }: CellProps) {
  if (typeof value !== 'string' || !value) return <Empty />;
  if (isOverdueOf(item, field, ctx))
    return (
      <Text className="text-crit font-semibold">
        {formatDate(value)} <span aria-hidden>· late</span>
        <span className="sr-only"> (late)</span>
      </Text>
    );
  const relative = (field.config as { relative?: boolean }).relative && !isItemDone(item, ctx);
  if (!relative) return <Text>{formatDate(value)}</Text>;
  const rel = relativeDue(value, ctx.today);
  const days = Math.round(
    (Date.parse(`${value}T00:00:00Z`) - Date.parse(`${ctx.today}T00:00:00Z`)) / 86400000,
  );
  const overdue = days < 0;
  return (
    <span className="flex w-full min-w-0 flex-col gap-0.5">
      <span className={cn('truncate text-[12.5px]', overdue && 'text-crit font-semibold')}>
        {formatDate(value).replace(/ \d{4}$/, '')} · {rel}
      </span>
      <Bar
        pct={overdue ? 100 : Math.max(4, 100 - days * 7)}
        color={overdue ? 'var(--crit)' : days <= 3 ? 'var(--label-orange)' : 'var(--label-grey)'}
      />
    </span>
  );
}

function DateEditor({ value, field, ctx, onCommit, onCancel }: EditorProps) {
  const def = defOf(field);
  const initial = typeof value === 'string' && value ? formatDate(value) : '';
  return (
    <div className="flex flex-col gap-2">
      <TextEditor
        title={field.name}
        initial={initial}
        placeholder="dd/mm/yyyy or 11 Nov 2026"
        invalid="Enter a date, like 20/11/2026 or 20 Nov 2026."
        check={(t) => def.parseText(t, field.config, ctx) !== null}
        onCommit={(t) => onCommit(t === null ? null : def.parseText(t, field.config, ctx))}
        onCancel={onCancel}
      />
      <div className="flex flex-wrap gap-1.5">
        {[
          ['Today', 0],
          ['Tomorrow', 1],
          ['In a week', 7],
        ].map(([label, n]) => (
          <Button
            key={label}
            type="button"
            size="xs"
            variant="outline"
            onClick={() => onCommit(addDays(ctx.today, n as number))}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export const dateUI: FieldTypeUI = { icon: Calendar, Cell: DateCell, Editor: DateEditor };

function DateTimeEditor({ value, field, ctx, onCommit, onCancel }: EditorProps) {
  const v = typeof value === 'string' ? value : null;
  const [d, setD] = useState(v ? isoDateInZone(v, ctx.timeZone) : '');
  const [t, setT] = useState(
    v
      ? new Intl.DateTimeFormat('en-GB', {
          timeZone: ctx.timeZone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(v))
      : '09:00',
  );
  const [error, setError] = useState('');
  const ref = useFocusFirst<HTMLInputElement>();
  const save = () => {
    if (!d) return onCommit(null);
    const next = defOf(field).normalize(`${d} ${t || '00:00'}`, field.config, ctx);
    if (!next) return setError('Enter a date and a time.');
    onCommit(next);
  };
  return (
    <EditorFrame title={field.name} footer={<SaveCancel onSave={save} onCancel={onCancel} />}>
      <div className="flex gap-2">
        <Labelled label="Date">
          {(id) => (
            <input
              id={id}
              ref={ref}
              type="date"
              className={inputClass}
              value={d}
              onChange={(e) => setD(e.target.value)}
              onKeyDown={onEnter(save)}
            />
          )}
        </Labelled>
        <Labelled label={`Time (${ctx.timeZone})`}>
          {(id) => (
            <input
              id={id}
              type="time"
              className={inputClass}
              value={t}
              onChange={(e) => setT(e.target.value)}
              onKeyDown={onEnter(save)}
            />
          )}
        </Labelled>
      </div>
      {error ? (
        <p role="alert" className="text-crit text-xs">
          {error}
        </p>
      ) : null}
    </EditorFrame>
  );
}

export const datetimeUI: FieldTypeUI = {
  icon: CalendarClock,
  Cell: (p) => <TextCell {...p} />,
  Editor: DateTimeEditor,
};

function TimelineEditor({ value, field, ctx, onCommit, onCancel }: EditorProps) {
  const v = value as { start: string; end: string } | null;
  const [start, setStart] = useState(v?.start ?? '');
  const [end, setEnd] = useState(v?.end ?? '');
  const [error, setError] = useState('');
  const ref = useFocusFirst<HTMLInputElement>();
  const save = () => {
    if (!start && !end) return onCommit(null);
    const next = defOf(field).normalize({ start, end }, field.config, ctx);
    if (!next) return setError('The end must be on or after the start.');
    onCommit(next);
  };
  return (
    <EditorFrame
      title={field.name}
      footer={<SaveCancel onSave={save} onCancel={onCancel} onClear={() => onCommit(null)} />}
    >
      <div className="flex gap-2">
        <Labelled label="Start">
          {(id) => (
            <input
              id={id}
              ref={ref}
              type="date"
              className={inputClass}
              value={start}
              onChange={(e) => setStart(e.target.value)}
              onKeyDown={onEnter(save)}
            />
          )}
        </Labelled>
        <Labelled label="End">
          {(id) => (
            <input
              id={id}
              type="date"
              className={inputClass}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              onKeyDown={onEnter(save)}
            />
          )}
        </Labelled>
      </div>
      {error ? (
        <p role="alert" className="text-crit text-xs">
          {error}
        </p>
      ) : null}
    </EditorFrame>
  );
}

export const timelineUI: FieldTypeUI = {
  icon: CalendarRange,
  Cell: ({ value, ctx }) => {
    const v = value as { start: string; end: string } | null;
    if (!v?.start) return <Empty />;
    const total = Math.max(1, (Date.parse(v.end) - Date.parse(v.start)) / 86400000 + 1);
    const done = Math.max(
      0,
      Math.min(total, (Date.parse(ctx.today) - Date.parse(v.start)) / 86400000 + 1),
    );
    return (
      <span className="flex w-full min-w-0 flex-col gap-0.5">
        <span className="truncate text-[12.5px]">
          {formatDate(v.start).replace(/ \d{4}$/, '')} – {formatDate(v.end)}
        </span>
        <Bar pct={(done / total) * 100} color="var(--label-blue)" />
      </span>
    );
  },
  Editor: TimelineEditor,
  editorWidth: 320,
};

function RecurrenceEditor({ value, field, ctx, onCommit, onCancel }: EditorProps) {
  const v = value as { every: number; unit: string; start: string } | null;
  const [every, setEvery] = useState(v ? String(v.every) : '1');
  const [unit, setUnit] = useState(v?.unit ?? 'months');
  const [start, setStart] = useState(v?.start ?? ctx.today);
  const [error, setError] = useState('');
  const ref = useFocusFirst<HTMLInputElement>();
  const save = () => {
    const next = defOf(field).normalize({ every: Number(every), unit, start }, field.config, ctx);
    if (!next) return setError('Enter how often, a unit and a first date.');
    onCommit(next);
  };
  return (
    <EditorFrame
      title={field.name}
      footer={<SaveCancel onSave={save} onCancel={onCancel} onClear={() => onCommit(null)} />}
    >
      <div className="flex gap-2">
        <div className="w-20">
          <Labelled label="Every">
            {(id) => (
              <input
                id={id}
                ref={ref}
                inputMode="numeric"
                className={inputClass}
                value={every}
                onChange={(e) => setEvery(e.target.value)}
                onKeyDown={onEnter(save)}
              />
            )}
          </Labelled>
        </div>
        <Labelled label="Unit">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            >
              {RECURRENCE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          )}
        </Labelled>
        <Labelled label="First date">
          {(id) => (
            <input
              id={id}
              type="date"
              className={inputClass}
              value={start}
              onChange={(e) => setStart(e.target.value)}
              onKeyDown={onEnter(save)}
            />
          )}
        </Labelled>
      </div>
      {error ? (
        <p role="alert" className="text-crit text-xs">
          {error}
        </p>
      ) : null}
    </EditorFrame>
  );
}

export const recurrenceUI: FieldTypeUI = {
  icon: Repeat,
  Cell: (p) => <TextCell {...p} />,
  Editor: RecurrenceEditor,
  editorWidth: 360,
};

function LocationEditor({ value, field, ctx, onCommit, onCancel }: EditorProps) {
  const v = value as { siteId: string; note?: string } | null;
  const sites = [...ctx.sites.values()];
  const [site, setSite] = useState(v?.siteId ?? '');
  const [note, setNote] = useState(v?.note ?? '');
  const ref = useFocusFirst<HTMLSelectElement>();
  const save = () => onCommit(site ? { siteId: site, note } : null);
  if (sites.length === 0)
    return (
      <EditorFrame
        title={field.name}
        footer={
          <Button size="sm" variant="outline" onClick={onCancel}>
            Close
          </Button>
        }
      >
        <Muted className="text-sm">No sites yet. An admin adds sites in workspace settings.</Muted>
      </EditorFrame>
    );
  return (
    <EditorFrame
      title={field.name}
      footer={<SaveCancel onSave={save} onCancel={onCancel} onClear={() => onCommit(null)} />}
    >
      <Labelled label="Site">
        {(id) => (
          <select
            id={id}
            ref={ref}
            className={inputClass}
            value={site}
            onChange={(e) => setSite(e.target.value)}
          >
            <option value="">Choose a site</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </Labelled>
      <Labelled label="Note">
        {(id) => (
          <input
            id={id}
            className={inputClass}
            value={note}
            placeholder="Room, line or area"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={onEnter(save)}
          />
        )}
      </Labelled>
    </EditorFrame>
  );
}

export const locationUI: FieldTypeUI = {
  icon: MapPin,
  Cell: (p) => <TextCell {...p} />,
  Editor: LocationEditor,
};
