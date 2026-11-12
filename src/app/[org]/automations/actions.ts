'use server';

import * as automations from '@/server/commands/automations';

// Server actions for the Automations page, the builder, the sheet's side sheet and the item panel. Each binds one
// command, which validates (Zod), authorises and writes; the callers refresh their own lists.

export const createAutomationAction = async (input: unknown) => automations.createAutomation(input);
export const updateAutomationAction = async (input: unknown) => automations.updateAutomation(input);
export const toggleAutomationAction = async (input: unknown) => automations.toggleAutomation(input);
export const duplicateAutomationAction = async (input: unknown) =>
  automations.duplicateAutomation(input);
export const deleteAutomationAction = async (input: unknown) => automations.deleteAutomation(input);
export const setAutomationPauseAction = async (input: unknown) =>
  automations.setAutomationPause(input);
