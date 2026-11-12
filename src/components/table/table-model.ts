// The Table view's row model (docs/05 §3.1): each group is a card: its title row, its own column header, the items,
// "+ Add" and, when a column shows its summary, a summary row; a gap separates the cards. Groups are flattened into
// one list so one virtualiser renders them all. Pure: data in, rows out, so it is unit-tested and the component only
// renders.
import type { GridColumn } from '@/engine/clipboard';
import { keyBetween } from '@/engine/ordering';
import { resolveFieldType } from '@/engine/fields/resolve';
import type { Field, Group, Item } from '@/engine/types';

export type TableRow =
  | { kind: 'group'; key: string; group: Group; count: number; collapsed: boolean }
  | { kind: 'header'; key: string; group: Group }
  | { kind: 'item'; key: string; group: Group; item: Item; index: number }
  | { kind: 'add'; key: string; group: Group }
  | { kind: 'summary'; key: string; group: Group; items: Item[] }
  | { kind: 'gap'; key: string };

export type Density = 'comfortable' | 'compact';

/** Row heights of the table (two-line item rows: the name, then the id and owner). */
export function rowHeight(kind: TableRow['kind'], density: Density = 'comfortable'): number {
  switch (kind) {
    case 'group':
      return 48;
    case 'header':
      return 34;
    case 'item':
      return density === 'compact' ? 40 : 52;
    case 'add':
      return density === 'compact' ? 36 : 44;
    case 'summary':
      return 38;
    case 'gap':
      return 24;
  }
}

/** The last row of a group's card (it carries the card's bottom edge). */
export const endsCard = (rows: TableRow[], i: number) => {
  const next = rows[i + 1];
  return rows[i]!.kind !== 'gap' && (!next || next.kind === 'gap');
};

/**
 * Column widths that fill the table: when the columns are narrower than `available`, the leftover space is shared
 * across them in proportion to their widths; wider tables keep their widths (and scroll).
 */
export function fitWidths(widths: number[], fixed: number, available: number): number[] {
  const total = widths.reduce((a, b) => a + b, 0);
  const room = available - fixed - total;
  if (room <= 0 || total === 0) return widths;
  let given = 0;
  return widths.map((w, i) => {
    if (i === widths.length - 1) return w + (room - given);
    const extra = Math.floor((room * w) / total);
    given += extra;
    return w + extra;
  });
}

export interface Layout {
  rows: TableRow[];
  /** Items in display order across groups (collapsed groups left out): the row axis of selection and paste. */
  flat: Item[];
  /** item id → index in `flat`. */
  index: Map<string, number>;
  /** group id → its items in display order (collapsed groups too). */
  byGroup: Map<string, Item[]>;
}

export const byPosition = (a: Item, b: Item) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : 1;

export function buildLayout(input: {
  groups: Group[];
  items: Item[];
  collapsed: ReadonlySet<string>;
  /** Sort within groups (the view's sort); position order otherwise. */
  compare?: ((a: Item, b: Item) => number) | null;
  /** Editors get the "+ Add" row. */
  canAdd: boolean;
  /** A summary row per open group: on when at least one column shows its summary. */
  summaries?: boolean;
  /** A column header row in each open group (the Table; phone cards have none). Default true. */
  headers?: boolean;
  /** Only these groups (second panel filter). */
  onlyGroup?: string | null;
  /** The group an item sits in; default its own group (virtual "group by" groups pass their lookup). */
  groupOf?: (item: Item) => string;
}): Layout {
  const byGroup = new Map<string, Item[]>(input.groups.map((g) => [g.id, []]));
  const groupOf = input.groupOf ?? ((it: Item) => it.groupId);
  for (const it of input.items) byGroup.get(groupOf(it))?.push(it);
  for (const list of byGroup.values()) list.sort(input.compare ?? byPosition);

  const rows: TableRow[] = [];
  const flat: Item[] = [];
  const groups = input.onlyGroup
    ? input.groups.filter((g) => g.id === input.onlyGroup)
    : input.groups;
  // when every group is empty, the first keeps its column header (the columns stay visible and "+" stays reachable)
  const allEmpty = groups.every((g) => (byGroup.get(g.id) ?? []).length === 0);
  groups.forEach((group, gi) => {
    const items = byGroup.get(group.id) ?? [];
    const collapsed = input.collapsed.has(group.id);
    if (gi > 0) rows.push({ kind: 'gap', key: `x:${group.id}` });
    rows.push({ kind: 'group', key: `g:${group.id}`, group, count: items.length, collapsed });
    if (collapsed) return;
    // an empty group stays compact: its title and "+ Add" only (no column header, no summary)
    const empty = items.length === 0 && !(allEmpty && gi === 0);
    if (input.headers !== false && !empty)
      rows.push({ kind: 'header', key: `h:${group.id}`, group });
    for (const item of items) {
      rows.push({ kind: 'item', key: `i:${item.id}`, group, item, index: flat.length });
      flat.push(item);
    }
    if (input.canAdd) rows.push({ kind: 'add', key: `a:${group.id}`, group });
    if (input.summaries && !empty)
      rows.push({ kind: 'summary', key: `s:${group.id}`, group, items });
  });
  return { rows, flat, index: new Map(flat.map((it, i) => [it.id, i])), byGroup };
}

/** Table columns: the name, then the fields not hidden, in field order. */
export function tableColumns(fields: Field[], hidden: ReadonlySet<string>): GridColumn[] {
  return [
    { kind: 'name' },
    ...fields.filter((f) => !hidden.has(f.id)).map((field) => ({ kind: 'field' as const, field })),
  ];
}

export const columnId = (c: GridColumn) => (c.kind === 'name' ? 'name' : c.field.id);

/**
 * The values a phone card shows under the name, id and owner: the first `max` visible fields that hold values, in
 * field order, leaving out the owner field (already on the card).
 */
export function cardFields(
  fields: Field[],
  hidden: ReadonlySet<string>,
  ownerFieldId: string | null,
  max = 3,
): Field[] {
  return fields
    .filter(
      (f) =>
        !hidden.has(f.id) &&
        f.id !== ownerFieldId &&
        resolveFieldType(f.type)?.storage === 'values',
    )
    .slice(0, max);
}

/**
 * Position key for an item dropped into `list` (the target group's items in position order, without the dragged
 * item) at `index` (0 = top).
 */
export function positionAt(list: Item[], index: number): string {
  const i = Math.max(0, Math.min(index, list.length));
  return keyBetween(list[i - 1]?.position ?? null, list[i]?.position ?? null);
}

/** Position keys for several items appended to the end of a group, in order. */
export function positionsAtEnd(list: Item[], n: number): string[] {
  const out: string[] = [];
  let prev = list.at(-1)?.position ?? null;
  for (let i = 0; i < n; i += 1) {
    prev = keyBetween(prev, null);
    out.push(prev);
  }
  return out;
}

export interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Normalised rectangle between the anchor and the active cell (inclusive). */
export function rangeOf(a: { row: number; col: number }, b: { row: number; col: number }): Rect {
  return {
    top: Math.min(a.row, b.row),
    bottom: Math.max(a.row, b.row),
    left: Math.min(a.col, b.col),
    right: Math.max(a.col, b.col),
  };
}

/** Move a cell by a key; Tab wraps to the next or previous row. Null when the move leaves the grid. */
export function step(
  at: { row: number; col: number },
  key: 'up' | 'down' | 'left' | 'right' | 'tab' | 'shifttab',
  rows: number,
  cols: number,
): { row: number; col: number } | null {
  const clampRow = (r: number) => Math.max(0, Math.min(rows - 1, r));
  const clampCol = (c: number) => Math.max(0, Math.min(cols - 1, c));
  switch (key) {
    case 'up':
      return { row: clampRow(at.row - 1), col: at.col };
    case 'down':
      return { row: clampRow(at.row + 1), col: at.col };
    case 'left':
      return { row: at.row, col: clampCol(at.col - 1) };
    case 'right':
      return { row: at.row, col: clampCol(at.col + 1) };
    case 'tab':
      if (at.col < cols - 1) return { row: at.row, col: at.col + 1 };
      return at.row < rows - 1 ? { row: at.row + 1, col: 0 } : null;
    case 'shifttab':
      if (at.col > 0) return { row: at.row, col: at.col - 1 };
      return at.row > 0 ? { row: at.row - 1, col: cols - 1 } : null;
  }
}
