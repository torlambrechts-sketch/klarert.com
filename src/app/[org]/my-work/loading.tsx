export default function Loading() {
  return (
    <main
      className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6"
      aria-busy="true"
      aria-label="Loading my work"
    >
      <h1>My work</h1>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-soft h-[76px] animate-pulse rounded-[var(--radius-card)]" />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-soft h-14 animate-pulse rounded" />
        ))}
      </div>
    </main>
  );
}
