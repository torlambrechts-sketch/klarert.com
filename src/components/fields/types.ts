import type { LucideIcon } from 'lucide-react';
import type { LabelOption } from '@/engine/fields/types';
import type { Ctx, Field, Item, Sheet } from '@/engine/types';

// The UI half of the field contract (docs/03 §1). One entry per type id in ./registry.tsx; nothing else in the UI
// branches on a field type.

export interface CellProps<V = unknown, C = unknown> {
  value: V | null;
  field: Field<C>;
  item: Item;
  ctx: Ctx;
  /** grid: dense; list: forms and panels; table: the Table view (date countdowns, stacked avatars). */
  density: 'grid' | 'list' | 'table';
  /** The Table's active cell (keyboard), not being edited: a cell may show what it truncates (links: all of them). */
  active?: boolean;
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
  /** Open the item panel (the grid's file cells upload from there). */
  onOpenItem?(): void;
  /**
   * Add an option typed in the picker to the field (types with addOption, people who may edit the field). Resolves
   * to the new option once the field holds it, or null when it could not be added (the host shows why).
   */
  onAddOption?(label: string): Promise<LabelOption | null>;
  /** Open the field's settings (options, rules); the host closes the editor first. */
  onEditField?(): void;
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
  /** False when the person is not an owner or admin: settings only they may change are shown read-only. */
  isAdmin?: boolean;
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
  /** In the Table, one click opens the picker under the cell (option and people cells, docs/18 §5). */
  opensOnClick?: boolean;
  /** Width of the editor popover in px (default 260). */
  editorWidth?: number;
  /** Only automations set this value (workflow step): bulk edit and paste leave it out. */
  automationOnly?: boolean;
  /** Send expectedUpdatedAt so a concurrent edit is reported, not overwritten (docs/02 §5). */
  conflictCheck?: boolean;
}
