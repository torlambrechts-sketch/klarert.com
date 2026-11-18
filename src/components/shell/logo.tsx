import Link from 'next/link';
import { cn } from '@/lib/utils';

/** The Keptrow mark (docs/18 §4): two brand bars, a short sky bar and a green tick. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      width="30"
      height="30"
      viewBox="0 0 30 30"
      className={cn('shrink-0', className)}
    >
      <rect x="2" y="5" width="26" height="5" rx="2.5" fill="var(--brand)" />
      <rect x="2" y="12.5" width="26" height="5" rx="2.5" fill="var(--brand)" />
      <rect x="2" y="20" width="16" height="5" rx="2.5" fill="var(--sky)" />
      <path
        d="M20.5 22.5l2.5 2.5 5-6"
        stroke="var(--ok)"
        strokeWidth="2.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The mark and "keptrow" in the top bar's 288 px slot; a link to Home. */
export function Logo({ href }: { href: string }) {
  return (
    <Link
      href={href}
      aria-label="keptrow, Home"
      className="text-brand text-logo flex shrink-0 items-center gap-2.5 rounded-md min-[640px]:w-[288px]"
    >
      <LogoMark />
      <span aria-hidden className="max-[639.98px]:sr-only">
        keptrow
      </span>
    </Link>
  );
}
