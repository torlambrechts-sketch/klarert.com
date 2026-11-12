export default function Loading() {
  return (
    <main
      className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-7 sm:pt-[26px]"
      aria-busy="true"
      aria-label="Loading workflow"
    >
      <h1>Workflow</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-soft h-[100px] animate-pulse rounded-xl" />
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
