import { z } from 'zod';
import { isFieldTypeId } from '@/engine/fields/registry';
import { csvImportable } from '@/engine/fields/csv';
import { slugInput } from './workspace';

/** The 11 label colours (docs/05 §6), in the order new groups take them. */
export const LABEL_COLORS = [
  'green',
  'orange',
  'red',
  'blue',
  'purple',
  'teal',
  'navy',
  'yellow',
  'grey',
  'pink',
  'dark',
] as const;
export type GroupColor = (typeof LABEL_COLORS)[number];
export const COLOR_LABELS: Record<GroupColor, string> = {
  green: 'Green',
  orange: 'Orange',
  red: 'Red',
  blue: 'Blue',
  purple: 'Purple',
  teal: 'Teal',
  navy: 'Navy',
  yellow: 'Yellow',
  grey: 'Grey',
  pink: 'Pink',
  dark: 'Dark',
};

export const ID_PREFIX = /^[A-Z0-9]{1,6}-$/;

const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} can be at most ${max} characters.`);

const uuid = z.uuid('Not found.');
/** Empty select value = no folder. */
const folderId = z
  .union([z.literal(''), z.null(), uuid])
  .optional()
  .transform((v) => v || null);

export const idPrefix = z
  .string()
  .trim()
  .toUpperCase()
  .regex(ID_PREFIX, 'Use 1 to 6 capital letters or digits followed by "-", like CA-.');

const description = z
  .string()
  .trim()
  .max(2000, 'Description can be at most 2000 characters.')
  .optional()
  .transform((v) => v || null);

/** "Open, Done" → ["Open", "Done"]; duplicates and blanks removed. */
export const groupList = z
  .string()
  .max(2000)
  .transform((s) => [
    ...new Map(
      s
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean)
        .map((g) => [g.toLowerCase(), g] as const),
    ).values(),
  ])
  .pipe(
    z
      .array(z.string().max(80, 'A group name can be at most 80 characters.'))
      .max(50, 'Use at most 50 groups.'),
  );

const sheetBasics = {
  org: slugInput,
  name: text('Sheet name', 120),
  description,
  itemLabel: text('Item label', 40),
  idPrefix,
  folderId,
  groups: groupList,
};

export const columnInput = z.object({
  name: z.string().trim().max(80, 'A field name can be at most 80 characters.'),
  type: z.string().refine(isFieldTypeId, 'Choose a field type.'),
  /** Link types: the sheet the field links to. */
  targetSheetId: z.uuid().optional(),
  /** Link types: also show the link on the target sheet (creates the inverse field). */
  twoWay: z.boolean().optional(),
});

export const createSheetInput = z.object({
  ...sheetBasics,
  columns: z.array(columnInput).max(100, 'Use at most 100 fields.'),
});

export const importCsvInput = z.object({
  ...sheetBasics,
  csv: z.string().min(1, 'Paste CSV text or choose a file first.'),
  columns: z
    .array(
      z.object({
        index: z.number().int().min(1),
        name: z.string().trim().min(1, 'Every column needs a name.').max(80),
        type: z.string().refine(csvImportable, 'This type cannot be imported from a CSV.'),
      }),
    )
    .max(99),
});

export const copySheetInput = z.object({
  org: slugInput,
  sourceSheetId: uuid,
  name: text('Sheet name', 120),
  idPrefix,
  folderId,
});

export const updateSheetInput = z.object({
  org: slugInput,
  sheetId: uuid,
  name: text('Sheet name', 120),
  description: z
    .string()
    .trim()
    .max(2000, 'Description can be at most 2000 characters.')
    .transform((v) => v || null),
  itemLabel: text('Item label', 40),
  idPrefix: idPrefix.optional(),
  folderId,
  isLibrary: z
    .union([z.literal('on'), z.literal('true'), z.literal('false'), z.literal('')])
    .optional()
    .transform((v) => v === 'on' || v === 'true'),
  /** Automations wait until the person finishes a row in the Table or item panel. */
  holdAutomations: z
    .union([z.literal('on'), z.literal('true'), z.literal('false'), z.literal('')])
    .optional()
    .transform((v) => v === undefined || v === 'on' || v === 'true'),
});

export const archiveSheetInput = z.object({
  org: slugInput,
  sheetId: uuid,
  archived: z.enum(['true', 'false']).transform((v) => v === 'true'),
});

export const folderInput = z.object({ org: slugInput, name: text('Folder name', 80) });
export const folderRef = z.object({ org: slugInput, folderId: uuid });
export const renameFolderInput = folderRef.extend({ name: text('Folder name', 80) });

export const groupColor = z.enum(LABEL_COLORS);
export const createGroupInput = z.object({
  org: slugInput,
  sheetId: uuid,
  name: text('Group name', 80),
  color: groupColor.optional(),
});
export const updateGroupInput = z.object({
  org: slugInput,
  groupId: uuid,
  name: text('Group name', 80).optional(),
  color: groupColor.optional(),
});
export const moveGroupInput = z.object({
  org: slugInput,
  groupId: uuid,
  toIndex: z.coerce.number().int().min(0),
});
export const deleteGroupInput = z.object({
  org: slugInput,
  groupId: uuid,
  moveTo: z
    .union([z.literal(''), uuid])
    .optional()
    .transform((v) => v || null),
});
