import type { LucideIcon } from 'lucide-react';
import type { Ctx, Field, Item, Sheet } from '@/engine/types';

// The UI half of the field contract (docs/03 §1). One entry per type id in ./registry.tsx; nothing else in the UI
// branches on a field type.

export interface CellProps<V = unknown, C = unknown> {
  value: V | null;
  field: Field<C>;
  item: Item;
  ctx: Ctx;
  density: 'grid' | 'list';
}

export interface EditorProps<V = unknown, C = unknown> {
  value: V | null;
  field: Field<C>;
  item: Item;
  ctx: Ctx;
  /** Raw input the field type's normalize accepts (link types: target item ids). null clears. */
  onCommit(v: unknown): void;
  onCancel(): void;
  /** Commit another field of the same item (AI proposal → its target field). */
  onCommitField?(fieldId: string, v: unknown): void;
  /** Run the item's button automation (button field). */
  onButton?(): void;
}

export interface ConfigEnv {
  sheet: Sheet;
  /** Fields of this sheet (key pickers). */
  fields: Field[];
  /** Sheets of the workspace (link targets). */
  sheets: { id: string; name: string; isLibrary: boolean }[];
  ctx: Ctx;
  /** First item of the sheet, for live previews (formula). */
  firstItemId?: string;
}

export interface ConfigFormProps<C = unknown> {
  config: C;
  onChange(c: C): void;
  sheet: Sheet;
  env: ConfigEnv;
  field: Field<C>;
}

export interface FieldTypeUI<V = unknown, C = unknown> {
  Cell: React.FC<CellProps<V, C>>;
  Editor: React.FC<EditorProps<V, C>>;
  ConfigForm?: React.FC<ConfigFormProps<C>>;
  icon: LucideIcon;
  /** Space and click toggle the value without an editor (checkbox). */
  toggle?(v: V | null): unknown;
  /** Width of the editor popover in px (default 260). */
  editorWidth?: number;
  /** Send expectedUpdatedAt so a concurrent edit is reported, not overwritten (docs/02 §5). */
  conflictCheck?: boolean;
}
