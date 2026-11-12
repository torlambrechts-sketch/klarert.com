-- 0009_views_forms.sql · M6: saved views, public forms and server-side filters.
-- 1. Public forms (docs/01 FR-25, NFR security): a form link serves the layout of one form view (form_links.view_id).
--    get_public_form(token) returns that layout and only the fields on it; submit_public_form(…) is the one entry
--    point for signed-out visitors: rate limit (10 submissions per minute per hashed IP, kept in Postgres so it holds
--    across serverless instances; raw IPs are never stored), honeypot, only fields on the form, then submit_form.
--    submit_form itself is no longer callable by the API roles, so the limit cannot be skipped.
-- 2. Server-side filters for sheets above 2 000 items (docs/03 §4): src/server/query/filters.ts builds a
--    parameterised WHERE clause; filter_item_ids runs it as the caller (SECURITY INVOKER, so RLS applies) after
--    checking that it only uses the tokens the builder emits (no other functions, tables or literals).

-- ───────────────────────── form links ─────────────────────────

alter table form_links add column view_id uuid references views(id) on delete cascade;
create index form_links_view_idx on form_links(view_id);

-- One row per hashed IP and minute. Not workspace data: the limit is per visitor across all forms (docs/01 §6).
-- RLS on and no policies: only the SECURITY DEFINER functions below read or write it.
create table form_rate_limits (
  ip_hash      text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (ip_hash, window_start)
);
alter table form_rate_limits enable row level security;

-- The layout a public form shows: sheet name, the form settings of its view and the fields on it (nothing else).
-- Null when the link is unknown or disabled, or its sheet is archived.
create or replace function get_public_form(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare fl form_links; s sheets; v views; g uuid; keys text[];
begin
  select * into fl from form_links where token = p_token and enabled;
  if fl.id is null then return null; end if;
  select * into s from sheets where id = fl.sheet_id and archived_at is null;
  if s.id is null then return null; end if;
  select * into v from views where id = fl.view_id;
  select coalesce(array_agg(e->>'key'), '{}') into keys
    from jsonb_array_elements(case when jsonb_typeof(v.config->'form'->'fields') = 'array'
                                   then v.config->'form'->'fields' else '[]'::jsonb end) e;
  g := coalesce(fl.group_id, (select id from groups where sheet_id = s.id order by position collate "C" limit 1));
  return jsonb_build_object(
    'sheet', jsonb_build_object('id', s.id, 'name', s.name, 'itemLabel', s.item_label, 'idPrefix', s.id_prefix,
                                'timeZone', (select time_zone from orgs where id = s.org_id)),
    'viewId', fl.view_id,
    'form', coalesce(v.config->'form', '{}'::jsonb),
    'fields', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', f.id, 'key', f.key, 'name', f.name, 'type', f.type, 'position', f.position,
                          'required', f.required, 'description', f.description, 'config', f.config,
                          'validation', f.validation) order by f.position collate "C")
                        from fields f
                       where f.sheet_id = s.id and f.archived_at is null and f.key = any(keys)), '[]'::jsonb),
    'lastPosition', (select position from items where group_id = g and archived_at is null
                      order by position collate "C" desc limit 1));
end $$;

-- The public submit. Refusals return { ok: false, reason } instead of raising so the attempt still counts against
-- the limit. p_ip_hash is SHA-256 (hex) of the visitor's IP with a server-side salt, computed by the route.
create or replace function submit_public_form(p_token text, p_ip_hash text, p_name text, p_values jsonb,
                                              p_position text, p_honeypot text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare fl form_links; n int; allowed text[]; k text; g uuid; last_pos text; pos text := p_position; it items;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  insert into form_rate_limits as r (ip_hash, window_start, hits)
  values (p_ip_hash, date_trunc('minute', now()), 1)
  on conflict (ip_hash, window_start) do update set hits = r.hits + 1
  returning hits into n;
  if random() < 0.02 then delete from form_rate_limits where window_start < now() - interval '1 hour'; end if;
  if n > 10 then return jsonb_build_object('ok', false, 'reason', 'rate_limited'); end if;
  if coalesce(p_honeypot, '') <> '' then return jsonb_build_object('ok', false, 'reason', 'rejected'); end if;

  select * into fl from form_links where token = p_token and enabled;
  if fl.id is null or not exists (select 1 from sheets where id = fl.sheet_id and archived_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if p_name is null or length(btrim(p_name)) = 0 or length(p_name) > 500
     or (p_values is not null and jsonb_typeof(p_values) <> 'object')
     or pos is null or pos !~ '^[0-9A-Za-z]{1,80}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- only the fields on the form's layout
  select coalesce(array_agg(f.id::text), '{}') into allowed
    from views v
    cross join lateral jsonb_array_elements(case when jsonb_typeof(v.config->'form'->'fields') = 'array'
                                                 then v.config->'form'->'fields' else '[]'::jsonb end) e
    join fields f on f.sheet_id = v.sheet_id and f.key = e->>'key' and f.archived_at is null
   where v.id = fl.view_id;
  for k in select jsonb_object_keys(coalesce(p_values, '{}'::jsonb)) loop
    if not (k = any(allowed)) then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  end loop;
  -- two visitors at once may send the same end position: append after the current last key instead
  g := coalesce(fl.group_id, (select id from groups where sheet_id = fl.sheet_id order by position collate "C" limit 1));
  select position into last_pos from items where group_id = g and archived_at is null
   order by position collate "C" desc limit 1;
  if last_pos is not null and pos collate "C" <= last_pos collate "C" then
    pos := last_pos || 'V';
  end if;
  it := submit_form(p_token, btrim(p_name), coalesce(p_values, '{}'::jsonb), pos);
  return jsonb_build_object('ok', true, 'id', it.id, 'display_id', it.display_id, 'sheet_id', it.sheet_id,
                            'org_id', it.org_id);
end $$;

revoke execute on function submit_form(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function get_public_form(text) to anon, authenticated;
grant execute on function submit_public_form(text, text, text, jsonb, text, text) to anon, authenticated;

-- ───────────────────────── server-side filters ─────────────────────────

-- Ids of the sheet's items matching p_where, in position order. p_where comes from src/server/query/filters.ts:
-- values only through $1 (p_params, jsonb), field ids as uuid literals. Anything else is refused before it runs.
create or replace function filter_item_ids(p_sheet uuid, p_where text, p_params jsonb) returns uuid[]
language plpgsql stable security invoker set search_path = public as $$
declare rest text := p_where; tok text; ids uuid[];
begin
  if p_where is null or length(p_where) > 20000 or (p_params is not null and jsonb_typeof(p_params) <> 'array') then
    raise exception 'bad filter';
  end if;
  foreach tok in array array[
    '\$1->>?\d+\M',
    '''[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}''',
    '''(number|array|string|boolean|object|start|end)?''',
    '::(numeric|date|text|jsonb|uuid|int)(\[\])?\M',
    '\mi\.(values|name|display_id|group_id|id)\M',
    '\mitem_links l\M', '\mfiles f\M',
    '\ml\.(field_id|from_item|to_item)\M',
    '\mf\.(field_id|item_id|replaced_by|valid_until)\M',
    '\m(and|or|not|is|null|true|false|any|exists|select|from|where|case|when|then|else|end|count|coalesce|lower|strpos|starts_with|jsonb_typeof|jsonb_array_length|jsonb_array_elements_text|array|min|max)\M',
    '\m\d+\M',
    '->>', '->', '\?\|', '\?&', '\?', '@>', '<>', '<=', '>=', '=', '<', '>', '\(', '\)', ',', '\*'
  ] loop
    rest := regexp_replace(rest, tok, ' ', 'gi');
  end loop;
  if rest !~ '^\s*$' then raise exception 'bad filter'; end if;
  execute format('select coalesce(array_agg(i.id order by i.position collate "C", i.id), ''{}'') from items i '
                 'where i.sheet_id = $2 and i.archived_at is null and (%s)', p_where)
    into ids using coalesce(p_params, '[]'::jsonb), p_sheet;
  return ids;
end $$;
grant execute on function filter_item_ids(uuid, text, jsonb) to authenticated;
