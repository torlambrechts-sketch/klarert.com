export default function Loading() {
  return (
    <main
      className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 sm:px-7 sm:pt-[26px]"
      aria-busy="true"
      aria-label="Loading Home"
    >
      <div className="border-line mb-2 flex flex-col gap-2 border-b pb-[18px]">
        <div className="bg-soft h-4 w-40 animate-pulse rounded" />
        <div className="bg-soft h-8 w-2/3 animate-pulse rounded" />
        <div className="bg-soft h-5 w-1/2 animate-pulse rounded" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-soft h-[118px] animate-pulse rounded-lg" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-soft h-64 animate-pulse rounded-lg" />
        ))}
      </div>
    </main>
  );
}
