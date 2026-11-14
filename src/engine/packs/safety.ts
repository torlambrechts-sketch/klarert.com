// How a pack's automations start (docs/11 Pack quality bar, docs/04 §14). Two safety rules, both pure:
// - Outbound off: an automation that sends anything out of the workspace (a webhook, an email) installs turned off
//   unless the person installing opts in; they turn it on after checking where it sends.
// - Quiet first week: an automation that tells people anything (a notification, a request, an assignment) or sends
//   anything out installs in test mode unless its manifest says `"startInTestMode": false`. It runs and logs what it
//   would do; an owner or admin turns it live.
import type { PackManifest } from './types';

type AutomationLike = Pick<PackManifest['automations'][number], 'actions'> & {
  startInTestMode?: boolean;
};

/** Action types that send something out of the workspace. */
export const OUTBOUND_ACTIONS = new Set(['webhook', 'send_email', 'email']);

/** Action types that tell people something (notifications, requests, assignments), outbound ones included. */
export const NOTIFYING_ACTIONS = new Set([
  'notify',
  'request_update',
  'assign',
  ...OUTBOUND_ACTIONS,
]);

export const isOutbound = (a: AutomationLike) =>
  a.actions.some((x) => OUTBOUND_ACTIONS.has(String(x.type)));

export const notifiesPeople = (a: AutomationLike) =>
  a.actions.some((x) => NOTIFYING_ACTIONS.has(String(x.type)));

/** Whether a pack automation installs in test mode: the manifest's `startInTestMode`, else when it notifies. */
export const startsInTestMode = (a: AutomationLike) => a.startInTestMode ?? notifiesPeople(a);
