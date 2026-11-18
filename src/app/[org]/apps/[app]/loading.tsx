export default function Loading() {
  return (
    <main
      className="flex w-full flex-col gap-4 px-4 pt-5 pb-8 sm:px-12"
      aria-busy="true"
      aria-label="Loading the app"
    >
      <div className="bg-soft h-4 w-24 animate-pulse rounded" />
      <div className="bg-soft h-10 w-full max-w-[560px] animate-pulse rounded" />
      <div className="bg-soft h-8 w-48 animate-pulse rounded" />
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-soft h-14 animate-pulse rounded" />
        ))}
      </div>
    </main>
  );
}
