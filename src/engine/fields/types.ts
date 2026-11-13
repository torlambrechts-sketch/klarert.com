import type { z } from 'zod';
import type { Ctx, Field, Issue, Item, Json, TriggerId } from '../types';

export type ValueKind =
  | 'text'
  | 'number'
  | 'date'
  | 'daterange'
  | 'option'
  | 'ordered'
  | 'multi'
  | 'people'
  | 'boolean'
  | 'link'
  | 'file'
  | 'signature'
  | 'none';

export type Family = 'basic' | 'choice' | 'compliance' | 'computed';
export type Storage = 'values' | 'links' | 'files' | 'protected' | 'computed' | 'none';

/** One option of a label type (docs/03 §2). */
export interface LabelOption {
  id: string;
  label: string;
  color: string;
  done?: boolean;
}

/**
 * The contract every field type implements (docs/03 §1). One file per type in this folder; nothing outside
 * src/engine/fields may branch on a field type id.
 */
export interface FieldTypeDef<V = unknown, C = unknown> {
  id: string;
  label: string;
  family: Family;
  description: string;
  storage: Storage;
  kind: ValueKind;
  valueSchema: z.ZodType<V>;
  configSchema: z.ZodType<C>;
  defaultConfig(): C;
  defaultWidth: number;
  formAllowed: boolean;
  kanbanCapable: boolean;
  calendarCapable: boolean;
  triggers: TriggerId[];

  /** From editor, paste, CSV or automation. null = empty or not convertible. */
  normalize(input: unknown, cfg: C, ctx: Ctx): V | null;
  /** Paste from Excel/Sheets and CSV import. */
  parseText(text: string, cfg: C, ctx: Ctx): V | null;
  /** Type-specific rules only; generic validation lives in ../validation. */
  validate(v: V | null, field: Field<C>, item: Item, ctx: Ctx): Issue[];
  /** Computed types: derive the value from the item and the world. */
  compute?(item: Item, field: Field<C>, ctx: Ctx): V | null;
  isEmpty(v: V | null): boolean;
  isDone?(v: V | null, cfg: C): boolean;
  toText(v: V | null, cfg: C, ctx: Ctx): string;
  toNumber(v: V | null, cfg: C, ctx: Ctx): number | null;
  /** ISO date (YYYY-MM-DD). */
  toDate(v: V | null, cfg: C, ctx: Ctx): string | null;
  /** Sort order; empty values always last. */
  compare(a: V | null, b: V | null, cfg: C, ctx: Ctx): number;
  /** Ordered kinds: rank of a value (higher = more severe/mature), for at_least/at_most. */
  rank?(v: V | null, cfg: C): number | null;
  /** Option-like kinds: the options a picker, filter or kanban shows. */
  options?(cfg: C, ctx: Ctx): LabelOption[];
  /**
   * Label kinds whose options people define (status, dropdown, multiselect …): the config with one more option, made
   * from a typed label (trimmed, at most 80 characters, the next unused colour, id `opt_…` from `newId`). null when the
   * label is empty, too long or already an option (case-insensitive). Fixed lists have no hook.
   */
  addOption?(
    cfg: C,
    label: string,
    newId: (prefix: string) => string,
  ): { config: C; option: LabelOption } | null;
  /** Option-like kinds whose value is an object: the key filters compare (e.g. a site id). Default: the string value. */
  keyOf?(v: V | null, cfg: C): string | null;
  /** Kinds that depend on config (formula result type, lookup target). Default: `kind`. */
  effectiveKind?(field: Field<C>, ctx: Ctx): ValueKind;
  /** Types with the checklist_no trigger: how many answers are "No" (the trigger fires when it increases). */
  countNo?(v: V | null, cfg: C): number;
  /**
   * Date kinds: whether this field is set up as a deadline (a date shows "in 3 days" until the item is done). My work
   * and Home prefer such a field over other dates of the sheet, so "Found on" never reads as overdue.
   */
  isDeadline?(cfg: C): boolean;
  /**
   * Matrix kinds (risk matrix): the grid a dashboard heatmap draws. `cell` places a value (x along the columns, y up
   * the rows, both 1..size); `level` names the band of a cell, rank 1 (lowest) to 4 (highest).
   */
  matrix?: {
    axes: { x: string; y: string };
    size(cfg: C): number;
    cell(v: V | null): { x: number; y: number } | null;
    level(x: number, y: number, cfg: C): { rank: 1 | 2 | 3 | 4; label: string };
  };
  /**
   * Number kinds the Table can draw a trend line for (the value's history from the activity log, docs/05 §3.1):
   * whether a higher value is better, worse or neither for this config. null: no trend (e.g. a number without meter
   * bands). No hook: never.
   */
  trend?(cfg: C): { higherIs: 'better' | 'worse' | 'neutral' } | null;
  /** Number kinds: the default group-footer summary (docs/03 §8). Default `sum`. */
  defaultSummary?: 'sum' | 'average';
  /**
   * False for types a feature creates, not the add-field picker (the sub-items column comes with "Turn on
   * sub-items"). Default true.
   */
  addable?: boolean;
  /**
   * Link-like computed types: the items this field relates the item to (sub-items). Lookups, rollups and progress
   * read them as they read a link field's targets.
   */
  relatedIds?(item: Item, field: Field<C>, ctx: Ctx): string[];
  /**
   * Computed types: whether the value is derived from something the caller may not see (a restricted field, a sheet
   * without access, docs/02 §16). The app then shows "Restricted" instead of a value computed from what is missing.
   */
  readsHidden?(field: Field<C>, ctx: Ctx): boolean;
  /**
   * Server-side stamping of a value about to be written: who, when, hashes (signature). `values` are the item's
   * values after the rest of the change; `hash` is SHA-256 of a string, injected.
   */
  stamp?(
    v: V,
    field: Field<C>,
    values: Record<string, Json>,
    ctx: Ctx,
    hash: (s: string) => string,
  ): V;
  /**
   * Called for every field of this type when other values of the item change. Return the new value (null clears),
   * or undefined to keep it (signature clearOnChange).
   */
  onItemChange?(
    prev: Record<string, Json>,
    next: Record<string, Json>,
    field: Field<C>,
    ctx: Ctx,
  ): V | null | undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFieldType = FieldTypeDef<any, any>;
