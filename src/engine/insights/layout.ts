// Editing an Insights layout: rows, column plans, widths, moves and the widgets themselves. Every change returns a
// new layout or a plain-language reason it cannot be made (a full row, too many rows); the limits are config.ts's.
// Pure: ids come from the injected `newId`.
import {
  MAX_ROWS,
  MAX_WIDGETS_PER_ROW,
  SPAN_VALUES,
  rowWidth,
  type InsightRow,
  type InsightsLayout,
  type InsightWidget,
  type RowHeight,
  type Span,
} from './config';
import { widgetDef } from './registry';

export type Edit = { ok: true; layout: InsightsLayout } | { ok: false; error: string };

const ok = (layout: InsightsLayout): Edit => ({ ok: true, layout });
const no = (error: string): Edit => ({ ok: false, error });

export const ROWS_FULL = `A layout holds at most ${MAX_ROWS} rows.`;
export const ROW_FULL = 'There is no room in this row. Narrow or remove a widget first.';

const mapRow = (l: InsightsLayout, rowId: string, f: (r: InsightRow) => InsightRow) => ({
  rows: l.rows.map((r) => (r.id === rowId ? f(r) : r)),
});

/** Where a widget is: its row index and its index in the row. */
export function locate(l: InsightsLayout, widgetId: string): { row: number; index: number } | null {
  for (let row = 0; row < l.rows.length; row += 1) {
    const index = l.rows[row]!.widgets.findIndex((w) => w.id === widgetId);
    if (index >= 0) return { row, index };
  }
  return null;
}

/** Twelfths of the row no widget takes. */
export const freeSpan = (r: InsightRow) => 12 - rowWidth(r.widgets);

/** Whether a row can take one more widget of this width. */
export const fits = (r: InsightRow, span: number) =>
  r.widgets.length < MAX_WIDGETS_PER_ROW && rowWidth(r.widgets) + span <= 12;

/**
 * The empty places of a row in edit mode, as widths: the rest of its column plan, else whatever room is left
 * (nothing when the row is full).
 */
export function openSlots(r: InsightRow): Span[] {
  if (r.widgets.length >= MAX_WIDGETS_PER_ROW) return [];
  const free = freeSpan(r);
  if (free <= 0) return [];
  const planned = (r.layout ?? []).slice(r.widgets.length);
  const out: Span[] = [];
  let left = free;
  for (const s of planned)
    if (s <= left && r.widgets.length + out.length < MAX_WIDGETS_PER_ROW) {
      out.push(s);
      left -= s;
    }
  if (out.length) return out;
  return [largestSpanWithin(free)];
}

/** The widest allowed span not wider than `n` (at least the narrowest). */
export const largestSpanWithin = (n: number): Span =>
  [...SPAN_VALUES].reverse().find((s) => s <= n) ?? SPAN_VALUES[0]!;

export function addRow(
  l: InsightsLayout,
  plan: readonly Span[] | null,
  newId: (p: string) => string,
): Edit {
  if (l.rows.length >= MAX_ROWS) return no(ROWS_FULL);
  const row: InsightRow = { id: newId('r'), height: 'm', widgets: [] };
  if (plan?.length) row.layout = [...plan];
  return ok({ rows: [...l.rows, row] });
}

export const removeRow = (l: InsightsLayout, rowId: string): Edit =>
  ok({ rows: l.rows.filter((r) => r.id !== rowId) });

export function moveRow(l: InsightsLayout, rowId: string, by: -1 | 1): Edit {
  const i = l.rows.findIndex((r) => r.id === rowId);
  const j = i + by;
  if (i < 0 || j < 0 || j >= l.rows.length) return ok(l);
  const rows = [...l.rows];
  [rows[i], rows[j]] = [rows[j]!, rows[i]!];
  return ok({ rows });
}

export const setRowHeight = (l: InsightsLayout, rowId: string, height: RowHeight): Edit =>
  ok(mapRow(l, rowId, (r) => ({ ...r, height })));

/** Apply a column plan: widget i takes width i. A row with more widgets than the plan has columns is refused. */
export function setRowLayout(l: InsightsLayout, rowId: string, plan: readonly Span[]): Edit {
  const row = l.rows.find((r) => r.id === rowId);
  if (!row) return ok(l);
  if (row.widgets.length > plan.length)
    return no(
      `This row has ${row.widgets.length} widgets. Remove or move ${row.widgets.length - plan.length} first.`,
    );
  return ok(
    mapRow(l, rowId, (r) => ({
      ...r,
      layout: [...plan],
      widgets: r.widgets.map((w, i) => ({ ...w, span: plan[i]! })),
    })),
  );
}

/** Give a widget another width, if the row has the room. */
export function setSpan(l: InsightsLayout, widgetId: string, span: Span): Edit {
  const at = locate(l, widgetId);
  if (!at) return ok(l);
  const row = l.rows[at.row]!;
  const w = row.widgets[at.index]!;
  if (rowWidth(row.widgets) - w.span + span > 12) return no(ROW_FULL);
  return ok(
    mapRow(l, row.id, (r) => ({
      ...r,
      layout: undefined,
      widgets: r.widgets.map((x) => (x.id === widgetId ? { ...x, span } : x)),
    })),
  );
}

/** One width step narrower (-1) or wider (+1): 1/4, 1/3, 1/2, 2/3, 3/4, Full. */
export function stepSpan(l: InsightsLayout, widgetId: string, by: -1 | 1): Edit {
  const at = locate(l, widgetId);
  if (!at) return ok(l);
  const w = l.rows[at.row]!.widgets[at.index]!;
  const next =
    by > 0
      ? SPAN_VALUES.find((s) => s > w.span)
      : [...SPAN_VALUES].reverse().find((s) => s < w.span);
  return next ? setSpan(l, widgetId, next) : ok(l);
}

/** Swap with the neighbour on the left (-1) or right (+1). */
export function moveWithinRow(l: InsightsLayout, widgetId: string, by: -1 | 1): Edit {
  const at = locate(l, widgetId);
  if (!at) return ok(l);
  const row = l.rows[at.row]!;
  const j = at.index + by;
  if (j < 0 || j >= row.widgets.length) return ok(l);
  const widgets = [...row.widgets];
  [widgets[at.index], widgets[j]] = [widgets[j]!, widgets[at.index]!];
  return ok(mapRow(l, row.id, (r) => ({ ...r, widgets })));
}

/**
 * Move a widget into another row at `index` (the end by default; drag and drop and "Move to row above/below"). A
 * move below the last row starts a new row. Refused when the target row has no room.
 */
export function moveToRow(
  l: InsightsLayout,
  widgetId: string,
  targetRowId: string | null,
  index: number | null,
  newId: (p: string) => string,
): Edit {
  const at = locate(l, widgetId);
  if (!at) return ok(l);
  const from = l.rows[at.row]!;
  const w = from.widgets[at.index]!;
  if (targetRowId === from.id) {
    const widgets = from.widgets.filter((x) => x.id !== widgetId);
    widgets.splice(Math.min(index ?? widgets.length, widgets.length), 0, w);
    return ok(mapRow(l, from.id, (r) => ({ ...r, widgets })));
  }
  let rows = l.rows.map((r) =>
    r.id === from.id ? { ...r, widgets: r.widgets.filter((x) => x.id !== widgetId) } : r,
  );
  if (targetRowId === null) {
    if (rows.length >= MAX_ROWS) return no(ROWS_FULL);
    rows = [...rows, { id: newId('r'), height: from.height ?? 'm', widgets: [w] }];
    return ok({ rows });
  }
  const target = rows.find((r) => r.id === targetRowId);
  if (!target) return ok(l);
  if (!fits(target, w.span)) return no(ROW_FULL);
  return ok({
    rows: rows.map((r) => {
      if (r.id !== targetRowId) return r;
      const widgets = [...r.widgets];
      widgets.splice(Math.min(index ?? widgets.length, widgets.length), 0, w);
      return { ...r, widgets };
    }),
  });
}

/** "Move to row above" (-1) or "below" (+1): to the end of that row; below the last row a new row starts. */
export function moveToAdjacentRow(
  l: InsightsLayout,
  widgetId: string,
  by: -1 | 1,
  newId: (p: string) => string,
): Edit {
  const at = locate(l, widgetId);
  if (!at) return ok(l);
  const j = at.row + by;
  if (j < 0) return ok(l);
  return moveToRow(l, widgetId, l.rows[j]?.id ?? null, null, newId);
}

export const removeWidget = (l: InsightsLayout, widgetId: string): Edit =>
  ok({ rows: l.rows.map((r) => ({ ...r, widgets: r.widgets.filter((w) => w.id !== widgetId) })) });

/** A copy right after the widget; refused when the row has no room for it. */
export function duplicateWidget(
  l: InsightsLayout,
  widgetId: string,
  newId: (p: string) => string,
): Edit {
  const at = locate(l, widgetId);
  if (!at) return ok(l);
  const row = l.rows[at.row]!;
  const w = row.widgets[at.index]!;
  if (!fits(row, w.span)) return no(ROW_FULL);
  const widgets = [...row.widgets];
  widgets.splice(at.index + 1, 0, { ...structuredClone(w), id: newId('w') });
  return ok(mapRow(l, row.id, (r) => ({ ...r, widgets })));
}

/** Add a widget to a row, or as a new row when `rowId` is null. */
export function addWidget(
  l: InsightsLayout,
  rowId: string | null,
  w: InsightWidget,
  newId: (p: string) => string,
): Edit {
  if (rowId === null) {
    if (l.rows.length >= MAX_ROWS) return no(ROWS_FULL);
    return ok({
      rows: [...l.rows, { id: newId('r'), height: widgetDef(w.type).rowHeight, widgets: [w] }],
    });
  }
  const row = l.rows.find((r) => r.id === rowId);
  if (!row) return addWidget(l, null, w, newId);
  if (!fits(row, w.span)) return no(ROW_FULL);
  return ok(mapRow(l, rowId, (r) => ({ ...r, widgets: [...r.widgets, w] })));
}

/** Put an edited widget back in its place; refused when its new width no longer fits the row. */
export function replaceWidget(l: InsightsLayout, w: InsightWidget): Edit {
  const at = locate(l, w.id);
  if (!at) return ok(l);
  const row = l.rows[at.row]!;
  const old = row.widgets[at.index]!;
  if (rowWidth(row.widgets) - old.span + w.span > 12) return no(ROW_FULL);
  return ok(
    mapRow(l, row.id, (r) => ({ ...r, widgets: r.widgets.map((x) => (x.id === w.id ? w : x)) })),
  );
}

/**
 * Where "Add widget" puts a new widget when no row is named (the toolbar): into the last row if it has room, else a
 * new row. Returns the row id (null = new row) and the width the widget should take.
 */
export function placeForNew(l: InsightsLayout): { rowId: string | null; span: Span } {
  const last = l.rows[l.rows.length - 1];
  if (last) {
    const slot = openSlots(last)[0];
    if (slot) return { rowId: last.id, span: slot };
  }
  return { rowId: null, span: 6 };
}
