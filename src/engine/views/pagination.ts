// List view paging (docs/05 §3.1 footer: 25/50/100, "1–25 of 132", Prev/Next). Pure.

export interface Page {
  /** Zero-based page index, clamped to the pages that exist. */
  page: number;
  pages: number;
  /** Slice bounds into the filtered, sorted rows: [from, to). */
  from: number;
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
  /** "1–25 of 132", "0 of 0". */
  label: string;
}

export function paginate(total: number, pageSize: number, page: number): Page {
  const size = Math.max(1, Math.floor(pageSize));
  const count = Math.max(0, Math.floor(total));
  const pages = Math.max(1, Math.ceil(count / size));
  const p = Math.min(Math.max(0, Math.floor(page)), pages - 1);
  const from = p * size;
  const to = Math.min(count, from + size);
  const n = (x: number) => x.toLocaleString('en-GB');
  return {
    page: p,
    pages,
    from,
    to,
    hasPrev: p > 0,
    hasNext: p < pages - 1,
    label: count === 0 ? '0 of 0' : `${n(from + 1)}–${n(to)} of ${n(count)}`,
  };
}

/** The page that shows the row at `index` (keep the open item visible after a page size change). */
export const pageOf = (index: number, pageSize: number) =>
  Math.max(0, Math.floor(index / Math.max(1, pageSize)));
