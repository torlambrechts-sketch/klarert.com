'use server';

import { revalidatePath } from 'next/cache';
import * as dashboards from '@/server/commands/dashboards';
import type { Result } from '@/server/result';

// Server actions for dashboards. Each binds one command, which validates (Zod) and authorises; RLS checks again in
// the database. A change revalidates the dashboard pages so the tabs and cards follow.

const orgOf = (input: unknown) =>
  input && typeof input === 'object' && 'org' in input ? String(input.org) : '';

function bind<T>(command: (input: unknown) => Promise<Result<T>>) {
  return async (input: unknown): Promise<Result<T>> => {
    const result = await command(input);
    const org = orgOf(input);
    if (result.ok && org) revalidatePath(`/${org}/dashboards`, 'layout');
    return result;
  };
}

export const createDashboardAction = bind(dashboards.createDashboard);
export const updateDashboardAction = bind(dashboards.updateDashboard);
export const deleteDashboardAction = bind(dashboards.deleteDashboard);
export const seedDashboardAction = bind(dashboards.seedDashboard);
