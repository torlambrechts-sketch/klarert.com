// Templates in automation messages and names (docs/04 §6). Pure.
import type { Ctx, Field, Item } from '../types';
import { defOf, hiddenFor, textOf } from '../values';
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

/**
 * Whether a field's value stays out of automation messages, posts and webhooks (docs/02 §16): protected and restricted
 * fields, and computed fields reading one or reading a restricted sheet. A message is written once for everyone who
 * can read the item (a post) or by a system that sees everything, so it never carries a value someone reading it may
 * not see; it says "Restricted".
 */
export function restrictedInMessages(field: Field, ctx: Ctx): boolean {
  const def = defOf(field);
  if (def.storage === 'protected' || field.restrictedTo || field.hidden) return true;
  const strict: Ctx = {
    ...ctx,
    canSee: (f) => !f.restrictedTo && !f.hidden && defOf(f).storage !== 'protected',
  };
  return hiddenFor(field, strict);
}

const TOKEN = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * `{name}`, `{id}`, `{sheet}`, `{group}`, `{link}`, `{actor}` and `{<field_key>}` (the value as text). Unknown keys
 * stay as written. Protected and restricted fields render as "Restricted", whoever may read them.
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
    if (restrictedInMessages(field, ctx)) return 'Restricted';
    return textOf(item, field, ctx);
  });
}
