// The pure automation engine (docs/04 §1): trigger matching, conditions, action planning, templates, chain rules.
// Runs in the browser (builder previews, M8) and on the server (the runner in src/server/automations).
import { matchesAll } from '../conditions';
import type { Condition, Ctx, Item } from '../types';

export * from './types';
export * from './triggers';
export * from './template';
export * from './actions';
export * from './chain';
export * from './webhook';
export * from './subitem-triggers';
export * from './subitem-actions';

/** Conditions (docs/04 §4): all must hold for the item after the change. Same operators as view filters. */
export function checkConditions(conditions: Condition[], item: Item, ctx: Ctx): boolean {
  return matchesAll(conditions ?? [], item, ctx);
}
export * from './builder';
export * from './recipes';
export * from './schedule';
