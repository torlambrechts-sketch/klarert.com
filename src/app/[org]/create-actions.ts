'use server';

import { revalidatePath } from 'next/cache';
import * as bundles from '@/server/commands/bundles';

// The Create wizard (docs/05 §4 Create): object inputs; the commands validate with Zod and authorise. Creating a set
// changes the side menu (folders, sheets, apps), so the whole workspace layout is revalidated.
export async function createOptionsAction(input: { org: string }) {
  return bundles.createOptions(input);
}

export async function bundleDetailsAction(input: {
  org: string;
  key: string;
  level?: string | null;
}) {
  return bundles.bundleDetails(input);
}

export async function createBundleAction(input: {
  org: string;
  key: string;
  hash: string;
  level?: string | null;
  exclude: string[];
  folder: { mode: 'pack' } | { mode: 'none' } | { mode: 'folder'; name: string };
  name: string;
  ownerId: string;
  reviewBy: string;
}) {
  const result = await bundles.createBundle(input);
  if (result.ok) revalidatePath(`/${input.org}`, 'layout');
  return result;
}

export async function markBundleReviewedAction(input: { org: string; installId: string }) {
  const result = await bundles.markBundleReviewed(input);
  if (result.ok) revalidatePath(`/${input.org}`, 'layout');
  return result;
}
