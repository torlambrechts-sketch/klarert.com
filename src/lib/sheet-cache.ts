// Pure reducers over SheetData: optimistic updates, server results and realtime events patch the TanStack Query
// cache through these, never by hand (docs/02 §9). Each returns a new object; unchanged parts are shared.
import type { LinkRow, ProtectedRow, SheetData } from '@/engine/sheet-data';
import type { Field, Group, Item, Json } from '@/engine/types';

const byPosition = <T extends { position: string; id: string }>(a: T, b: T) =>
  a.position < b.position
    ? -1
    : a.position > b.position
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;

export function patchItem(
  data: SheetData,
  itemId: string,
  change: { values?: Record<string, Json | null>; name?: string; updatedAt?: string },
): SheetData {
  let hit = false;
  const items = data.items.map((it) => {
    if (it.id !== itemId) return it;
    hit = true;
    const values = { ...it.values };
    for (const [k, v] of Object.entries(change.values ?? {})) {
      if (v === null) delete values[k];
      else values[k] = v;
    }
    return {
      ...it,
      values,
      name: change.name ?? it.name,
      updatedAt: change.updatedAt ?? it.updatedAt,
    };
  });
  return hit ? { ...data, items } : data;
}

/** Insert or replace an item; archived items and items of other sheets leave the cache. */
export function upsertItem(data: SheetData, item: Item): SheetData {
  if (item.sheetId !== data.sheet.id || item.archivedAt) return removeItems(data, [item.id]);
  const i = data.items.findIndex((x) => x.id === item.id);
  if (i < 0) return { ...data, items: [...data.items, item].sort(byPosition) };
  const items = [...data.items];
  items[i] = item;
  return {
    ...data,
    items: items[i]!.position === data.items[i]!.position ? items : items.sort(byPosition),
  };
}

export function removeItems(data: SheetData, ids: Iterable<string>): SheetData {
  const gone = new Set(ids);
  if (!data.items.some((it) => gone.has(it.id))) return data;
  return {
    ...data,
    items: data.items.filter((it) => !gone.has(it.id)),
    links: data.links.filter((l) => !gone.has(l.fromItem)),
  };
}

export function moveItem(
  data: SheetData,
  itemId: string,
  groupId: string,
  position: string,
): SheetData {
  const items = data.items.map((it) => (it.id === itemId ? { ...it, groupId, position } : it));
  return { ...data, items: items.sort(byPosition) };
}

/** Replace the targets of one link field on one item (positions follow the given order). */
export function setLinks(
  data: SheetData,
  fieldId: string,
  fromItem: string,
  toIds: string[],
): SheetData {
  const kept = data.links.filter((l) => !(l.fieldId === fieldId && l.fromItem === fromItem));
  const existing = new Map(
    data.links
      .filter((l) => l.fieldId === fieldId && l.fromItem === fromItem)
      .map((l) => [l.toItem, l]),
  );
  const next: LinkRow[] = toIds.map(
    (to, i) =>
      existing.get(to) ?? {
        id: `pending:${fieldId}:${fromItem}:${to}`,
        fieldId,
        fromItem,
        toItem: to,
        position: `a${String(i).padStart(4, '0')}`,
      },
  );
  return { ...data, links: [...kept, ...next] };
}

/** Realtime: one link row inserted or updated. */
export function upsertLink(data: SheetData, link: LinkRow): SheetData {
  const rest = data.links.filter(
    (l) =>
      l.id !== link.id &&
      !(l.fieldId === link.fieldId && l.fromItem === link.fromItem && l.toItem === link.toItem),
  );
  if (!data.fields.some((f) => f.id === link.fieldId)) return data;
  return { ...data, links: [...rest, link] };
}

export function removeLink(data: SheetData, linkId: string): SheetData {
  return data.links.some((l) => l.id === linkId)
    ? { ...data, links: data.links.filter((l) => l.id !== linkId) }
    : data;
}

export function setProtected(
  data: SheetData,
  row: ProtectedRow | { itemId: string; fieldId: string; value: null },
) {
  const rest = data.protectedValues.filter(
    (p) => !(p.itemId === row.itemId && p.fieldId === row.fieldId),
  );
  return {
    ...data,
    protectedValues: row.value === null ? rest : [...rest, row as ProtectedRow],
  };
}

/** Insert or replace a field; archived fields and fields of other sheets leave the cache. */
export function upsertField(
  data: SheetData,
  field: Field & { archivedAt?: string | null },
): SheetData {
  if (field.sheetId !== data.sheet.id || field.archivedAt) return removeField(data, field.id);
  const rest = data.fields.filter((f) => f.id !== field.id);
  return { ...data, fields: [...rest, field].sort(byPosition) };
}

export function removeField(data: SheetData, fieldId: string): SheetData {
  return data.fields.some((f) => f.id === fieldId)
    ? { ...data, fields: data.fields.filter((f) => f.id !== fieldId) }
    : data;
}

export function upsertGroup(data: SheetData, group: Group): SheetData {
  if (group.sheetId !== data.sheet.id) return data;
  const rest = data.groups.filter((g) => g.id !== group.id);
  return { ...data, groups: [...rest, group].sort(byPosition) };
}

export function removeGroup(data: SheetData, groupId: string): SheetData {
  return data.groups.some((g) => g.id === groupId)
    ? { ...data, groups: data.groups.filter((g) => g.id !== groupId) }
    : data;
}

/**
 * Whether a realtime item row should replace the cached one: not while this browser has a write in flight for the
 * item (its own echo, or an older state), and never with an older row.
 */
export function shouldApplyRemote(
  local: Item | undefined,
  remote: Item,
  pending: { has(id: string): boolean },
): boolean {
  if (pending.has(remote.id)) return false;
  if (!local) return true;
  return remote.updatedAt > local.updatedAt;
}
