// The Table view's row model (docs/05 §3.1): each group is a card: its title row, its own column header, the items,
// "+ Add" and, when a column shows its summary, a summary row; a gap separates the cards. Groups are flattened into
// one list so one virtualiser renders them all. Pure: data in, rows out, so it is unit-tested and the component only
// renders.
import type { GridColumn } from '@/engine/clipboard';
import { keyBetween } from '@/engine/ordering';
import { resolveFieldType } from '@/engine/fields/resolve';
import {
  arrangeFields,
  groupByKey,
  OTHER_GROUP,
  type ColumnGroup,
} from '@/engine/views/column-groups';
import type { Field, Group, Item } from '@/engine/types';
import type { SortRule } from '@/engine/views/config';

export type TableRow =
  | { kind: 'group'; key: string; group: Group; count: number; collapsed: boolean }
  | { kind: 'header'; key: string; group: Group }
  | { kind: 'item'; key: string; group: Group; item: Item; index: number }
  | { kind: 'add'; key: string; group: Group }
  | { kind: 'summary'; key: string; group: Group; items: Item[] }
  | { kind: 'gap'; key: string }
  // sub-items under an expanded parent (docs/05 §3.1): their column header, the rows, the empty note, "+ Add"
  | { kind: 'subheader'; key: string; group: Group; parent: Item }
  | {
      kind: 'subitem';
      key: string;
      group: Group;
      parent: Item;
      item: Item;
      /** Index among the parent's visible sub-items. */
      index: number;
      last: boolean;
      /** A search or filter matched this sub-item (its parent opened for it). */
      match: boolean;
    }
  | { kind: 'subempty'; key: string; group: Group; parent: Item }
  | { kind: 'subadd'; key: string; group: Group; parent: Item };

export type SubRow = Extract<TableRow, { kind: 'subitem' }>;

export type Density = 'comfortable' | 'compact';

/** The slim line of column group labels above a card's column names (sheets with column groups). */
export const GROUP_LABEL_H = 28;

/**
 * Row heights of the table (two-line item rows: the name, then the id and owner). `groupLabels`: the column header
 * carries the group label line.
 */
export function rowHeight(
  kind: TableRow['kind'],
  density: Density = 'comfortable',
  groupLabels = false,
): number {
  switch (kind) {
    case 'group':
      // 48 and the card's top border
      return 49;
    case 'header':
      return 34 + (groupLabels ? GROUP_LABEL_H : 0);
    case 'item':
      return density === 'compact' ? 40 : 52;
    case 'add':
      return density === 'compact' ? 36 : 44;
    case 'summary':
      return 38;
    case 'gap':
      return 24;
    case 'subheader':
      return 28;
    case 'subitem':
      return density === 'compact' ? 36 : 44;
    case 'subempty':
    case 'subadd':
      return density === 'compact' ? 32 : 36;
  }
}

/** Sub-item rows draw their own bottom line, like item rows. */
export const ownLine = (kind: TableRow['kind']) =>
  kind === 'item' || kind === 'header' || kind === 'subitem' || kind === 'subheader';

/** The last row of a group's card (it carries the card's bottom edge). */
export const endsCard = (rows: TableRow[], i: number) => {
  const next = rows[i + 1];
  return rows[i]!.kind !== 'gap' && (!next || next.kind === 'gap');
};

/**
 * The sticky column header of each group card (docs/05 §3.1): for every row, the index of its card's column header
 * row (-1 before it or in a card without one), and for every header, the index of its card's last row. The Table
 * keeps the header of the card under the top bar rendered and pins it there until the card's end pushes it up.
 */
export function stickyHeaders(rows: TableRow[]): {
  headerOf: Int32Array;
  cardEnd: Map<number, number>;
} {
  const headerOf = new Int32Array(rows.length).fill(-1);
  const cardEnd = new Map<number, number>();
  let header = -1;
  rows.forEach((row, i) => {
    if (row.kind === 'gap' || row.kind === 'group') header = -1;
    if (row.kind === 'header') header = i;
    headerOf[i] = header;
    if (header >= 0 && endsCard(rows, i)) cardEnd.set(header, i);
  });
  return { headerOf, cardEnd };
}

/**
 * The width of the table's trailing column ("+" in the header, "…" in rows): the room the columns leave in the card,
 * at least `min`. Columns keep their widths (docs/05 §3.1); when they do not fit, the trailing column is `min` wide
 * and the table scrolls.
 */
export function trailWidth(
  widths: number[],
  fixed: number,
  available: number,
  min: number,
): number {
  const used = fixed + widths.reduce((a, b) => a + b, 0);
  return Math.max(min, available - used);
}

export interface Layout {
  rows: TableRow[];
  /** Items in display order across groups (collapsed groups left out): the row axis of selection and paste. */
  flat: Item[];
  /** item id → index in `flat`. */
  index: Map<string, number>;
  /** group id → its items in display order (collapsed groups too). */
  byGroup: Map<string, Item[]>;
  /** Sub-item rows in display order: their own keyboard axis, separate from selection and paste. */
  subs: SubRow[];
  /** sub-item id → index in `subs`. */
  subIndex: Map<string, number>;
}

/** What the layout needs to open parents (docs/05 §3.1): their sub-items and which are expanded. */
export interface SubitemLayout {
  childrenOf(parentId: string): Item[];
  expanded: ReadonlySet<string>;
  /** Parents a search or filter opened, with the sub-items that matched. */
  matched?: ReadonlyMap<string, ReadonlySet<string>>;
  /** Editors get "+ Add sub-item". */
  canAdd: boolean;
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
  /** Sub-items of the sheet, when it has them. */
  subitems?: SubitemLayout | null;
}): Layout {
  const byGroup = new Map<string, Item[]>(input.groups.map((g) => [g.id, []]));
  const groupOf = input.groupOf ?? ((it: Item) => it.groupId);
  for (const it of input.items) byGroup.get(groupOf(it))?.push(it);
  for (const list of byGroup.values()) list.sort(input.compare ?? byPosition);

  const rows: TableRow[] = [];
  const flat: Item[] = [];
  const subs: SubRow[] = [];
  const sub = input.subitems;
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
      const matched = sub?.matched?.get(item.id);
      if (!sub || (!sub.expanded.has(item.id) && !matched)) continue;
      const children = sub.childrenOf(item.id);
      if (children.length > 0)
        rows.push({ kind: 'subheader', key: `sh:${item.id}`, group, parent: item });
      else rows.push({ kind: 'subempty', key: `se:${item.id}`, group, parent: item });
      children.forEach((child, i) => {
        const row: SubRow = {
          kind: 'subitem',
          key: `si:${child.id}`,
          group,
          parent: item,
          item: child,
          index: i,
          last: i === children.length - 1,
          match: !!matched?.has(child.id),
        };
        rows.push(row);
        subs.push(row);
      });
      if (sub.canAdd) rows.push({ kind: 'subadd', key: `sa:${item.id}`, group, parent: item });
    }
    if (input.canAdd) rows.push({ kind: 'add', key: `a:${group.id}`, group });
    if (input.summaries && !empty)
      rows.push({ kind: 'summary', key: `s:${group.id}`, group, items });
  });
  return {
    rows,
    flat,
    index: new Map(flat.map((it, i) => [it.id, i])),
    byGroup,
    subs,
    subIndex: new Map(subs.map((r, i) => [r.item.id, i])),
  };
}

/**
 * Table columns: the name, then the fields not hidden, in field order. With column groups (docs/05 §3.1) each group's
 * columns sit together where its first field is, and a group the view collapsed is one narrow stub instead of its
 * columns.
 */
export function tableColumns(
  fields: Field[],
  hidden: ReadonlySet<string>,
  groups?: { list: readonly ColumnGroup[]; collapsed: ReadonlySet<string> },
): GridColumn[] {
  const list = groups?.list ?? [];
  if (list.length === 0)
    return [
      { kind: 'name' },
      ...fields
        .filter((f) => !hidden.has(f.id))
        .map((field) => ({ kind: 'field' as const, field })),
    ];
  const of = groupByKey(list);
  const out: GridColumn[] = [{ kind: 'name' }];
  const stubbed = new Set<string>();
  const arranged = arrangeFields(fields, list);
  for (const field of arranged) {
    const g = of.get(field.key);
    if (g && groups!.collapsed.has(g.id)) {
      if (stubbed.has(g.id)) continue;
      stubbed.add(g.id);
      out.push({
        kind: 'stub',
        groupId: g.id,
        name: g.name,
        fields: arranged.filter((f) => of.get(f.key)?.id === g.id),
      });
      continue;
    }
    if (!hidden.has(field.id)) out.push({ kind: 'field', field });
  }
  return out;
}

export const columnId = (c: GridColumn) =>
  c.kind === 'name' ? 'name' : c.kind === 'stub' ? `stub:${c.groupId}` : c.field.id;

/** A run of adjacent columns of one group (or of no group: "Other"), for the group label line. */
export interface ColumnRun {
  key: string;
  /** Null: the fields in no group. */
  groupId: string | null;
  name: string;
  /** Index of the run's first and last column among the columns after the name. */
  from: number;
  to: number;
  /** Fields of the group (all of them, shown or not). */
  size: number;
  collapsed: boolean;
}

/** The group label runs over the columns after the name; empty when the sheet has no column groups. */
export function columnRuns(columns: GridColumn[], groups: readonly ColumnGroup[]): ColumnRun[] {
  if (groups.length === 0) return [];
  const of = groupByKey(groups);
  const runs: ColumnRun[] = [];
  columns.slice(1).forEach((c, i) => {
    const g =
      c.kind === 'stub'
        ? (groups.find((x) => x.id === c.groupId) ?? null)
        : c.kind === 'field'
          ? (of.get(c.field.key) ?? null)
          : null;
    const id = g?.id ?? null;
    const last = runs.at(-1);
    if (last && last.groupId === id && !last.collapsed && c.kind !== 'stub') {
      last.to = i;
      return;
    }
    runs.push({
      key: `${id ?? OTHER_GROUP.id}:${i}`,
      groupId: id,
      name: g?.name ?? OTHER_GROUP.name,
      from: i,
      to: i,
      size: g ? g.fieldKeys.length : 0,
      collapsed: c.kind === 'stub',
    });
  });
  for (const r of runs) if (r.groupId === null) r.size = r.to - r.from + 1;
  return runs;
}

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

/**
 * Sort ▾ and the column headers (docs/18 §4): a click on a field sorts it ascending, the next descending, the third
 * takes it out. Other fields keep their place, so several levels stay possible.
 */
export function cycleSort(rules: readonly SortRule[], fieldKey: string): SortRule[] {
  const at = rules.findIndex((r) => r.fieldKey === fieldKey);
  if (at < 0) return [...rules, { fieldKey, dir: 'asc' }];
  if (rules[at]!.dir === 'asc')
    return rules.map((r, i) => (i === at ? { ...r, dir: 'desc' as const } : r));
  return rules.filter((_, i) => i !== at);
}

/**
 * Columns fill the card (owner decision 18 Nov 2026, docs/18 C2): when the card is wider than the columns, every
 * field column grows in proportion to its base width (its default or resized width) until the table fills it; the
 * fixed part (checkbox, name, "+" and "…") stays as it is. Columns never get narrower than their base; a narrower
 * card scrolls. Whole pixels; the rounding remainder goes to the last column so the right edge meets the card's.
 */
export function fillColumns(bases: readonly number[], fixed: number, available: number): number[] {
  const used = bases.reduce((a, b) => a + b, 0);
  const extra = available - fixed - used;
  if (extra <= 0 || used <= 0 || bases.length === 0) return [...bases];
  const out = bases.map((w) => Math.floor(w + (extra * w) / used));
  out[out.length - 1]! += available - fixed - out.reduce((a, b) => a + b, 0);
  return out;
}
