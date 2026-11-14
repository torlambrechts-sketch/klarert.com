'use server';

import { revalidatePath } from 'next/cache';
import * as forms from '@/server/commands/form-admin';
import * as views from '@/server/commands/views';
import type { Result } from '@/server/result';

// Server actions for saved views, the default view, server-side filters, forms and their links. Each binds one command,
// which validates (Zod) and authorises; RLS checks again in the database.

const orgOf = (input: unknown) =>
  input && typeof input === 'object' && 'org' in input ? String(input.org) : '';

function bind<T>(command: (input: unknown) => Promise<Result<T>>, revalidate = false) {
  return async (input: unknown): Promise<Result<T>> => {
    const result = await command(input);
    const org = orgOf(input);
    if (result.ok && revalidate && org) revalidatePath(`/${org}`, 'layout');
    return result;
  };
}

export const createViewAction = bind(views.createView);
export const updateViewAction = bind(views.updateView);
export const duplicateViewAction = bind(views.duplicateView);
export const deleteViewAction = bind(views.deleteView);
export const setDefaultViewAction = bind(views.setDefaultView, true);
export const setSheetTabsAction = bind(views.setSheetTabs, true);
export const filterItemIdsAction = bind(views.filterItemIds);
export const createFormAction = bind(forms.createForm);
export const saveFormAction = bind(forms.saveForm);
export const duplicateFormAction = bind(forms.duplicateForm);
export const copyFormToSheetAction = bind(forms.copyFormToSheet);
export const deleteFormAction = bind(forms.deleteForm);
export const changeFormLinkAction = bind(forms.changeFormLink);
export const submitInternalFormAction = bind(forms.submitInternalForm);
export const setNewItemFormAction = bind(forms.setNewItemForm, true);
