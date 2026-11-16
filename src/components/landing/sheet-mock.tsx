// A small, static picture of a sheet for the product site, drawn with the app's own tokens (docs/05 §6): real
// HTML and CSS, no screenshot, hidden from assistive technology (the words around it say what it shows).
// The rows are illustrative only.

type Tint = 'green' | 'blue' | 'red' | 'grey';
type Row = {
  id: string;
  name: string;
  owner: string;
  status: { label: string; tint: Tint; mark?: string };
  due: string;
};

const ROWS: Row[] = [
  {
    id: 'R-001',
    name: 'Laptop lost or stolen',
    owner: 'AL',
    status: { label: 'Done', tint: 'green', mark: '✓' },
    due: '11 Nov 2026',
  },
  {
    id: 'R-002',
    name: 'Supplier outage',
    owner: 'GH',
    status: { label: 'In treatment', tint: 'blue' },
    due: '4 Dec 2026',
  },
  {
    id: 'R-003',
    name: 'Phishing email',
    owner: 'MK',
    status: { label: 'Needs review', tint: 'red', mark: '!' },
    due: '20 Nov 2026',
  },
  {
    id: 'R-004',
    name: 'Backups not tested',
    owner: 'AL',
    status: { label: 'Not started', tint: 'grey' },
    due: '15 Jan 2027',
  },
];

// full class names, so Tailwind sees them
const TINT: Record<Tint, string> = {
  green: 'bg-(--tint-green-bg) border-(--tint-green-line) text-(--tint-green-ink)',
  blue: 'bg-(--tint-blue-bg) border-(--tint-blue-line) text-(--tint-blue-ink)',
  red: 'bg-(--tint-red-bg) border-(--tint-red-line) text-(--tint-red-ink)',
  grey: 'bg-(--tint-grey-bg) border-(--tint-grey-line) text-(--tint-grey-ink)',
};

const COLS =
  'grid grid-cols-[64px_minmax(0,1fr)_112px] sm:grid-cols-[64px_minmax(0,1fr)_32px_120px_108px]';

export function SheetMock() {
  return (
    <div
      aria-hidden="true"
      className="bg-card border-line w-full overflow-hidden rounded-lg border"
    >
      <div className="border-line flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-full bg-(--label-blue)" />
          <span className="text-label-14 truncate font-semibold">Risk register</span>
        </div>
        <span className="text-muted-foreground text-label-12-mono shrink-0">4 items</span>
      </div>
      <div className={`${COLS} bg-subtle border-line text-muted-foreground text-label-12 border-b`}>
        <span className="px-3 py-2">ID</span>
        <span className="px-3 py-2">Risk</span>
        <span className="hidden px-1 py-2 sm:block">
          <span className="sr-only">Owner</span>
        </span>
        <span className="px-3 py-2">Status</span>
        <span className="hidden px-3 py-2 sm:block">Due</span>
      </div>
      <ul className="m-0 list-none p-0">
        {ROWS.map((row) => (
          <li key={row.id} className={`${COLS} border-line items-center border-b last:border-b-0`}>
            <span className="text-muted-foreground text-label-12-mono px-3 py-2.5">{row.id}</span>
            <span className="text-label-13 truncate px-3 py-2.5">{row.name}</span>
            <span className="hidden px-1 sm:block">
              <span className="bg-soft text-label-9.5 flex size-6 items-center justify-center rounded-full font-semibold">
                {row.owner}
              </span>
            </span>
            <span className="px-2 py-1.5">
              <span
                className={`${TINT[row.status.tint]} text-label-12 flex items-center justify-center gap-1 truncate rounded-md border px-2 py-1 font-medium`}
              >
                {row.status.mark ? <span>{row.status.mark}</span> : null}
                {row.status.label}
              </span>
            </span>
            <span className="text-label-12.5 hidden px-3 py-2.5 whitespace-nowrap sm:block">
              {row.due}
            </span>
          </li>
        ))}
      </ul>
      <div className="border-line bg-subtle flex items-center gap-2 border-t px-4 py-2.5">
        <span className="text-good text-label-12 font-medium">✓ Audit trail intact</span>
        <span className="text-muted-foreground text-label-11-mono truncate">sha256 3f9a…c21e</span>
      </div>
    </div>
  );
}
