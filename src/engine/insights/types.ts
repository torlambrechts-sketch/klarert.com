// Render models of the Insights widgets and the contract of a widget type. A widget type computes a model from data;
// the UI draws a model by its `kind`, never by widget type (CLAUDE.md rules 1 and 9). Pure data.
import type { LabelOption } from '../fields/types';
import type { Aggregation, InsightFilter, InsightWidget, InsightWidgetType } from './config';
import type { InsightsData, InsightSource, Slice } from './source';

/** Where a click on a bar, segment or legend entry leads: the Table of the view's own sheet, filtered. */
export interface SliceFilter {
  fieldKey: string;
  key: string;
}

export interface FigureModel {
  kind: 'figure';
  value: number;
  display: string;
  caption: string;
  /** A count of overdue items above zero: shown in the critical colour, the title says why. */
  alert: boolean;
}

export interface BarsModel {
  kind: 'bars';
  fieldName: string;
  slices: Slice[];
  /** Largest value, the bars' full length. */
  max: number;
  /** Bars filter the Table when the source is this sheet. */
  filterable: boolean;
  fieldKey: string;
}

export interface DonutModel {
  kind: 'donut';
  fieldName: string;
  fieldKey: string;
  slices: (Slice & { percent: number })[];
  total: number;
  totalDisplay: string;
  /** "items" for a count, "total" for a sum or an average. */
  caption: string;
  filterable: boolean;
}

export interface ColumnsModel {
  kind: 'columns';
  fieldName: string;
  /** Months that have items, oldest first: key "2026-11", label "Nov 26". */
  columns: { key: string; label: string; name: string; value: number }[];
  max: number;
}

export interface ProgressModel {
  kind: 'progress';
  percent: number;
  done: number;
  total: number;
  fieldName: string;
  segments: {
    key: string;
    label: string;
    value: number;
    color: LabelOption['color'];
    option: LabelOption;
  }[];
}

export interface ListCell {
  text: string;
  /** A single option: its dot colour and marks. */
  option?: LabelOption;
}

export interface ListModel {
  kind: 'list';
  columns: { key: string; name: string }[];
  rows: { itemId: string; displayId: string; name: string; cells: ListCell[] }[];
  /** Items past the shown rows. */
  more: number;
  /** Rows open the item in this sheet's panel; otherwise they link to the other sheet. */
  sheetId: string;
  current: boolean;
}

export interface NoteModel {
  kind: 'note';
  text: string;
}

/** The widget cannot show anything yet: a missing field, no data. Said in plain words. */
export interface MessageModel {
  kind: 'message';
  message: string;
}

/** The source sheet no longer exists or the person cannot read it. */
export interface UnavailableModel {
  kind: 'unavailable';
}

/** Another sheet's data is still loading. */
export interface LoadingModel {
  kind: 'loading';
}

export type InsightModel =
  | FigureModel
  | BarsModel
  | DonutModel
  | ColumnsModel
  | ProgressModel
  | ListModel
  | NoteModel
  | MessageModel
  | UnavailableModel
  | LoadingModel;

/** The settings a widget type's editor shows, as data (the dialog reads these, not the type id). */
export interface EditorSpec {
  /** Choose the source sheet. */
  source: boolean;
  /** Choose which items count. */
  filter: boolean;
  /** Choose count, sum or average. */
  aggregation: boolean;
  /** Choose the group-by field. */
  groupBy: boolean;
  /** Choose the date field: always, only with a dated filter, or never. */
  date: 'always' | 'filtered' | false;
  /** The "top N" control: its label and choices (0 = all). */
  top: { label: string; choices: { value: number; label: string }[]; fallback: number } | null;
  /** Choose up to three fields shown after the name. */
  columns: boolean;
  /** A plain-text body. */
  text: boolean;
  /** A line under the type picker explaining what the widget shows. */
  hint?(w: InsightWidget, s: InsightSource): string;
}

export interface InsightWidgetDef {
  id: InsightWidgetType;
  /** The name in the type picker: "Number", "Bar list" … */
  label: string;
  /** The title a widget gets when it has none of its own. */
  autoTitle(w: InsightWidget, s: InsightSource | undefined): string;
  /** The line under the title names the widget's filter (KPIs and lists say it in their title). */
  showsFilter: boolean;
  /** Draws no data (no source line, no source). */
  static?: boolean;
  /** The row height a new widget of this type asks for when it starts a row. */
  rowHeight: 's' | 'm';
  editor: EditorSpec;
  compute(w: InsightWidget, s: InsightSource): InsightModel;
}

export type { Aggregation, InsightFilter, InsightsData };
