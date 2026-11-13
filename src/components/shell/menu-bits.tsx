// Shared look of side-menu rows (docs/05 §2.1).

export const itemClass =
  'flex h-[34px] w-full items-center gap-2.5 rounded-md px-2.5 text-left text-label-14 text-ink outline-offset-[-2px] hover:bg-nav-hover hover:text-ink aria-[current=page]:bg-nav-active aria-[current=page]:font-medium aria-[current=page]:text-ink';

export const iconClass =
  'text-muted-foreground group-hover/item:text-ink group-aria-[current=page]/item:text-ink size-4 shrink-0';

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
      className="border-line text-ink bg-background-100 text-label-12-mono flex h-5 min-w-6 shrink-0 items-center justify-center rounded-[5px] border px-1 font-medium tracking-tight"
    >
      {code}
    </span>
  );
}
