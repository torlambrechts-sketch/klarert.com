import { z } from 'zod';
import { MAX_FILE_BYTES } from '@/engine/files';
import { CLASSIFICATIONS } from '@/engine/item-files';
import { slugInput } from './workspace';

// Inputs of the item panel's commands: updates, files, the audit check and the link picker's search.

const uuid = z.uuid('Not found.');
const body = z
  .string()
  .trim()
  .min(1, 'Write something first.')
  .max(10_000, 'An update can be at most 10,000 characters.');

export const postUpdateInput = z.object({ org: slugInput, itemId: uuid, body });
export const editUpdateInput = z.object({ org: slugInput, updateId: uuid, body });
export const deleteUpdateInput = z.object({ org: slugInput, updateId: uuid });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.');

/** A file's details (docs/02 §8). Category is an option id of the workspace's file categories. */
export const fileDetails = z.object({
  description: z
    .string()
    .trim()
    .max(2000, 'A description can be at most 2,000 characters.')
    .optional(),
  category: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Choose a category.')
    .nullable()
    .optional(),
  validUntil: isoDate.nullable().optional(),
  classification: z.enum(CLASSIFICATIONS).optional(),
  personalData: z.boolean().optional(),
});

const fileMeta = {
  org: slugInput,
  sheetId: uuid,
  itemId: uuid,
  /** The evidence or attachment field; null for a file of the item's Files tab. */
  fieldId: uuid.nullable(),
  filename: z.string().trim().min(1, 'The file needs a name.').max(255),
  mime: z.string().max(200),
  size: z
    .number()
    .int()
    .min(1, 'The file is empty.')
    .max(MAX_FILE_BYTES, 'Files can be at most 25 MB.'),
  /** SHA-256 of the file, computed in the browser (docs/02 §8). */
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Bad checksum.'),
  /** The current version this upload replaces. */
  replaces: uuid.optional(),
  /** Details of an item file, and the version note of a new version. */
  details: fileDetails.optional(),
  versionNote: z
    .string()
    .trim()
    .max(1000, 'A version note can be at most 1,000 characters.')
    .optional(),
};

export const prepareUploadInput = z.object(fileMeta);
export const confirmUploadInput = z.object({ ...fileMeta, fileId: uuid });
export const downloadFileInput = z.object({ org: slugInput, fileId: uuid });
export const setFileDetailsInput = z.object({ org: slugInput, fileId: uuid, details: fileDetails });
export const archiveFileInput = z.object({
  org: slugInput,
  fileId: uuid,
  archived: z.boolean(),
  note: z.string().trim().max(500).optional(),
});
export const itemDocumentsInput = z.object({ org: slugInput, itemId: uuid });
export const searchDocumentsInput = z.object({ org: slugInput, query: z.string().max(100) });
export const addDocumentsFieldInput = z.object({
  org: slugInput,
  sheetId: uuid,
  targetSheetId: uuid,
});
export const setRegisterInput = z.object({ org: slugInput, sheetId: uuid, documents: z.boolean() });
export const verifyActivityInput = z.object({ org: slugInput, itemId: uuid });
export const searchItemsInput = z
  .object({
    org: slugInput,
    /** The target sheet of a link field. */
    sheetId: uuid.optional(),
    /** Requirement and control link fields with no target sheet: items of every library sheet (docs/12). */
    library: z.literal(true).optional(),
    query: z.string().max(100),
  })
  .refine((v) => Boolean(v.sheetId) !== Boolean(v.library), 'Choose a sheet.');
