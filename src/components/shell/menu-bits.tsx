// Shared look of side panel rows (docs/18 §4, docs/05 §2.1): 44 px rows, 16 px navy words and an 18 px icon; the
// active row is --brand and bold; hover underlines.

export const itemClass =
  'relative flex min-h-11 w-full items-center gap-2.5 rounded-md px-4 text-left text-nav text-navy outline-offset-[-3px] underline-offset-4 hover:underline aria-[current=page]:font-bold aria-[current=page]:text-brand';

export const iconClass = 'text-navy group-aria-[current=page]/item:text-brand size-[18px] shrink-0';

/**
 * Row controls ("…", drag handle, "+"): shown on hover or focus with a mouse, always on touch screens and phones,
 * and while their menu is open.
 */
export const revealClass =
  'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100 max-[759.98px]:opacity-100';

export function SheetCode({ code }: { code: string }) {
  return (
    <span
      aria-hidden
      className="border-line text-ink bg-surface text-12 flex h-5 min-w-6 shrink-0 items-center justify-center rounded-[5px] border px-1 font-mono font-medium tracking-tight"
    >
      {code}
    </span>
  );
}
