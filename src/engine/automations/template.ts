// Templates in automation messages and names (docs/04 §6). Pure.
import type { Ctx, Item } from '../types';
import { defOf, textOf } from '../values';
import type { Actor } from './types';

export interface TemplateEnv {
  /** Absolute URL of the app, without a trailing slash. */
  appUrl: string;
  /** Workspace slug, for item links. */
  workspace: string;
  /** Who started the chain ({actor}). */
  actor: Actor;
}

/** Absolute link to an item: the sheet with the item panel open. */
export function itemLink(item: Item, env: Pick<TemplateEnv, 'appUrl' | 'workspace'>): string {
  return `${env.appUrl.replace(/\/+$/, '')}/${env.workspace}/s/${item.sheetId}?item=${encodeURIComponent(item.displayId)}`;
}

export function actorName(actor: Actor, ctx: Ctx): string {
  if (actor.kind === 'user') return (actor.id && ctx.people.get(actor.id)?.name) || 'Someone';
  if (actor.kind === 'form') return 'A form';
  if (actor.kind === 'automation') return 'An automation';
  return 'The system';
}

const TOKEN = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * `{name}`, `{id}`, `{sheet}`, `{group}`, `{link}`, `{actor}` and `{<field_key>}` (the value as text). Unknown keys
 * stay as written. Protected fields render as "Restricted", whoever may read them.
 */
export function renderTemplate(text: string, item: Item, ctx: Ctx, env: TemplateEnv): string {
  return text.replace(TOKEN, (whole, key: string) => {
    switch (key) {
      case 'name':
        return item.name;
      case 'id':
        return item.displayId;
      case 'sheet':
        return ctx.sheetOf(item.id)?.name ?? ctx.sheet.name;
      case 'group':
        return ctx.groups.get(item.groupId)?.name ?? '';
      case 'link':
        return itemLink(item, env);
      case 'actor':
        return actorName(env.actor, ctx);
    }
    const field = ctx.fieldsByKey.get(key);
    if (!field) return whole;
    if (defOf(field).storage === 'protected') return 'Restricted';
    return textOf(item, field, ctx);
  });
}
