'use server';

import * as notifications from '@/server/commands/notifications';
import * as search from '@/server/commands/search';

// Server actions for the app shell: global search, the inbox and the Getting started checklist.

export const searchAction = async (input: unknown) => search.search(input);
export const markNotificationsReadAction = async (input: unknown) =>
  notifications.markNotificationsRead(input);
export const noteActivityLogOpenedAction = async (input: unknown) =>
  notifications.noteActivityLogOpened(input);
