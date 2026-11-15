-- 0061_attestations.sql · Acknowledgements and signatures are recorded by the database for the person who makes them
-- (compliance review C-01).
--
-- Before: an `ack` value is a list of `{ userId, at, version }` and a `signature` value is `{ by, at, meaning, hash }`.
-- The engine accepted any person's id in an ack (a pasted JSON, or a direct call), so an editor could record that the
-- CEO had read a policy; the time came from the caller, and nothing on the server recomputed a signature's hash.
--
-- Now `_attest_value` checks every new or changed `ack` / `signature` value, wherever it is written (`items.values`
-- through `items_attestation_guard`, restricted fields' `restricted_values` through
-- `restricted_values_attestation_guard`; create_item, set_item_values, imports and automations alike):
-- * ack, for people: an entry that is new or changed must be the person's own (`userId` = the signed-in person); its
--   `at` is set by the database (UTC, milliseconds). Nobody changes or removes someone else's entry. The service role
--   (automations) may remove entries but never add or change one: an acknowledgement is made by the person who read.
-- * signature, for people: a new or changed signature must be signed as the person (`by` = the signed-in person);
--   `at` is set by the database and `hash` is recomputed by the database: sha256 of the canonical JSON (keys sorted,
--   no spaces) of the item's other values, restricted values included. The service role may clear a signature
--   (clear on change) but never sign.
-- * Clearing a signature stays open to editors, as before. Writes by the database owner (migrations, tests) are not
--   checked.

create or replace function _canonical_json(v jsonb) returns text
language sql immutable set search_path = public as $$
  select case when v is null then 'null' else case jsonb_typeof(v)
           when 'object' then '{' || coalesce((select string_agg(to_json(k)::text || ':' || _canonical_json(v -> k), ','
                                                                 order by k collate "C")
                                                 from jsonb_object_keys(v) k), '') || '}'
           when 'array' then '[' || coalesce((select string_agg(_canonical_json(e), ',' order by i)
                                                from jsonb_array_elements(v) with ordinality x(e, i)), '') || ']'
           when 'null' then 'null'
           else v::text
         end end
$$;

-- p_values: the item's values the signature covers (without the signature itself).
create or replace function _attest_value(p_type text, p_config jsonb, p_old jsonb, p_new jsonb, p_values jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare me text := auth.uid()::text; person boolean := _is_person();
        stamp text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
        old_arr jsonb; new_arr jsonb; e jsonb; prev jsonb; out jsonb := '[]'::jsonb;
begin
  if p_new is not distinct from p_old then return p_new; end if;
  if p_type = 'ack' then
    if p_new is not null and jsonb_typeof(p_new) not in ('array', 'null') then
      raise exception using errcode = '42501', message = 'access: This is not a valid acknowledgement.';
    end if;
    old_arr := case when jsonb_typeof(p_old) = 'array' then p_old else '[]'::jsonb end;
    new_arr := case when jsonb_typeof(p_new) = 'array' then p_new else '[]'::jsonb end;
    -- nobody changes or removes someone else's acknowledgement
    if person then
      for e in select x from jsonb_array_elements(old_arr) x loop
        select x into prev from jsonb_array_elements(new_arr) x
         where x ->> 'userId' = e ->> 'userId' and (x -> 'version') is not distinct from (e -> 'version') limit 1;
        if (prev is null or prev <> e) and (e ->> 'userId') is distinct from me then
          raise exception using errcode = '42501',
            message = 'access: You cannot change or remove someone else''s acknowledgement.';
        end if;
      end loop;
    end if;
    -- new or changed entries: the person's own, at the database's time
    for e in select x from jsonb_array_elements(new_arr) x loop
      prev := null;
      select x into prev from jsonb_array_elements(old_arr) x
       where x ->> 'userId' = e ->> 'userId' and (x -> 'version') is not distinct from (e -> 'version') limit 1;
      if prev is not null and prev = e then
        out := out || jsonb_build_array(e);
      elsif not person then
        raise exception using errcode = '42501',
          message = 'access: An acknowledgement is recorded only by the person who read the item.';
      elsif (e ->> 'userId') is distinct from me then
        raise exception using errcode = '42501', message = 'access: You can record only your own acknowledgement.';
      else
        out := out || jsonb_build_array(e || jsonb_build_object('at', stamp));
      end if;
    end loop;
    return case when jsonb_array_length(out) = 0 then p_new else out end;
  elsif p_type = 'signature' then
    if p_new is null or jsonb_typeof(p_new) = 'null' then return p_new; end if;   -- clearing
    if not person then
      raise exception using errcode = '42501', message = 'access: A signature is made only by the person signing.';
    end if;
    if jsonb_typeof(p_new) <> 'object' or (p_new ->> 'by') is distinct from me then
      raise exception using errcode = '42501', message = 'access: You can sign only as yourself.';
    end if;
    return jsonb_build_object(
      'by', me,
      'at', stamp,
      'meaning', left(coalesce(nullif(btrim(p_new ->> 'meaning'), ''), p_config ->> 'meaning', 'Approved'), 80),
      'hash', encode(digest(_canonical_json(coalesce(p_values, '{}'::jsonb)), 'sha256'), 'hex'));
  end if;
  return p_new;
end $$;

-- The values a signature on this item covers: its values and restricted values, without the signature field.
create or replace function _attest_payload(p_item uuid, p_values jsonb, p_field uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select (coalesce((select jsonb_object_agg(rv.field_id::text, rv.value) from restricted_values rv
                     where rv.item_id = p_item and rv.field_id <> p_field), '{}'::jsonb)
          || coalesce(p_values, '{}'::jsonb)) - p_field::text
$$;

create or replace function items_attestation_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare f record; ov jsonb; nv jsonb; k text;
begin
  if not (_is_person() or coalesce(auth.role(), '') = 'service_role') then return new; end if;
  for f in select id, type, config from fields
            where sheet_id = new.sheet_id and type in ('ack', 'signature') loop
    k := f.id::text;
    -- a restricted field's value is written to restricted_values (checked there) unless it is in this row
    if not (new."values" ? k) and not (tg_op = 'UPDATE' and old."values" ? k) then continue; end if;
    ov := case when tg_op = 'UPDATE' then old."values" -> k end;
    nv := new."values" -> k;
    if nv is not distinct from ov then continue; end if;
    nv := _attest_value(f.type, f.config, ov, nv, _attest_payload(new.id, new."values", f.id));
    if nv is null then
      new."values" := new."values" - k;
    else
      new."values" := jsonb_set(new."values", array[k], nv);
    end if;
  end loop;
  return new;
end $$;
create trigger items_attestation_guard before insert or update on items
  for each row execute function items_attestation_guard();

create or replace function restricted_values_attestation_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare f fields; vals jsonb;
begin
  if not (_is_person() or coalesce(auth.role(), '') = 'service_role') then return new; end if;
  select * into f from fields where id = new.field_id and type in ('ack', 'signature');
  if f.id is null then return new; end if;
  -- moved here from a new item's row: items_attestation_guard has checked it already
  select "values" into vals from items where id = new.item_id;
  if not found then return new; end if;
  new.value := _attest_value(f.type, f.config, case when tg_op = 'UPDATE' then old.value end, new.value,
                             _attest_payload(new.item_id, vals, f.id));
  return new;
end $$;
create trigger restricted_values_attestation_guard before insert or update on restricted_values
  for each row execute function restricted_values_attestation_guard();

revoke execute on function _canonical_json(jsonb), _attest_value(text, jsonb, jsonb, jsonb, jsonb),
  _attest_payload(uuid, jsonb, uuid), items_attestation_guard(), restricted_values_attestation_guard()
  from public, anon, authenticated;
