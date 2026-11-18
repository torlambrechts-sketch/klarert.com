import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { inputClass } from '@/components/fields/shared';
import { cn } from '@/lib/utils';

// Building blocks of the expandable list pages (Workflow, Automations) in the board design: a crumb with a count
// badge, the toolbar search and segmented filter, the bordered list with a header row, a row caret that expands the
// row in place, the round row icon and the card with a 52 px header under the list.

/** "Build / Automations [19 of 20 on]": the page crumb with a grey count badge. */
export function ListCrumb({
  section,
  page,
  badge,
}: {
  section: string;
  page: string;
  badge?: React.ReactNode;
}) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>{section}</span>
      <span aria-hidden className="text-line-strong">
        /
      </span>
      <span className="text-ink font-medium">{page}</span>
      {badge ? <CountBadge>{badge}</CountBadge> : null}
    </span>
  );
}

export function CountBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-soft text-muted-foreground text-12 rounded-full px-[9px] py-0.5 font-medium whitespace-nowrap">
      {children}
    </span>
  );
}

/** The 38 px toolbar search with a leading icon. */
export function ListSearch({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange(v: string): void;
  placeholder: string;
  label: string;
}) {
  return (
    <label className="relative flex w-full items-center sm:w-[360px] sm:flex-[0_1_360px]">
      <span className="sr-only">{label}</span>
      <Search
        className="text-muted-foreground pointer-events-none absolute left-2.5 size-[15px]"
        aria-hidden
      />
      <input
        type="search"
        className={cn(inputClass, 'text-14 h-[40px] w-full pl-8 shadow-none')}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export const toolbarSelectClass = cn(
  inputClass,
  'select-chevron h-[40px] w-full text-14 shadow-none sm:w-auto sm:min-w-[170px]',
);

/** All / On / Off: a segmented control (aria-pressed buttons). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange(v: T): void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="border-line bg-surface box-border inline-flex h-[40px] rounded-md border p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className="text-muted-foreground hover:text-ink aria-pressed:bg-soft aria-pressed:text-ink focus-visible:outline-focus text-14 rounded-[4px] px-3 focus-visible:outline-2 aria-pressed:font-medium"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The bordered list: 10 px radius, hairline rows. */
export function ListFrame({
  label,
  header,
  children,
  busy,
}: {
  label: string;
  header: React.ReactNode;
  children: React.ReactNode;
  busy?: boolean;
}) {
  return (
    <div className="border-surface-line bg-surface overflow-hidden rounded-lg border">
      {header}
      <ul aria-label={label} aria-busy={busy || undefined} className="m-0 list-none p-0">
        {children}
      </ul>
    </div>
  );
}

/** The column header row (visual only: each row names its own values). */
export function ListHeader({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'border-surface-line bg-head text-muted-foreground text-12 grid min-h-9 items-center gap-x-3 border-b pr-3 pl-1.5 font-medium',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function RowCaret({
  open,
  label,
  onClick,
  controls,
}: {
  open: boolean;
  label: string;
  onClick(): void;
  controls?: string;
}) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      onClick={onClick}
      className="text-muted-foreground hover:bg-soft hover:text-ink focus-visible:outline-focus grid size-8 place-items-center rounded-md focus-visible:outline-2"
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

/** The 28 px round icon at the start of a row's name. */
export function RowIcon({
  icon: Icon,
  dim,
}: {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  dim?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'border-line text-muted-foreground bg-surface grid size-7 shrink-0 place-items-center rounded-full border',
        dim && 'opacity-55',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
    </span>
  );
}

/** A card with a 52 px header (title on the left, a quiet note or link on the right). */
export function PanelCard({
  title,
  aside,
  headingId,
  children,
  className,
}: {
  title: string;
  aside?: React.ReactNode;
  headingId: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className={cn('border-line bg-surface flex min-w-0 flex-col rounded-lg border', className)}
    >
      <header className="border-line flex min-h-[52px] flex-wrap items-center justify-between gap-x-2.5 border-b px-4 py-2">
        <h2 id={headingId} className="text-14 m-0 font-semibold">
          {title}
        </h2>
        {aside ? <span className="text-muted-foreground text-13">{aside}</span> : null}
      </header>
      {children}
    </section>
  );
}

/** The grey expanded area under an open row. */
export function RowDrawer({
  id,
  children,
  className,
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      id={id}
      className={cn('border-soft bg-subtle border-t px-4 pt-1 pb-3.5 md:pl-[58px]', className)}
    >
      {children}
    </div>
  );
}
