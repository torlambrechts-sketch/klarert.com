// The demo seed's hands: every change goes through the app's own commands (src/server/commands), as the person named,
// so validation, status rules, the activity log and its hash chain, automations and their run log are the real ones.
// Values are given by field key with option labels and people's names; the field registry normalises them exactly as
// it does for a person typing them.
import { createHash } from 'node:crypto';
import { generateKeyBetween } from 'fractional-indexing';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';
import type { Sessions } from './session';

type Db = SupabaseClient<Database>;
type Cmd<I, O> = (
  input: I,
) => Promise<{ ok: true; data: O } | { ok: false; error: { code: string; message: string } }>;

export interface SheetInfo {
  id: string;
  name: string;
  fields: Map<string, { id: string; type: string; name: string; options: string[] | null }>;
  groups: Map<string, string>;
  /** Last position per group, so new items go to the end. */
  last: Map<string, string | null>;
}

export interface ItemSpec {
  name: string;
  group?: string;
  values?: Record<string, unknown>;
  /** Link and requirement fields: field key → item ids. */
  links?: Record<string, string[]>;
}

export interface Writer {
  readonly org: string;
  readonly orgId: string;
  /** Run the next commands as this person (their email). */
  as(email: string): Promise<void>;
  sheet(name: string): Promise<SheetInfo>;
  create(sheet: SheetInfo, spec: ItemSpec): Promise<string>;
  update(
    sheet: SheetInfo,
    itemId: string,
    values: Record<string, unknown>,
    note?: string,
  ): Promise<void>;
  link(sheet: SheetInfo, itemId: string, fieldKey: string, to: string[]): Promise<void>;
  /** Items of a sheet by name (archived left out). */
  items(sheet: SheetInfo): Promise<Map<string, string>>;
  /** Upload a file into an evidence or attachment field (or the Files tab when fieldKey is null). */
  file(
    sheet: SheetInfo,
    itemId: string,
    fieldKey: string | null,
    f: {
      name: string;
      body: Buffer;
      mime: string;
      validUntil?: string | null;
      description?: string;
    },
  ): Promise<string>;
  /** Updates and comments on an item. */
  comment(itemId: string, body: string): Promise<void>;
  /** Count of problems the seed met and stepped over (printed at the end). */
  readonly warnings: string[];
  must<T>(r: { ok: boolean; data?: T; error?: { message: string } }, what: string): T;
}

type Commands = {
  createItem: Cmd<unknown, { item: { id: string } }>;
  setValues: Cmd<unknown, unknown>;
  setLinks: Cmd<unknown, unknown>;
  prepareUpload: Cmd<unknown, { fileId: string; path: string; token: string }>;
  confirmUpload: Cmd<unknown, unknown>;
  postUpdate: Cmd<unknown, unknown>;
};

export async function makeWriter(
  admin: Db,
  people: Sessions,
  org: { slug: string; id: string },
  commands: Commands,
): Promise<Writer> {
  const sheets = new Map<string, SheetInfo>();
  const warnings: string[] = [];
  let actor = '';

  const must = <T>(r: { ok: boolean; data?: T; error?: { message: string } }, what: string): T => {
    if (!r.ok) throw new Error(`${what}: ${r.error?.message ?? 'failed'}`);
    return r.data as T;
  };

  async function sheet(name: string): Promise<SheetInfo> {
    const known = sheets.get(name);
    if (known) return known;
    const { data: rows, error } = await admin
      .from('sheets')
      .select('id, name')
      .eq('org_id', org.id)
      .eq('name', name)
      .is('archived_at', null)
      .is('parent_sheet_id', null);
    if (error || !rows?.length) throw new Error(`No sheet "${name}" in the demo workspace.`);
    const id = rows[0]!.id;
    const [{ data: fields }, { data: groups }, { data: items }] = await Promise.all([
      admin
        .from('fields')
        .select('id, key, type, name, config')
        .eq('sheet_id', id)
        .is('archived_at', null),
      admin.from('groups').select('id, name').eq('sheet_id', id),
      admin.from('items').select('group_id, position').eq('sheet_id', id).order('position'),
    ]);
    const info: SheetInfo = {
      id,
      name,
      fields: new Map(
        (fields ?? []).map((f) => {
          const opts = (f.config as { options?: { id: string; label: string }[] }).options;
          return [
            f.key,
            {
              id: f.id,
              type: f.type,
              name: f.name,
              options: opts ? opts.flatMap((o) => [o.id, o.label.toLowerCase()]) : null,
            },
          ];
        }),
      ),
      groups: new Map((groups ?? []).map((g) => [g.name, g.id])),
      last: new Map(),
    };
    for (const i of items ?? []) info.last.set(i.group_id, i.position);
    sheets.set(name, info);
    return info;
  }

  function fieldId(s: SheetInfo, key: string) {
    const f = s.fields.get(key);
    if (!f) throw new Error(`Sheet "${s.name}" has no field "${key}".`);
    return f.id;
  }

  /**
   * Values by field id. The Standards column only offers the standards installed on that sheet: a standard it does
   * not offer is left out (the same content works whichever packs extend a register).
   */
  function byId(s: SheetInfo, values: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(values)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => {
          const f = s.fields.get(k);
          if (k === 'standards' && f?.options && Array.isArray(v)) {
            const known = v.filter((x) => f.options!.includes(String(x).toLowerCase()));
            return [fieldId(s, k), known.length ? known : ['All standards']];
          }
          return [fieldId(s, k), v];
        }),
    );
  }

  const w: Writer = {
    org: org.slug,
    orgId: org.id,
    warnings,
    must,
    async as(email) {
      if (actor === email) return;
      await people.actAs(email);
      actor = email;
    },
    sheet,
    async create(s, spec) {
      const groupName = spec.group ?? [...s.groups.keys()][0]!;
      const groupId = s.groups.get(groupName);
      if (!groupId) throw new Error(`Sheet "${s.name}" has no group "${groupName}".`);
      const position = generateKeyBetween(s.last.get(groupId) ?? null, null);
      s.last.set(groupId, position);
      const r = await commands.createItem({
        org: org.slug,
        sheetId: s.id,
        groupId,
        name: spec.name,
        position,
        values: byId(s, spec.values ?? {}),
      });
      const id = must(r, `"${spec.name}" on ${s.name}`).item.id;
      for (const [key, to] of Object.entries(spec.links ?? {}))
        if (to.length) await w.link(s, id, key, to);
      return id;
    },
    async update(s, itemId, values, note) {
      const r = await commands.setValues({
        org: org.slug,
        sheetId: s.id,
        itemId,
        values: byId(s, values),
        ...(note ? { note } : {}),
      });
      if (!r.ok) {
        // a status rule the data did not meet: report it and carry on, the item keeps its earlier values
        warnings.push(`${s.name}: ${r.error.message}`);
      }
    },
    async link(s, itemId, fieldKey, to) {
      must(
        await commands.setLinks({
          org: org.slug,
          sheetId: s.id,
          itemId,
          fieldId: fieldId(s, fieldKey),
          to: [...new Set(to)],
        }),
        `links ${fieldKey} on ${s.name}`,
      );
    },
    async items(s) {
      const { data } = await admin
        .from('items')
        .select('id, name')
        .eq('sheet_id', s.id)
        .is('archived_at', null);
      return new Map((data ?? []).map((i) => [i.name, i.id]));
    },
    async file(s, itemId, fieldKey, f) {
      const sha256 = createHash('sha256').update(f.body).digest('hex');
      const meta = {
        org: org.slug,
        sheetId: s.id,
        itemId,
        fieldId: fieldKey ? fieldId(s, fieldKey) : null,
        filename: f.name,
        mime: f.mime,
        size: f.body.length,
        sha256,
        ...(f.validUntil !== undefined || f.description
          ? {
              details: {
                validUntil: f.validUntil ?? null,
                ...(f.description ? { description: f.description } : {}),
              },
            }
          : {}),
      };
      const prepared = must(await commands.prepareUpload(meta), `upload ${f.name}`);
      const client = await people.client(actor);
      const up = await client.storage
        .from('files')
        .uploadToSignedUrl(prepared.path, prepared.token, f.body, { contentType: f.mime });
      if (up.error) throw new Error(`upload ${f.name}: ${up.error.message}`);
      must(await commands.confirmUpload({ ...meta, fileId: prepared.fileId }), `confirm ${f.name}`);
      return prepared.fileId;
    },
    async comment(itemId, body) {
      must(await commands.postUpdate({ org: org.slug, itemId, body }), 'update');
    },
  };
  return w;
}
