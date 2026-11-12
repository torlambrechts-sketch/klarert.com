// Loading skeletons (docs/05 §7): grey blocks the size of what is coming, so nothing moves when the data arrives.
// Server components; each route segment's loading.tsx picks one.

const Block = ({ className }: { className: string }) => (
  <div className={`bg-soft animate-pulse rounded ${className}`} />
);

export function PageSkeleton({
  label,
  rows = 6,
  width = 'max-w-4xl',
}: {
  label: string;
  rows?: number;
  width?: string;
}) {
  return (
    <main
      className={`mx-auto flex w-full ${width} flex-col gap-5 px-4 py-6 sm:px-7 sm:pt-[26px]`}
      aria-busy="true"
      aria-label={label}
    >
      <Block className="h-9 w-1/3" />
      <Block className="h-4 w-2/3" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: rows }, (_, i) => (
          <Block key={i} className="h-14" />
        ))}
      </div>
    </main>
  );
}

/** The sheet page: title, view tabs and toolbar, then table rows. */
export function SheetSkeleton() {
  return (
    <main
      className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-5 sm:px-7 sm:pt-[22px]"
      aria-busy="true"
      aria-label="Loading the sheet"
    >
      <Block className="h-4 w-48" />
      <Block className="h-8 w-64" />
      <div className="border-line flex gap-[22px] border-b pb-2">
        {[0, 1, 2].map((i) => (
          <Block key={i} className="h-6 w-16" />
        ))}
      </div>
      <Block className="h-[38px] w-full" />
      <div className="border-line flex flex-col gap-px overflow-hidden rounded-lg border">
        {Array.from({ length: 10 }, (_, i) => (
          <Block key={i} className="h-10 rounded-none" />
        ))}
      </div>
    </main>
  );
}
