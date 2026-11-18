export default function Loading() {
  return (
    <main
      className="flex w-full flex-col gap-4 px-4 pt-5 pb-8 sm:px-[28px] sm:pt-[26px]"
      aria-busy="true"
      aria-label="Loading workflow"
    >
      <div className="flex flex-col gap-1.5 pb-[18px]">
        <div className="bg-soft h-[18px] w-48 animate-pulse rounded" />
        <h1>Workflow</h1>
        <div className="bg-soft h-[42px] w-full max-w-[780px] animate-pulse rounded" />
      </div>
      <div className="bg-soft h-[40px] w-full max-w-[360px] animate-pulse rounded-md" />
      <div className="border-line bg-surface overflow-hidden rounded-lg border">
        <div className="border-soft h-9 border-b" />
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="border-line flex h-14 items-center gap-3 border-b px-3 last:border-b-0"
          >
            <div className="bg-soft size-7 animate-pulse rounded-full" />
            <div className="bg-soft h-4 w-48 animate-pulse rounded" />
          </div>
        ))}
      </div>
    </main>
  );
}
