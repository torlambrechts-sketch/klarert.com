// The Grid's row layout (docs/05 §3.2): per group a header row, a column header row, the items, "+ Add item" and a
// summary row. Pure: data in, rows out, so it is unit-tested and the component only renders.
import type { GridColumn } from '@/engine/clipboard';
import { keyBetween } from '@/engine/ordering';
import type { Field, Group, Item } from '@/engine/types';

export type GridRow =
  | { kind: 'group'; key: string; group: Group; count: number; collapsed: boolean }
  | { kind: 'header'; key: string; group: Group }
  | { kind: 'item'; key: string; group: Group; item: Item; index: number }
  | { kind: 'add'; key: string; group: Group }
  | { kind: 'summary'; key: string; group: Group; items: Item[] }
  | { kind: 'gap'; key: string };

export const ROW_HEIGHT: Record<GridRow['kind'], number> = {
  group: 44,
  header: 34,
  item: 36,
  add: 36,
  summary: 34,
  gap: 18,
};

export interface Layout {
  rows: GridRow[];
  /** Items in display order across groups: the row axis of selection, copy and paste. */
  flat: Item[];
  /** item id → index in `flat`. */
  index: Map<string, number>;
  /** group id → its items in display order. */
  byGroup: Map<string, Item[]>;
}

const byPosition = (a: Item, b: Item) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : 1;

export function buildLayout(input: {
  groups: Group[];
  items: Item[];
  collapsed: ReadonlySet<string>;
  /** Sort within groups (column menu); position order otherwise. */
  compare?: ((a: Item, b: Item) => number) | null;
  /** Editors get the "+ Add item" row. */
  canAdd: boolean;
  /** Only these groups (second panel filter). */
  onlyGroup?: string | null;
}): Layout {
  const byGroup = new Map<string, Item[]>(input.groups.map((g) => [g.id, []]));
  for (const it of input.items) byGroup.get(it.groupId)?.push(it);
  for (const list of byGroup.values()) list.sort(input.compare ?? byPosition);

  const rows: GridRow[] = [];
  const flat: Item[] = [];
  const groups = input.onlyGroup
    ? input.groups.filter((g) => g.id === input.onlyGroup)
    : input.groups;
  for (const group of groups) {
    const items = byGroup.get(group.id) ?? [];
    const collapsed = input.collapsed.has(group.id);
    rows.push({ kind: 'group', key: `g:${group.id}`, group, count: items.length, collapsed });
    if (!collapsed) {
      rows.push({ kind: 'header', key: `h:${group.id}`, group });
      for (const item of items) {
        rows.push({ kind: 'item', key: `i:${item.id}`, group, item, index: flat.length });
        flat.push(item);
      }
      if (input.canAdd) rows.push({ kind: 'add', key: `a:${group.id}`, group });
      rows.push({ kind: 'summary', key: `s:${group.id}`, group, items });
    }
    rows.push({ kind: 'gap', key: `x:${group.id}` });
  }
  return { rows, flat, index: new Map(flat.map((it, i) => [it.id, i])), byGroup };
}

/** Grid columns: the name, then the fields not hidden, in field order. */
export function gridColumns(fields: Field[], hidden: ReadonlySet<string>): GridColumn[] {
  return [
    { kind: 'name' },
    ...fields.filter((f) => !hidden.has(f.id)).map((field) => ({ kind: 'field' as const, field })),
  ];
}

export const columnId = (c: GridColumn) => (c.kind === 'name' ? 'name' : c.field.id);

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
