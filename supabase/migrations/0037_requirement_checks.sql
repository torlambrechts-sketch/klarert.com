-- Requirement checks (docs/11 Supplier management, docs/04 sync_requirement_checks): one item per pair of linked items.
--
-- A sheet may declare `settings.uniqueLinkPair = ["<link field key>", "<link field key>"]`: no two live items of the
-- sheet link to the same pair of targets through those two fields (a supplier × requirement check exists once).
--   1. A trigger on item_links refuses the link that would complete a second item with the same pair, whoever
--      writes it (a person in a cell, set_item_links, an import). Pairs are serialised with an advisory lock, so two
--      writers cannot both pass the check.
--   2. create_link_pair_items(sheet, group, rows, automation) creates items with both links in one call and skips a
--      pair that already has an item: the sync's creates are idempotent, never an error.

-- ───────────────────────── the pair guard ─────────────────────────
create or replace function _link_pair_fields(p_sheet uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select array_agg(f.id order by k.ord)
    from sheets s
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(s.settings->'uniqueLinkPair') = 'array' then s.settings->'uniqueLinkPair' else '[]'::jsonb end
    ) with ordinality k(key, ord)
    join fields f on f.sheet_id = s.id and f.key = k.key and f.archived_at is null
                 and f.type in ('link', 'requirement', 'controllink')
   where s.id = p_sheet
  having count(*) = 2
$$;

-- The other live item of the sheet holding the same pair, if any (the pair is taken from p_item's links).
create or replace function _link_pair_clash(p_item uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare it items; pair uuid[]; a uuid; b uuid; other uuid;
begin
  select * into it from items where id = p_item;
  if it.id is null or it.archived_at is not null then return null; end if;
  pair := _link_pair_fields(it.sheet_id);
  if pair is null then return null; end if;
  for a, b in
    select la.to_item, lb.to_item
      from item_links la join item_links lb on lb.from_item = la.from_item and lb.field_id = pair[2]
     where la.from_item = p_item and la.field_id = pair[1]
  loop
    perform pg_advisory_xact_lock(hashtextextended(it.sheet_id::text || ':' || a::text || ':' || b::text, 0));
    select x.id into other
      from items x
      join item_links xa on xa.from_item = x.id and xa.field_id = pair[1] and xa.to_item = a
      join item_links xb on xb.from_item = x.id and xb.field_id = pair[2] and xb.to_item = b
     where x.sheet_id = it.sheet_id and x.id <> p_item and x.archived_at is null
     limit 1;
    if other is not null then return other; end if;
  end loop;
  return null;
end $$;

create or replace function _unique_link_pair() returns trigger
language plpgsql security definer set search_path = public as $$
declare pair uuid[]; other uuid; d text;
begin
  pair := _link_pair_fields((select sheet_id from fields where id = new.field_id));
  if pair is null or not (new.field_id = any(pair)) then return new; end if;
  other := _link_pair_clash(new.from_item);
  if other is not null then
    select display_id into d from items where id = other;
    raise exception 'duplicate pair: % already links these two items', d using errcode = '23505';
  end if;
  return new;
end $$;

drop trigger if exists item_links_unique_pair on item_links;
create trigger item_links_unique_pair after insert on item_links
  for each row execute function _unique_link_pair();

-- ───────────────────────── creating pairs ─────────────────────────
-- rows: [{ "name", "position", "values": { <field id>: value }, "a": <target id>, "b": <target id> }] where a and b
-- are the targets of the sheet's uniqueLinkPair fields, in that order. At most 50 rows per call. Each row is created
-- with create_item (the caller's rights, the activity log) and linked with set_item_links (two-way inverses too),
-- unless the pair already has a live item. Returns { "created": [items], "skipped": [{ a, b, item }] }.
create or replace function create_link_pair_items(p_sheet uuid, p_group uuid, p_rows jsonb,
                                                  p_automation uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s sheets; pair uuid[]; r jsonb; a uuid; b uuid; it items; other uuid; inv uuid; tgt uuid;
        created jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb;
begin
  select * into s from sheets where id = p_sheet and archived_at is null;
  if s.id is null or not can_write(s.org_id, p_automation) then raise exception 'not allowed'; end if;
  pair := _link_pair_fields(p_sheet);
  if pair is null then raise exception 'sheet has no unique link pair'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be an array'; end if;
  if jsonb_array_length(p_rows) > 50 then raise exception 'at most 50 rows per call'; end if;
  for r in select x from jsonb_array_elements(p_rows) x loop
    a := (r->>'a')::uuid;
    b := (r->>'b')::uuid;
    if a is null or b is null then raise exception 'each row names both targets'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_sheet::text || ':' || a::text || ':' || b::text, 0));
    select x.id into other
      from items x
      join item_links xa on xa.from_item = x.id and xa.field_id = pair[1] and xa.to_item = a
      join item_links xb on xb.from_item = x.id and xb.field_id = pair[2] and xb.to_item = b
     where x.sheet_id = p_sheet and x.archived_at is null
     limit 1;
    if other is not null then
      skipped := skipped || jsonb_build_object('a', a, 'b', b, 'item', other);
      continue;
    end if;
    it := create_item(p_sheet, p_group, r->>'name', r->>'position', coalesce(r->'values', '{}'::jsonb), p_automation);
    perform set_item_links(pair[1], it.id, array[a], 'add', p_automation);
    perform set_item_links(pair[2], it.id, array[b], 'add', p_automation);
    -- two-way links: the target's inverse field links back
    for inv, tgt in
      select nullif(f.config->>'inverseFieldId', '')::uuid, t.target
        from fields f
        join (values (pair[1], a), (pair[2], b)) t(field_id, target) on t.field_id = f.id
    loop
      if inv is not null and exists (select 1 from fields where id = inv and archived_at is null) then
        perform set_item_links(inv, tgt, array[it.id], 'add', p_automation);
      end if;
    end loop;
    created := created || to_jsonb(it);
  end loop;
  return jsonb_build_object('created', created, 'skipped', skipped);
end $$;

-- ───────────────────────── grants (0008: nothing is executable unless granted) ─────────────────────────
revoke all on function _link_pair_fields(uuid), _link_pair_clash(uuid), _unique_link_pair(),
  create_link_pair_items(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function create_link_pair_items(uuid, uuid, jsonb, uuid) to authenticated, service_role;
