export default function Loading() {
  return (
    <main
      className="flex w-full flex-col gap-5 px-4 pt-5 pb-8 sm:px-[28px] sm:pt-[26px]"
      aria-busy="true"
      aria-label="Loading audit outputs"
    >
      <div className="bg-soft h-8 w-64 max-w-full animate-pulse rounded" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-soft h-[140px] animate-pulse rounded-lg" />
      ))}
    </main>
  );
}
