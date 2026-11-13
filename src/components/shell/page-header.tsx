import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ShellCrumb } from './shell-crumb';

// Page header and underline tabs shared by every page (docs/05 §2): an optional crumb (shown in the top strip), the h1 (heading-26), one line
// of description, actions on the right; tabs under it with a 2 px ink underline on the current one.

export function PageHeader({
  crumb,
  title,
  description,
  actions,
  className,
}: {
  crumb?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-5 gap-y-3', className)}>
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1.5">
        {/* the crumb sits in the top strip on every page, as on a sheet, so titles line up across pages */}
        {crumb ? (
          <ShellCrumb>
            <div className="text-muted-foreground text-label-14 flex min-w-0 items-center gap-2.5">
              {crumb}
            </div>
          </ShellCrumb>
        ) : null}
        <h1 className="m-0 break-words">{title}</h1>
        {description ? (
          <p className="text-muted-foreground text-copy-14 m-0 max-w-[780px] leading-[21px] text-pretty">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export type PageTab = { id: string; label: string; href: string };

export function PageTabs({
  label,
  tabs,
  active,
  className,
}: {
  label: string;
  tabs: PageTab[];
  active: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn('border-line border-b', className)}>
      <ul className="m-0 flex [scrollbar-width:none] list-none gap-[22px] overflow-x-auto p-0">
        {tabs.map((t) => (
          <li key={t.id}>
            <Link
              href={t.href}
              aria-current={t.id === active ? 'page' : undefined}
              className="text-muted-foreground hover:text-ink aria-[current=page]:text-ink text-label-14 relative flex h-10 items-center px-px whitespace-nowrap outline-offset-[-2px] aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-0 aria-[current=page]:after:-bottom-px aria-[current=page]:after:h-0.5 aria-[current=page]:after:rounded-sm aria-[current=page]:after:bg-[var(--ink)]"
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A card in the Geist material: 8 px radius, 1 px border, no shadow. */
export function Card({
  title,
  description,
  footer,
  children,
  className,
  headingId,
  flush,
}: {
  /** Content runs edge to edge (lists with their own row padding). */
  flush?: boolean;
  title?: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headingId?: string;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'border-line bg-background-100 flex min-w-0 flex-col rounded-lg border',
        className,
      )}
    >
      {title ? (
        <div className="px-[22px] pt-5 pb-1.5">
          <h2 id={headingId} className="text-heading-16 m-0">
            {title}
          </h2>
          {description ? (
            <p className="text-muted-foreground text-copy-13 m-0 mt-1">{description}</p>
          ) : null}
        </div>
      ) : null}
      <div className={cn('flex-1', flush ? 'pt-2 pb-1' : 'px-[22px] py-3.5')}>{children}</div>
      {footer ? (
        <div className="border-soft text-muted-foreground text-label-13 flex items-center justify-between gap-2.5 border-t px-[22px] py-3">
          {footer}
        </div>
      ) : null}
    </section>
  );
}
