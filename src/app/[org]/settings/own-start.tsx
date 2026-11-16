'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Check,
  ClipboardPaste,
  Copy,
  FileUp,
  Loader2,
  Table2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/fields/shared';
import { byteLength, CSV_LIMITS, parseCsv } from '@/engine/fields/csv';
import {
  draftDetailProblems,
  IMPORT_COLUMNS,
  importRequirements,
  isGroup,
  OWN_LIMITS,
  ownFrameworkProblems,
  shortTitleFor,
  type DraftProblem,
  type DraftRequirement,
} from '@/engine/frameworks/own';
import { FRAMEWORK_KINDS, type FrameworkKind } from '@/engine/frameworks/types';
import { cn } from '@/lib/utils';
import { createOwnFrameworkAction } from './own-actions';

// Workspace admin › Frameworks › Add your own (docs/12 Your own frameworks): name the framework, then start from a
// pasted list or a CSV file (shown first), a blank grid, or the structure of a catalogue framework. A pasted list is
// read and checked here with the engine (importRequirements, ownFrameworkProblems) so its problems show with row
// numbers before anything is saved; the grid that follows fixes them.

export const KIND_TEXT: Record<FrameworkKind, string> = {
  internal: 'Internal rule set',
  standard: 'Standard',
  regulation: 'Regulation',
  law: 'Law',
};

type Start = 'paste' | 'blank' | 'copy';
type Read = { rows: DraftRequirement[]; problems: DraftProblem[]; ignored: string[] } | null;

const COLUMN_LABEL: Record<string, string> = {
  ref: 'Ref',
  parent: 'Parent',
  kind: 'Kind',
  title: 'Title',
  text: 'Text',
  guidance: 'Guidance',
  questions: 'Audit questions',
  evidence: 'Evidence',
  tags: 'Tags',
};

/** Problems with their row numbers, the first `limit`. */
export function ProblemList({
  problems,
  limit = 50,
  label = 'Problems in the list',
}: {
  problems: DraftProblem[];
  limit?: number;
  label?: string;
}) {
  if (problems.length === 0) return null;
  return (
    <div className="border-warn/40 bg-warn-soft flex flex-col gap-2 rounded-md border p-3">
      <p className="text-label-14 text-warn m-0 flex items-center gap-1.5 font-medium">
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        {problems.length === 1
          ? '1 problem'
          : `${problems.length.toLocaleString('en-GB')} problems`}{' '}
        to fix before publishing
      </p>
      <ul aria-label={label} className="text-copy-13 m-0 flex list-none flex-col gap-1 p-0">
        {problems.slice(0, limit).map((p, i) => (
          <li key={i}>
            <span className="font-medium">
              {p.row ? `Row ${p.row}` : 'The list'}
              {p.column ? ` · ${COLUMN_LABEL[p.column] ?? p.column}` : ''}
            </span>
            {p.ref ? (
              <span className="text-label-12-mono text-muted-foreground"> {p.ref}</span>
            ) : null}
            {': '}
            {p.message}
          </li>
        ))}
      </ul>
      {problems.length > limit ? (
        <p className="text-copy-13 text-muted-foreground m-0">
          And {(problems.length - limit).toLocaleString('en-GB')} more. You fix them in the next
          step.
        </p>
      ) : null}
    </div>
  );
}

export function OwnFrameworkStart({
  org,
  catalogue,
}: {
  org: string;
  catalogue: { key: string; version: string; title: string; requirements: number }[];
}) {
  const router = useRouter();
  const ids = {
    title: useId(),
    short: useId(),
    kind: useId(),
    paste: useId(),
    file: useId(),
    copy: useId(),
    mappings: useId(),
    help: useId(),
  };
  const [title, setTitle] = useState('');
  const [shortTitle, setShortTitle] = useState('');
  const [shortTouched, setShortTouched] = useState(false);
  const [kind, setKind] = useState<FrameworkKind>('internal');
  const [start, setStart] = useState<Start>('paste');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [read, setRead] = useState<Read>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [copyId, setCopyId] = useState(
    catalogue[0] ? `${catalogue[0].key}@${catalogue[0].version}` : '',
  );
  const [mappings, setMappings] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const short = shortTouched ? shortTitle : shortTitleFor(title);
  const details = draftDetailProblems({ title, shortTitle: short });

  function check(source = text) {
    setRead(null);
    const t = parseCsv(source);
    if (!t.ok) {
      setReadError(t.message);
      return;
    }
    const r = importRequirements(t.table);
    if (r.problems.length) {
      setReadError(r.problems[0]!);
      return;
    }
    setReadError(null);
    setRead({ rows: r.rows, problems: ownFrameworkProblems(r.rows), ignored: r.ignored });
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > CSV_LIMITS.bytes) {
      setReadError('The file is larger than 10 MB. Split it and add the parts.');
      return;
    }
    const content = await file.text();
    setFileName(file.name);
    setText(content);
    check(content);
  }

  const counts = useMemo(() => {
    if (!read) return null;
    const groups = read.rows.filter(isGroup).length;
    return { groups, items: read.rows.length - groups };
  }, [read]);

  async function create() {
    setBusy(true);
    setError(null);
    const [key, version] = copyId.split('@');
    try {
      const r = await createOwnFrameworkAction({
        org,
        title,
        shortTitle: short,
        kind,
        start,
        ...(start === 'paste' ? { requirements: read?.rows ?? [] } : {}),
        ...(start === 'copy' ? { copy: { framework: key, version, mappings } } : {}),
      });
      if (!r.ok) {
        setError(r.error.fieldErrors ? Object.values(r.error.fieldErrors)[0]! : r.error.message);
        setBusy(false);
        return;
      }
      router.push(`/${org}/settings/own-frameworks?key=${r.data.key}`);
    } catch {
      setError('The draft could not be made. Nothing was saved. Try again.');
      setBusy(false);
    }
  }

  const canCreate =
    details.length === 0 &&
    !busy &&
    (start === 'blank' ||
      (start === 'paste' && !!read && read.rows.length > 0) ||
      (start === 'copy' && !!copyId));

  const choice = (value: Start, icon: React.ReactNode, label: string, help: string) => (
    <label
      className={cn(
        'border-line hover:border-line-strong flex cursor-pointer items-start gap-3 rounded-lg border p-3',
        'has-[:focus-visible]:ring-focus has-[:focus-visible]:ring-2',
        start === value && 'border-ink bg-soft',
      )}
    >
      <input
        type="radio"
        name="start"
        value={value}
        checked={start === value}
        onChange={() => setStart(value)}
        className="mt-1 size-4 shrink-0"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-label-14 flex items-center gap-1.5 font-medium">
          {icon} {label}
        </span>
        <span className="text-copy-13 text-muted-foreground">{help}</span>
      </span>
    </label>
  );

  return (
    <div className="flex flex-col gap-5">
      <section className="border-line bg-background-100 flex flex-col gap-4 rounded-lg border p-5 sm:px-[22px]">
        <h2 className="text-heading-16 m-0">Name it</h2>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.title} className="text-label-13 font-medium">
              Name
            </label>
            <input
              id={ids.title}
              className={cn(inputClass, 'h-9')}
              value={title}
              maxLength={OWN_LIMITS.frameworkTitle}
              placeholder="Acme supplier security schedule"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.short} className="text-label-13 font-medium">
              Short name
            </label>
            <input
              id={ids.short}
              className={cn(inputClass, 'h-9')}
              value={short}
              maxLength={OWN_LIMITS.shortTitle}
              aria-describedby={`${ids.short}-help`}
              onChange={(e) => {
                setShortTouched(true);
                setShortTitle(e.target.value);
              }}
            />
            <span id={`${ids.short}-help`} className="text-label-12 text-muted-foreground">
              On chips: “{short || 'ACME'} 4.2”.
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.kind} className="text-label-13 font-medium">
              Kind
            </label>
            <select
              id={ids.kind}
              className={cn(inputClass, 'h-9')}
              value={kind}
              onChange={(e) => setKind(e.target.value as FrameworkKind)}
            >
              {FRAMEWORK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_TEXT[k]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="border-line bg-background-100 flex flex-col gap-4 rounded-lg border p-5 sm:px-[22px]">
        <h2 className="text-heading-16 m-0">Start from</h2>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="sr-only">How to start</legend>
          {choice(
            'paste',
            <ClipboardPaste className="size-4" aria-hidden />,
            'Paste from Excel or upload a CSV file',
            'One row per requirement. The first row names the columns.',
          )}
          {choice(
            'blank',
            <Table2 className="size-4" aria-hidden />,
            'Start blank',
            'Type the groups and requirements into a grid.',
          )}
          {choice(
            'copy',
            <Copy className="size-4" aria-hidden />,
            'Copy the structure of a catalogue framework',
            'Refs, hierarchy and kinds only. You write every title.',
          )}
        </fieldset>

        {start === 'paste' ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.paste} className="text-label-13 font-medium">
                Paste the list
              </label>
              <textarea
                id={ids.paste}
                className={cn(inputClass, 'text-label-13-mono h-auto min-h-40 py-2 font-normal')}
                value={text}
                aria-describedby={ids.help}
                placeholder={
                  'ref\ttitle\ttext\tgroup\n1.1\tAccess reviews\tReview all access every quarter.\tAccess'
                }
                onChange={(e) => {
                  setText(e.target.value);
                  setFileName(null);
                  setRead(null);
                }}
              />
              <span id={ids.help} className="text-label-12 text-muted-foreground">
                Columns: {IMPORT_COLUMNS.join(', ')}. Ref and title are needed. A title has at most{' '}
                {OWN_LIMITS.title} characters; put the full wording in text. Rows with a group and
                no parent go in that group.
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!text.trim()}
                onClick={() => check()}
              >
                <Check aria-hidden /> Check the list
              </Button>
              <label
                htmlFor={ids.file}
                className="border-line text-label-14 hover:bg-soft has-[:focus-visible]:ring-focus inline-flex h-[40px] cursor-pointer items-center gap-1.5 rounded-md border px-3 font-medium has-[:focus-visible]:ring-2"
              >
                <FileUp className="size-4" aria-hidden /> Upload a CSV file
                <input
                  id={ids.file}
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
                  className="sr-only"
                  onChange={(e) => void onFile(e.target.files?.[0])}
                />
              </label>
              {fileName ? (
                <span className="text-label-13 text-muted-foreground">
                  {fileName} · {Math.ceil(byteLength(text) / 1024).toLocaleString('en-GB')} KB
                </span>
              ) : null}
            </div>
            {readError ? (
              <p role="alert" className="text-copy-14 m-0 flex items-center gap-1.5">
                <X className="text-crit size-4 shrink-0" aria-hidden /> {readError}
              </p>
            ) : null}
            {read && counts ? (
              <div className="flex flex-col gap-2" data-testid="paste-result">
                <p role="status" className="text-copy-14 m-0 flex items-center gap-1.5">
                  <Check className="text-good size-4 shrink-0" aria-hidden />
                  Read {counts.items.toLocaleString('en-GB')}{' '}
                  {counts.items === 1 ? 'requirement' : 'requirements'} in {counts.groups}{' '}
                  {counts.groups === 1 ? 'group' : 'groups'}.
                  {read.problems.length === 0 ? ' No problems.' : ''}
                </p>
                {read.ignored.length ? (
                  <p className="text-copy-13 text-muted-foreground m-0">
                    Not read: {read.ignored.join(', ')}.
                  </p>
                ) : null}
                <ProblemList problems={read.problems} />
              </div>
            ) : null}
          </div>
        ) : null}

        {start === 'copy' ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.copy} className="text-label-13 font-medium">
                Catalogue framework
              </label>
              <select
                id={ids.copy}
                className={cn(inputClass, 'h-9')}
                value={copyId}
                onChange={(e) => setCopyId(e.target.value)}
              >
                {catalogue.map((f) => (
                  <option key={`${f.key}@${f.version}`} value={`${f.key}@${f.version}`}>
                    {f.title} ({f.requirements} requirements)
                  </option>
                ))}
              </select>
              <span className="text-label-12 text-muted-foreground">
                Copies the refs, hierarchy and kinds. Titles start empty and you write every one
                before publishing. Our purpose, guidance, audit questions and typical evidence are
                not copied.
              </span>
            </div>
            <label htmlFor={ids.mappings} className="text-label-13 flex items-start gap-2">
              <input
                id={ids.mappings}
                type="checkbox"
                className="mt-0.5 size-4"
                checked={mappings}
                onChange={(e) => setMappings(e.target.checked)}
              />
              Also map each requirement to the one it was copied from (equivalent). You review the
              mappings before publishing.
            </label>
          </div>
        ) : null}
      </section>

      {details.length && (title || shortTouched) ? (
        <p role="alert" className="text-copy-14 m-0 flex items-center gap-1.5">
          <X className="text-crit size-4 shrink-0" aria-hidden /> {details[0]}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-copy-14 m-0 flex items-center gap-1.5">
          <X className="text-crit size-4 shrink-0" aria-hidden /> {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild variant="outline">
          <Link href={`/${org}/settings?tab=frameworks`}>Cancel</Link>
        </Button>
        <Button type="button" disabled={!canCreate} onClick={() => void create()}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {busy ? 'Making the draft…' : 'Continue to the grid'}
        </Button>
      </div>
    </div>
  );
}
