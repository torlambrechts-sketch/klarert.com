import { Button } from '@/components/ui/button';

// Loading and error states of the automation screens (docs/05 §7).

export function ListSkeleton() {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-busy="true" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <li key={i} className="border-line bg-surface h-[76px] animate-pulse rounded-lg border" />
      ))}
    </ul>
  );
}

export function ErrorBox({ text, retry }: { text: string; retry(): void }) {
  return (
    <div
      role="alert"
      className="border-line bg-surface flex flex-col items-start gap-2 rounded-lg border p-4"
    >
      <p className="m-0 font-semibold">{text}</p>
      <Button type="button" variant="outline" onClick={retry}>
        Retry
      </Button>
    </div>
  );
}
