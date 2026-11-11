'use server';

import * as files from '@/server/commands/files';
import * as panel from '@/server/commands/panel';
import * as updates from '@/server/commands/updates';

// Server actions for the item panel. Each binds one command, which validates (Zod), authorises and writes; the panel's
// own queries and the sheet cache follow the results, so nothing here revalidates the layout.

export const postUpdateAction = async (input: unknown) => updates.postUpdate(input);
export const editUpdateAction = async (input: unknown) => updates.editUpdate(input);
export const deleteUpdateAction = async (input: unknown) => updates.deleteUpdate(input);
export const prepareUploadAction = async (input: unknown) => files.prepareUpload(input);
export const confirmUploadAction = async (input: unknown) => files.confirmUpload(input);
export const downloadFileAction = async (input: unknown) => files.downloadFile(input);
export const verifyActivityAction = async (input: unknown) => panel.verifyActivity(input);
export const searchItemsAction = async (input: unknown) => panel.searchItems(input);
