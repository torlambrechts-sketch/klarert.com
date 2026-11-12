// Outbound webhook payloads (docs/04 §5): generic JSON, or the same content as a Teams or Slack message. Pure.
import type { Automation, Ctx, Item, Json } from '../types';
import { defOf, textOf } from '../values';
import { itemLink } from './template';
import { triggerField } from './triggers';

export type WebhookPreset = 'generic' | 'teams' | 'slack';

export const isWebhookPreset = (p: unknown): p is WebhookPreset =>
  p === 'generic' || p === 'teams' || p === 'slack';

export interface WebhookEnv {
  appUrl: string;
  workspace: string;
}

/** The generic payload. Protected fields are never included. */
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
    values[field.key] = textOf(item, field, ctx);
  }
  const field = triggerField(automation.trigger, ctx);
  const trigger: { [key: string]: Json } = { type: automation.trigger.type };
  if (field) {
    trigger.field = field.name;
    if (automation.trigger.type === 'field_becomes' && defOf(field).storage !== 'protected') {
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
