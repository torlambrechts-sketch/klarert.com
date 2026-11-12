export default function Loading() {
  return (
    <main
      className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6"
      aria-busy="true"
      aria-label="Loading Home"
    >
      <div className="bg-soft h-[58px] w-2/3 animate-pulse rounded" />
      <div className="bg-soft h-48 animate-pulse rounded-[var(--radius-card)]" />
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-soft h-14 animate-pulse rounded" />
        ))}
      </div>
    </main>
  );
}
