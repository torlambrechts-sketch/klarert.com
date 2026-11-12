import Link from 'next/link';
import { cn } from '@/lib/utils';

// Page header and underline tabs shared by every page (docs/05 §2): an optional crumb, the h1 (26 px, 600), one line
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
        {crumb ? <div className="text-muted-foreground text-[13px]">{crumb}</div> : null}
        <h1 className="m-0 break-words">{title}</h1>
        {description ? (
          <p className="m-0 max-w-[780px] text-[14px] leading-normal text-pretty text-[#52525b]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
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
              className="text-muted-foreground hover:text-ink aria-[current=page]:text-ink relative flex h-10 items-center px-px text-[14px] whitespace-nowrap outline-offset-[-2px] aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-0 aria-[current=page]:after:-bottom-px aria-[current=page]:after:h-0.5 aria-[current=page]:after:rounded-sm aria-[current=page]:after:bg-[var(--ink)]"
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A card in the shadcn style: 12 px radius, hairline border, a whisper of shadow. */
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
        'border-line flex min-w-0 flex-col rounded-xl border bg-white shadow-xs',
        className,
      )}
    >
      {title ? (
        <div className="px-[22px] pt-5 pb-1.5">
          <h2 id={headingId} className="m-0 text-[15px] font-semibold tracking-[-0.01em]">
            {title}
          </h2>
          {description ? (
            <p className="text-muted-foreground m-0 mt-1 text-[13px]">{description}</p>
          ) : null}
        </div>
      ) : null}
      <div className={cn('flex-1', flush ? 'pt-2 pb-1' : 'px-[22px] py-3.5')}>{children}</div>
      {footer ? (
        <div className="border-soft text-muted-foreground flex items-center justify-between gap-2.5 border-t px-[22px] py-3 text-[12.5px]">
          {footer}
        </div>
      ) : null}
    </section>
  );
}
