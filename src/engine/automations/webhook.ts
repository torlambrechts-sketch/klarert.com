// Outbound webhook payloads (docs/04 §5): generic JSON, or the same content as a Teams or Slack message. Pure.
import type { Automation, Ctx, Item, Json } from '../types';
import { defOf, textOf } from '../values';
import { itemLink, restrictedInMessages } from './template';
import { triggerField } from './triggers';

export type WebhookPreset = 'generic' | 'teams' | 'slack';

/**
 * The host of a webhook address saved on the server (migration 0056): the action keeps `urlRef` (the key the runner
 * resolves) and `urlHost` instead of the address, which members never read. Null when the action has none.
 */
export function savedWebhookHost(action: Record<string, unknown>): string | null {
  return typeof action.urlRef === 'string' && action.urlRef && typeof action.urlHost === 'string' && action.urlHost
    ? action.urlHost
    : null;
}

/** Whether any action keeps its webhook address on the server. */
export function hasSavedWebhook(actions: unknown): boolean {
  return (
    Array.isArray(actions) &&
    actions.some(
      (x) =>
        !!x && typeof x === 'object' && (x as { type?: unknown }).type === 'webhook' && 'urlRef' in x,
    )
  );
}

/**
 * The runner's view of the actions: each webhook action with its saved address put back (service role only). An
 * address that is gone leaves the action without one, so planning says "Webhooks need an https:// address."
 */
export function withWebhookAddresses<A extends { type: string } & Record<string, Json>>(
  actions: A[],
  urls: Record<string, unknown>,
): A[] {
  return actions.map((x) => {
    if (x.type !== 'webhook' || typeof x.urlRef !== 'string') return x;
    const url = urls[x.urlRef];
    if (typeof url === 'string' && url) return { ...x, url };
    const rest = { ...x };
    delete rest.urlRef;
    delete rest.urlHost;
    return rest;
  });
}

export const isWebhookPreset = (p: unknown): p is WebhookPreset =>
  p === 'generic' || p === 'teams' || p === 'slack';

export interface WebhookEnv {
  appUrl: string;
  workspace: string;
}

/** The generic payload. Protected fields are never included; restricted ones say "Restricted" (docs/02 §16). */
export function genericPayload(
  automation: Pick<Automation, 'id' | 'name' | 'trigger'>,
  item: Item,
  ctx: Ctx,
  env: WebhookEnv,
): { [key: string]: Json } {
  const values: Record<string, Json> = {};
  for (const field of ctx.fieldsOf(item.sheetId)) {
    const def = defOf(field);
    if (def.storage === 'protected' || def.storage === 'none') continue;
    values[field.key] = restrictedInMessages(field, ctx) ? 'Restricted' : textOf(item, field, ctx);
  }
  const field = triggerField(automation.trigger, ctx);
  const trigger: { [key: string]: Json } = { type: automation.trigger.type };
  if (field) {
    trigger.field = field.name;
    if (automation.trigger.type === 'field_becomes' && !restrictedInMessages(field, ctx)) {
      trigger.value = textOf(item, field, ctx);
    }
  }
  return {
    event: 'automation',
    automation: { id: automation.id, name: automation.name },
    workspace: env.workspace,
    sheet: { id: item.sheetId, name: ctx.sheetOf(item.id)?.name ?? ctx.sheet.name },
    item: {
      id: item.id,
      displayId: item.displayId,
      name: item.name,
      url: itemLink(item, env),
      values,
    },
    trigger,
    at: ctx.now.toISOString(),
  };
}

/** The payload for a preset: Teams and Slack wrap the same content in their message format (title, facts, link). */
export function webhookPayload(
  preset: WebhookPreset,
  automation: Pick<Automation, 'id' | 'name' | 'trigger'>,
  item: Item,
  ctx: Ctx,
  env: WebhookEnv,
): Json {
  const generic = genericPayload(automation, item, ctx, env);
  if (preset === 'generic') return generic;
  const title = `${item.displayId} ${item.name}`;
  const url = itemLink(item, env);
  const sheetName = ctx.sheetOf(item.id)?.name ?? ctx.sheet.name;
  const facts = [
    { name: 'Sheet', value: sheetName },
    { name: 'Automation', value: automation.name },
    ...Object.entries((generic.item as { values: Record<string, string> }).values)
      .filter(([, v]) => v !== '')
      .slice(0, 8)
      .map(([key, value]) => ({ name: ctx.fieldsByKey.get(key)?.name ?? key, value })),
  ];
  if (preset === 'teams') {
    return {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary: title,
      title,
      sections: [{ facts }],
      potentialAction: [
        { '@type': 'OpenUri', name: 'Open item', targets: [{ os: 'default', uri: url }] },
      ],
    };
  }
  return {
    text: title,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: title.slice(0, 150) } },
      {
        type: 'section',
        fields: facts.map((f) => ({ type: 'mrkdwn', text: `*${f.name}*\n${f.value}` })),
      },
      {
        type: 'actions',
        elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open item' }, url }],
      },
    ],
  };
}
