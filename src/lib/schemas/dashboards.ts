import { z } from 'zod';
import { MAX_WIDGETS, widgetConfigSchema } from '@/engine/dashboards/types';
import { slugInput } from './workspace';

// Inputs of the dashboard commands (docs/05 §4, docs/02 §1). Widgets are checked again against the registry and the
// workspace's sheets in the command.

const uuid = z.uuid('Not found.');
const dashboardName = z
  .string()
  .trim()
  .min(1, 'A name is required.')
  .max(80, 'A dashboard name can be at most 80 characters.');

export const createDashboardInput = z.object({ org: slugInput, name: dashboardName });

export const updateDashboardInput = z.object({
  org: slugInput,
  dashboardId: uuid,
  name: dashboardName.optional(),
  widgets: z
    .array(widgetConfigSchema)
    .max(MAX_WIDGETS, 'A dashboard holds at most 24 widgets.')
    .optional(),
});

export const deleteDashboardInput = z.object({ org: slugInput, dashboardId: uuid });

export const seedDashboardInput = z.object({ org: slugInput });
