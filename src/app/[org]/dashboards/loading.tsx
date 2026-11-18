// Loading a dashboard: the header, the period switch, the key figures card and three cards, as quiet blocks in the
// places they will take (no layout shift when the figures arrive).
export default function Loading() {
  return (
    <main
      className="flex w-full flex-col gap-4 px-4 pt-5 pb-8 sm:px-[28px] sm:pt-[26px]"
      aria-busy="true"
      aria-label="Loading dashboards"
    >
      <div className="flex flex-col gap-1.5 pb-0.5">
        <h1 className="m-0">Dashboards</h1>
        <div className="bg-soft h-5 w-full max-w-[560px] animate-pulse rounded" />
      </div>
      <div className="bg-soft h-[40px] w-[260px] animate-pulse rounded-md" />
      <div className="border-line bg-surface h-[440px] animate-pulse rounded-lg border" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="border-line bg-subtle h-[380px] animate-pulse rounded-lg border"
          />
        ))}
      </div>
    </main>
  );
}
