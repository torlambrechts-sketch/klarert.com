'use server';

import { revalidatePath } from 'next/cache';
import * as own from '@/server/commands/own-frameworks';

// A workspace's own frameworks (docs/12 Your own frameworks). Each action calls one command, which validates (Zod)
// and authorises; publishing adds to Workspace admin › Frameworks, so that page is revalidated.

const org = (input: unknown) =>
  typeof input === 'object' && input && 'org' in input ? String(input.org) : '';

export const createOwnFrameworkAction = async (input: unknown) => {
  const r = await own.createOwnFramework(input);
  if (r.ok) revalidatePath(`/${org(input)}/settings`);
  return r;
};
export const saveOwnDraftAction = async (input: unknown) => own.saveOwnFrameworkDraft(input);
export const deleteOwnDraftAction = async (input: unknown) => {
  const r = await own.deleteOwnFrameworkDraft(input);
  if (r.ok) revalidatePath(`/${org(input)}/settings`);
  return r;
};
export const publishOwnFrameworkAction = async (input: unknown) => {
  const r = await own.publishOwnFramework(input);
  if (r.ok) revalidatePath(`/${org(input)}/settings`);
  return r;
};
