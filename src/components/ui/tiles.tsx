import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// Small Keptrow building blocks (docs/18 §5): KPI tiles, the date chip, the callout and the quick-start tile.

/** KPI tiles: a grid of figures (not buttons), at least 170 px wide. */
export function KpiGrid({
  label,
  className,
  children,
  ...rest
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDListElement>) {
  return (
    <dl
      aria-label={label}
      className={cn(
        'm-0 grid grid-cols-[repeat(auto-fit,minmax(min(170px,100%),1fr))] gap-3',
        className,
      )}
      {...rest}
    >
      {children}
    </dl>
  );
}

/** One KPI: a 14 px muted label and a 24 px figure; late figures in --bad with "!". */
export function KpiTile({
  label,
  value,
  late,
}: {
  label: string;
  value: React.ReactNode;
  late?: boolean;
}) {
  return (
    <div className="border-line bg-surface rounded-card flex min-h-[72px] flex-col justify-center gap-0.5 border px-4 py-3.5">
      <dt className="text-14 text-muted-foreground order-1 truncate">{label}</dt>
      <dd className={cn('text-kpi m-0 tabular-nums', late ? 'text-bad' : 'text-navy')}>
        {late ? <span aria-hidden>! </span> : null}
        {value}
      </dd>
    </div>
  );
}

/** Date chip: 48 px wide, the day and the month; late is red. */
export function DateChip({ day, month, late }: { day: string; month: string; late?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'rounded-card flex w-12 shrink-0 flex-col items-center justify-center py-1.5 leading-none',
        late ? 'bg-badge-red-bg text-bad-ink' : 'bg-brand-soft text-navy',
      )}
    >
      <span className="text-18 font-semibold">{day}</span>
      <span className="text-12 mt-0.5 font-semibold uppercase">{month}</span>
    </span>
  );
}

/** Callout: --panel, 6 px radius, 14 × 16 px padding. */
export function Callout({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn('bg-panel rounded-md px-4 py-3.5', className)}>{children}</div>;
}

/** Quick-start tile: white card, an icon top left, a bold title, one muted line and a chevron top right. */
export function QuickTile({
  href,
  icon,
  title,
  line,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  line: string;
}) {
  return (
    <Link
      href={href}
      className="bg-surface shadow-card rounded-card text-ink relative flex min-h-[118px] flex-col gap-1 px-5 py-[18px] no-underline hover:underline"
    >
      <span className="bg-brand-soft text-navy mb-1 flex size-10 items-center justify-center rounded-full [&_svg]:size-5">
        {icon}
      </span>
      <span className="text-navy font-semibold">{title}</span>
      <span className="text-sub">{line}</span>
      <ChevronRight className="text-navy absolute top-4 right-4 size-5" aria-hidden />
    </Link>
  );
}
