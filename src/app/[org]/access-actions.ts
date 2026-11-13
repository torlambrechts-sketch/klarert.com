'use server';

import { revalidatePath } from 'next/cache';
import * as access from '@/server/commands/access';
import type { Result } from '@/server/result';

// Access control (docs/02 §16): the Access panel of folders and sheets and the restricted-field settings. The
// commands validate (Zod) and authorise; a change revalidates the workspace so the side menu shows the lock.

const orgOf = (input: unknown) =>
  input && typeof input === 'object' && 'org' in input ? String(input.org) : '';

function call<T>(command: (input: unknown) => Promise<Result<T>>, revalidate = true) {
  return async (input: unknown): Promise<Result<T>> => {
    const result = await command(input);
    const org = orgOf(input);
    if (result.ok && revalidate && org) revalidatePath(`/${org}`, 'layout');
    return result;
  };
}

export const getSheetAccessAction = call(access.getSheetAccess, false);
export const getFolderAccessAction = call(access.getFolderAccess, false);
export const setSheetAccessAction = call(access.setSheetAccess);
export const setFolderAccessAction = call(access.setFolderAccess);
export const setAccessGrantAction = call(access.setAccessGrant);
export const setFieldRestrictionAction = call(access.setFieldRestriction);
