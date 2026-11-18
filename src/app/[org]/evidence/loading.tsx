export default function Loading() {
  return (
    <main
      className="flex w-full flex-col gap-5 px-4 pt-5 pb-8 [--hero-gap:20px] sm:px-12 sm:pt-[26px]"
      aria-busy="true"
      aria-label="Loading evidence library"
    >
      <h1>Evidence library</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-soft h-[100px] animate-pulse rounded-lg" />
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
