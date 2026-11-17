'use server';

import * as documents from '@/server/commands/documents';
import * as files from '@/server/commands/files';
import * as frameworks from '@/server/commands/frameworks';
import * as own from '@/server/commands/own-frameworks';
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
export const checklistAction = async (input: unknown) => panel.checklist(input);
export const setFileDetailsAction = async (input: unknown) => files.setFileDetails(input);
export const archiveFileAction = async (input: unknown) => files.archiveFile(input);
export const itemDocumentsAction = async (input: unknown) => documents.itemDocuments(input);
export const searchDocumentsAction = async (input: unknown) => documents.searchDocuments(input);
export const addDocumentsFieldAction = async (input: unknown) => documents.addDocumentsField(input);
export const setDocumentsRegisterAction = async (input: unknown) =>
  documents.setDocumentsRegister(input);
export const requirementContextAction = async (input: unknown) =>
  frameworks.requirementContext(input);
// A workspace's own requirement mapped to the catalogue ("Map to …", docs/12 Your own frameworks)
export const ownMappingOptionsAction = async (input: unknown) => own.ownMappingOptions(input);
export const mapOwnRequirementAction = async (input: unknown) => own.mapOwnRequirement(input);
export const retireOwnMappingAction = async (input: unknown) => own.retireOwnMapping(input);
