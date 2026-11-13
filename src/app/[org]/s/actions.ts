'use server';

import { revalidatePath } from 'next/cache';
import * as folders from '@/server/commands/folders';
import * as groups from '@/server/commands/groups';
import * as sheets from '@/server/commands/sheets';
import * as subitems from '@/server/commands/subitems';
import type { Result } from '@/server/result';

// Server actions binding the sheet, group and folder commands. The commands validate (Zod) and authorise;
// a success revalidates the whole workspace so the side menu, panel and pages show the change.

const orgOf = (input: unknown) =>
  input && typeof input === 'object' && 'org' in input ? String(input.org) : '';

function revalidate(input: unknown) {
  const org = orgOf(input);
  if (org) revalidatePath(`/${org}`, 'layout');
}

/** For calls with a plain object (wizard, drag and drop). */
function call<T>(command: (input: unknown) => Promise<Result<T>>) {
  return async (input: unknown): Promise<Result<T>> => {
    const result = await command(input);
    if (result.ok) revalidate(input);
    return result;
  };
}

/** For <form action>: FormData strings to the command's input. */
function form<T>(command: (input: unknown) => Promise<Result<T>>) {
  return async (_: unknown, data: FormData): Promise<Result<T>> => {
    const input = Object.fromEntries([...data.entries()].filter(([, v]) => typeof v === 'string'));
    const result = await command(input);
    if (result.ok) revalidate(input);
    return result;
  };
}

export const createSheetAction = call(sheets.createSheet);
export const importCsvAction = call(sheets.importCsv);
export const copySheetAction = call(sheets.copySheet);
export const updateSheetAction = form(sheets.updateSheet);
export const archiveSheetAction = form(sheets.archiveSheet);
export const enableSubitemsAction = call(subitems.enableSubitems);
export const updateSubitemSettingsAction = call(subitems.updateSubitemSettings);

export const createFolderAction = form(folders.createFolder);
export const renameFolderAction = form(folders.renameFolder);
export const deleteFolderAction = form(folders.deleteFolder);

export const createGroupAction = form(groups.createGroup);
export const updateGroupAction = form(groups.updateGroup);
export const updateGroupNowAction = call(groups.updateGroup);
export const moveGroupAction = call(groups.moveGroup);
export const deleteGroupAction = form(groups.deleteGroup);
