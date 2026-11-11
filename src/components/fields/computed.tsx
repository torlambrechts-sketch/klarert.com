'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Calculator,
  GitBranch,
  History,
  IdCard,
  Link as LinkIcon,
  MousePointerClick,
  Search,
  Sigma,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import type { AiValue } from '@/engine/fields/ai';
import type { FormulaConfig } from '@/engine/fields/formula';
import { Button } from '@/components/ui/button';
import { computedUI, Muted, OptionCell, TextCell } from './kit';
import { LinkCell, LinkEditor } from './links';
import { Chip, displayText, EditorFrame, ExplainEditor, Text } from './shared';
import type { FieldTypeUI } from './types';

// Linked, computed and system types (docs/03 §3.4). Computed values are read-only: their editor explains where the
// value comes from.

const ERRORS: Record<string, string> = {
  '#REF': 'The formula refers to a field that does not exist.',
  '#LOOP': 'The formula refers to itself, directly or through other formulas.',
  '#ERR': 'The formula has a syntax or calculation error.',
  '#DIV0': 'The formula divides by zero.',
};

const nameOfKey = (key: string | null | undefined, fields: Map<string, { name: string }>) =>
  (key && fields.get(key)?.name) || 'a field that is not chosen yet';

const CALCULATED = (
  <Muted className="text-xs">The app calculates this value; it cannot be typed.</Muted>
);

export const linkUI: FieldTypeUI = {
  icon: LinkIcon,
  Cell: LinkCell,
  Editor: LinkEditor,
  editorWidth: 340,
};

export const lookupUI = computedUI({
  icon: Search,
  explain: ({ field, ctx }) => {
    const cfg = field.config as { linkFieldKey: string; targetFieldKey: string };
    return (
      <>
        <p>
          Shows {cfg.targetFieldKey ? `the ${cfg.targetFieldKey} field` : 'a field'} of the items
          linked through {nameOfKey(cfg.linkFieldKey, ctx.fieldsByKey)}.
        </p>
        {CALCULATED}
      </>
    );
  },
});

export const rollupUI = computedUI({
  icon: Sigma,
  Cell: (p) => <TextCell {...p} className="text-right tabular-nums" />,
  explain: ({ field, ctx }) => {
    const cfg = field.config as { linkFieldKey: string; targetFieldKey: string | null; fn: string };
    return (
      <>
        <p>
          The {cfg.fn} of {cfg.targetFieldKey ?? 'the items'} across the items linked through{' '}
          {nameOfKey(cfg.linkFieldKey, ctx.fieldsByKey)}.
        </p>
        {CALCULATED}
      </>
    );
  },
});

export const formulaUI = computedUI({
  icon: Calculator,
  Cell: ({ value, field, ctx }) => {
    if (typeof value === 'string' && ERRORS[value])
      return (
        <span className="text-muted-foreground italic" title={ERRORS[value]}>
          {value}
          <span className="sr-only"> {ERRORS[value]}</span>
        </span>
      );
    const t = displayText(field, value, ctx);
    return t ? (
      <Text className={typeof value === 'number' ? 'text-right tabular-nums' : undefined}>{t}</Text>
    ) : (
      <span className="sr-only">Empty</span>
    );
  },
  explain: ({ value, field }) => {
    const cfg = field.config as FormulaConfig;
    return (
      <>
        {cfg.expr ? (
          <code className="bg-soft rounded px-1.5 py-1 font-mono text-xs break-all">
            {cfg.expr}
          </code>
        ) : (
          <p>This formula is empty. Write it in the field settings.</p>
        )}
        {typeof value === 'string' && ERRORS[value] ? (
          <p className="text-crit">{ERRORS[value]}</p>
        ) : null}
        {CALCULATED}
      </>
    );
  },
});

export const progressUI = computedUI({
  icon: TrendingUp,
  Cell: ({ value }) =>
    typeof value === 'number' ? (
      <span className="flex w-full items-center gap-2">
        <span
          className="bg-soft border-line block h-1.5 flex-1 overflow-hidden rounded-full border"
          aria-hidden
        >
          <span
            className="bg-good block h-full"
            style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
          />
        </span>
        <span className="shrink-0 text-xs tabular-nums">{Math.round(value)}%</span>
      </span>
    ) : (
      <span className="sr-only">Empty</span>
    ),
  explain: ({ field, ctx }) => (
    <>
      <p>
        Progress of{' '}
        {nameOfKey((field.config as { sourceFieldKey?: string }).sourceFieldKey, ctx.fieldsByKey)}:
        answered checklist lines, or linked items that are done.
      </p>
      {CALCULATED}
    </>
  ),
});

export const autoidUI = computedUI({
  icon: IdCard,
  Cell: (p) => <TextCell {...p} className="font-mono text-xs" />,
  explain: () => (
    <>
      <p>
        The item&apos;s ID, given by the app when the item is created. It never changes and is never
        reused.
      </p>
    </>
  ),
});

export const metaUI = computedUI({
  icon: History,
  explain: ({ field }) => {
    const which = (field.config as { which: string }).which;
    return (
      <p>
        {which.startsWith('created')
          ? 'Who created the item and when'
          : 'Who changed the item last and when'}
        , kept by the app.
      </p>
    );
  },
});

export const workflowstepUI = computedUI({
  icon: GitBranch,
  Cell: (p) => <OptionCell {...p} />,
  explain: () => <p>The workflow step is set by automations only.</p>,
});

function ButtonEditor({ field, onButton, onCancel }: Parameters<FieldTypeUI['Editor']>[0]) {
  const cfg = field.config as { label: string; confirm: string | null };
  const ref = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => ref.current?.focus(), []);
  if (!onButton)
    return (
      <ExplainEditor title={field.name} onCancel={onCancel}>
        <p>Viewers cannot run buttons.</p>
      </ExplainEditor>
    );
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
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onButton();
            }}
          >
            {cfg.label}
          </Button>
        </>
      }
    >
      <p className="text-sm">{cfg.confirm ?? `Run the automations that use ${field.name}.`}</p>
    </EditorFrame>
  );
}

export const buttonUI: FieldTypeUI = {
  icon: MousePointerClick,
  Cell: ({ field }) => (
    <span className="border-line bg-soft inline-flex max-w-full items-center rounded-md border px-2 py-0.5 text-xs font-semibold">
      <span className="truncate">{(field.config as { label: string }).label}</span>
    </span>
  ),
  Editor: ButtonEditor,
};

function AiEditor({
  value,
  field,
  ctx,
  onCommit,
  onCommitField,
  onCancel,
}: Parameters<FieldTypeUI['Editor']>[0]) {
  const v = value as AiValue | null;
  const targetKey = (field.config as { targetFieldKey: string }).targetFieldKey;
  const target = targetKey ? ctx.fieldsByKey.get(targetKey) : undefined;
  if (!v)
    return (
      <ExplainEditor title={field.name} onCancel={onCancel}>
        <p>No proposal yet. Proposals are stored here for a person to accept or reject.</p>
      </ExplainEditor>
    );
  const decide = (status: 'accepted' | 'rejected') => {
    if (status === 'accepted' && target && onCommitField) onCommitField(target.id, v.proposal);
    onCommit({ ...v, status, by: ctx.userId, at: ctx.now.toISOString() });
  };
  return (
    <EditorFrame
      title={field.name}
      footer={
        v.status === 'proposed' && onCommitField ? (
          <>
            <Button size="sm" variant="outline" onClick={() => decide('rejected')}>
              Reject
            </Button>
            <Button size="sm" disabled={!target} onClick={() => decide('accepted')}>
              Accept{target ? ` into ${target.name}` : ''}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={onCancel}>
            Close
          </Button>
        )
      }
    >
      <p className="text-sm">{displayText(field, v, ctx)}</p>
      {!target ? (
        <Muted className="text-xs">Choose the field a proposal fills in the field settings.</Muted>
      ) : null}
    </EditorFrame>
  );
}

export const aiUI: FieldTypeUI = {
  icon: Sparkles,
  Cell: ({ value, field, ctx }) => {
    const v = value as AiValue | null;
    if (!v) return <span className="sr-only">Empty</span>;
    const color = v.status === 'accepted' ? 'green' : v.status === 'rejected' ? 'grey' : 'blue';
    return (
      <span className="flex min-w-0 items-center gap-1">
        <Chip
          option={{
            id: v.status,
            label: v.status[0]!.toUpperCase() + v.status.slice(1),
            color,
            done: v.status === 'accepted',
          }}
        />
        <Text className="text-xs">
          {displayText(field, { ...v, status: 'proposed' }, ctx).replace(/^Proposed: /, '')}
        </Text>
      </span>
    );
  },
  Editor: AiEditor,
  editorWidth: 320,
};
