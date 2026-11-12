import { z } from 'zod';
import { MAX_FILE_BYTES } from '@/engine/files';
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

const fileMeta = {
  org: slugInput,
  sheetId: uuid,
  itemId: uuid,
  fieldId: uuid,
  filename: z.string().trim().min(1, 'The file needs a name.').max(255),
  mime: z.string().max(200),
  size: z
    .number()
    .int()
    .min(1, 'The file is empty.')
    .max(MAX_FILE_BYTES, 'Files can be at most 50 MB.'),
  /** SHA-256 of the file, computed in the browser (docs/02 §8). */
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Bad checksum.'),
  /** The current version this upload replaces. */
  replaces: uuid.optional(),
};

export const prepareUploadInput = z.object(fileMeta);
export const confirmUploadInput = z.object({ ...fileMeta, fileId: uuid });
export const downloadFileInput = z.object({ org: slugInput, fileId: uuid });
export const verifyActivityInput = z.object({ org: slugInput, itemId: uuid });
export const searchItemsInput = z.object({
  org: slugInput,
  sheetId: uuid,
  query: z.string().max(100),
});
