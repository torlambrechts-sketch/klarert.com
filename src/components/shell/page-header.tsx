import { cn } from '@/lib/utils';
import { CRUMB_SLOT } from './shell-crumb';

// Page header shared by every page (docs/18 §4 hero, docs/05 §2 content): a navy band behind the crumbs (the page's
// own, or what <ShellCrumb> renders into the slot), the h1 and one line of description, actions on the right. The
// band runs the full width of the page column. When the element after it is marked `data-hero-overlap` (cards,
// the Home tiles), the band reaches 88 px under it so that element overlaps the hero.

/** The hero's decoration: three --brand circles at the top right, hidden from screen readers. */
function HeroDeco() {
  return (
    <span aria-hidden className="hero-deco">
      <svg width="420" height="320" viewBox="0 0 420 320" fill="none">
        <circle cx="260" cy="140" r="170" stroke="var(--brand)" strokeWidth="2" />
        <circle cx="300" cy="180" r="110" stroke="var(--brand)" strokeWidth="2" />
        <circle cx="330" cy="200" r="50" fill="var(--brand)" />
      </svg>
    </span>
  );
}

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
    <div className={cn('page-hero', className)}>
      <HeroDeco />
      <div className="hero-text flex min-w-0 flex-[1_1_320px] flex-col gap-3">
        {/* crumbs: the page's own, or the slot <ShellCrumb> renders into (a sheet's folder / sheet and chips) */}
        {crumb ? (
          <div className="hero-crumbs text-label-14 flex min-w-0 items-center gap-2.5">{crumb}</div>
        ) : (
          <div id={CRUMB_SLOT} className="hero-crumbs flex min-w-0 items-center empty:hidden" />
        )}
        <h1 className="text-hero m-0 break-words text-white">{title}</h1>
        {description ? (
          <p className="text-hero-sub text-brand-soft m-0 max-w-[760px] text-pretty">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="hero-actions flex max-w-full shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

// the tabs scroll the current one into view, so they are a client component of their own
export { PageTabs, type PageTab } from './page-tabs';

/** A card (docs/18 §5): white, 8 px radius, the light navy shadow; it may overlap the page's hero. */
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
      data-hero-overlap
      className={cn('bg-surface shadow-card rounded-card flex min-w-0 flex-col', className)}
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
