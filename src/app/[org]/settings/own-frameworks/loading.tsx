// Loading a framework of the workspace's own: the page's shape, so nothing shifts when it arrives.
export default function Loading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading the framework"
      className="flex w-full flex-col gap-5 px-4 pt-5 pb-8 [--hero-gap:20px] sm:px-12 sm:pt-[26px]"
    >
      <div className="bg-soft h-8 w-64 animate-pulse rounded" />
      <div className="bg-soft h-40 animate-pulse rounded-lg" />
      <div className="bg-soft h-96 animate-pulse rounded-lg" />
    </main>
  );
}
