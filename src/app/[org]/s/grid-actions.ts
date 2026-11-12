'use server';

import { revalidatePath } from 'next/cache';
import * as fields from '@/server/commands/fields';
import * as items from '@/server/commands/items';
import type { Result } from '@/server/result';

// Server actions for the grid. Each binds one command, which validates (Zod), authorises and writes. Changes that
// move counts or structure revalidate the workspace layout so the side panel and settings pages follow; cell edits
// do not (the grid's own cache and realtime keep it current).

const orgOf = (input: unknown) =>
  input && typeof input === 'object' && 'org' in input ? String(input.org) : '';

function bind<T>(command: (input: unknown) => Promise<Result<T>>, revalidate: boolean) {
  return async (input: unknown): Promise<Result<T>> => {
    const result = await command(input);
    const org = orgOf(input);
    if (result.ok && revalidate && org) revalidatePath(`/${org}`, 'layout');
    return result;
  };
}

export const createItemAction = bind(items.createItem, true);
export const setValuesAction = bind(items.setValues, false);
export const bulkSetValuesAction = bind(items.bulkSetValues, false);
export const moveItemsAction = bind(items.moveItems, true);
export const archiveItemsAction = bind(items.archiveItems, true);
export const setLinksAction = bind(items.setLinks, false);
export const lockItemAction = bind(items.lockItem, false);
export const clickButtonAction = bind(items.clickButton, false);

export const addFieldAction = bind(fields.addField, true);
export const updateFieldAction = bind(fields.updateField, true);
export const addFieldOptionAction = bind(fields.addFieldOption, false);
export const moveFieldAction = bind(fields.moveField, true);
export const duplicateFieldAction = bind(fields.duplicateField, true);
export const deleteFieldAction = bind(fields.deleteField, true);
export const restoreFieldAction = bind(fields.restoreField, true);
export const listDeletedFieldsAction = bind(fields.listDeletedFields, false);
export const changeFieldTypeAction = bind(fields.changeFieldType, true);
