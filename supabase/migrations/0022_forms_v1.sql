-- 0022_forms_v1.sql · Forms v1 (docs/02 §8, docs/05 §3.3): many forms per sheet, each a `views` row of type form
-- with its own settings in config.form and its own link. This migration makes them visible and safe:
-- 1. Source on items: source_form_id, form_version and source_channel ('public' | 'internal'), written by the
--    submit functions only, and the same facts in the hash-chained item.created entry (with notice version and
--    consent time for public submissions).
-- 2. views.form_version: every saved change to a form's name, layout or settings bumps it and logs
--    view.form_changed (who, a before/after summary) on the sheet chain, in the same transaction as the write.
-- 3. Settings enforced here, not only in the app: status (draft | open | closed), access (public | internal),
--    opensAt / closesAt, maxResponses, prefilled hidden values (set here, never taken from the visitor), people to
--    notify, and the privacy notice that must be complete and reviewed by an owner or admin before a public form can
--    open. The review stamp (who, when) is written by the trigger, not trusted from the caller.
-- 4. Links: one live link per form; create, regenerate (the old token dies at once) and disable through RPCs for
--    owners and admins, each logged. Per-link rate limit (100 an hour, 1 000 a day) on top of the per-visitor limit;
--    the visitor key is an HMAC of IP + form id made by the route (no IP or user agent is stored anywhere).
-- 5. Only owners and admins write form views and links (RLS). Editors submit internal forms (submit_internal_form).

-- ───────────────────────── columns ─────────────────────────

alter table items add column source_form_id uuid references views(id) on delete set null,
                  add column form_version int,
                  add column source_channel text check (source_channel in ('public', 'internal'));
create index items_source_form_idx on items(source_form_id) where source_form_id is not null;

alter table views add column form_version int not null default 1;
alter table form_links add column disabled_at timestamptz;

-- Per-link hits per hour (the per-link limit and the daily cap). RLS on and no policies: functions only.
create table form_link_hits (
  link_id      uuid not null references form_links(id) on delete cascade,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (link_id, window_start)
);
alter table form_link_hits enable row level security;

-- Existing forms: those with a live link were public, the rest were filled in inside the app. Public forms go back
-- to draft until an owner or admin writes and reviews the privacy notice; internal ones stay open.
update views v
   set config = jsonb_set(coalesce(v.config, '{}'::jsonb), '{form}',
                  coalesce(v.config->'form', '{"fields":[]}'::jsonb)
                  || case when exists (select 1 from form_links fl where fl.view_id = v.id and fl.enabled)
                          then '{"access":"public","status":"draft"}'::jsonb
                          else '{"access":"internal","status":"open"}'::jsonb end)
 where v.type = 'form' and not (coalesce(v.config->'form', '{}'::jsonb) ? 'status');

-- ───────────────────────── helpers (internal, never granted) ─────────────────────────

create or replace function _form_ts(t text) returns timestamptz language plpgsql stable as $$
begin
  if t is null or btrim(t) = '' then return null; end if;
  return t::timestamptz;
exception when others then return null;
end $$;

-- Field types a public form never shows: files, and the workspace directory (people, teams, roles, entities), which a
-- signed-out visitor must not see.
create or replace function _public_form_hidden_types() returns text[] language sql immutable as $$
  select array['people','team','role','entity','evidence','attachment']::text[]
$$;

-- A privacy notice is complete when every required part is filled in and the legal basis is one of the six.
create or replace function _notice_complete(n jsonb) returns boolean language sql immutable as $$
  select n is not null and jsonb_typeof(n) = 'object'
     and coalesce(btrim(n->>'purpose'), '') <> ''
     and coalesce(n->>'legalBasis', '') in ('consent','contract','legal_obligation','vital_interests','public_task',
                                            'legitimate_interests')
     and coalesce(btrim(n->>'recipients'), '') <> ''
     and coalesce(btrim(n->>'retention'), '') <> ''
     and coalesce(btrim(n->>'rights'), '') <> ''
$$;

create or replace function _notice_ok(n jsonb) returns boolean language sql immutable as $$
  select _notice_complete(n) and jsonb_typeof(n->'version') = 'number'
     and (n->>'reviewedVersion') is not null and (n->>'reviewedVersion') = (n->>'version')
$$;

-- What a form accepts right now on a channel: open, draft, closed, scheduled, full, internal_only.
create or replace function _form_state(v views, p_channel text) returns text
language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(v.config->'form', '{}'::jsonb); st text; mx int; n int;
begin
  st := coalesce(f->>'status', 'draft');
  if p_channel = 'public' and coalesce(f->>'access', 'public') <> 'public' then return 'internal_only'; end if;
  if st = 'closed' then return 'closed'; end if;
  if st <> 'open' then return 'draft'; end if;
  if p_channel = 'public' and not _notice_ok(f->'notice') then return 'draft'; end if;
  if _form_ts(f->>'opensAt') > now() then return 'scheduled'; end if;
  if _form_ts(f->>'closesAt') <= now() then return 'closed'; end if;
  if jsonb_typeof(f->'maxResponses') = 'number' then
    mx := (f->>'maxResponses')::int;
    select count(*) into n from items where source_form_id = v.id;
    if n >= mx then return 'full'; end if;
  end if;
  return 'open';
end $$;

-- A short, stable picture of a form for the log: what was asked and how it is set up (no notice text).
create or replace function _form_summary(p_name text, f jsonb, p_version int) returns jsonb
language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'name', p_name,
    'version', p_version,
    'status', coalesce(f->>'status', 'draft'),
    'access', coalesce(f->>'access', 'public'),
    'title', f->>'title',
    'fields', (select coalesce(jsonb_agg(e->>'key'), '[]'::jsonb)
                 from jsonb_array_elements(case when jsonb_typeof(f->'fields') = 'array' then f->'fields'
                                                else '[]'::jsonb end) e),
    'groupId', f->>'groupId',
    'opensAt', f->>'opensAt',
    'closesAt', f->>'closesAt',
    'maxResponses', f->'maxResponses',
    'prefill', (select jsonb_agg(e->>'key') from jsonb_array_elements(
                  case when jsonb_typeof(f->'prefill') = 'array' then f->'prefill' else '[]'::jsonb end) e),
    'notify', case when jsonb_typeof(f->'notify') = 'array' then jsonb_array_length(f->'notify') end,
    'noticeVersion', f->'notice'->'version',
    'noticeReviewed', case when f ? 'notice' then _notice_ok(f->'notice') end))
$$;

-- ───────────────────────── form views: notice review, open guard, version and log ─────────────────────────

create or replace function views_form_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare f jsonb; n jsonb; old_n jsonb; content jsonb; old_content jsonb; ver int; old_ver int; changed text;
        stamp_keys text[] := array['version','reviewedVersion','reviewedAt','reviewedBy'];
begin
  if new.type <> 'form' then return new; end if;
  f := coalesce(new.config->'form', '{}'::jsonb);
  if jsonb_typeof(f) <> 'object' then raise exception 'form: The form settings are not valid.'; end if;

  -- the privacy notice: its version moves when its words change; a review is stamped here (who, when)
  n := f->'notice';
  if n is not null and jsonb_typeof(n) = 'object' then
    old_n := case when tg_op = 'UPDATE' then old.config->'form'->'notice' end;
    content := n - stamp_keys;
    old_content := coalesce(old_n, '{}'::jsonb) - stamp_keys;
    old_ver := coalesce((old_n->>'version')::int, 0);
    if tg_op = 'INSERT' or old_n is null then
      ver := greatest(coalesce((n->>'version')::int, 1), 1);
    elsif content is distinct from old_content then
      ver := old_ver + 1;
    else
      ver := greatest(old_ver, 1);
    end if;
    n := content || jsonb_build_object('version', ver);
    if (f->'notice'->>'reviewedVersion') = ver::text and _notice_complete(n) then
      if tg_op = 'UPDATE' and (old_n->>'reviewedVersion') = ver::text and content is not distinct from old_content then
        -- already reviewed: keep the original stamp
        n := n || jsonb_build_object('reviewedVersion', ver, 'reviewedAt', old_n->'reviewedAt',
                                     'reviewedBy', old_n->'reviewedBy');
      else
        if auth.uid() is not null and not is_admin(new.org_id) then
          raise exception 'form: Only owners and admins can review a privacy notice.';
        end if;
        n := n || jsonb_build_object('reviewedVersion', ver, 'reviewedAt', to_jsonb(now()),
                                     'reviewedBy', to_jsonb(auth.uid()));
      end if;
    end if;
    f := jsonb_set(f, '{notice}', jsonb_strip_nulls(n));
    new.config := jsonb_set(coalesce(new.config, '{}'::jsonb), '{form}', f);
  end if;

  if coalesce(f->>'status', 'draft') not in ('draft', 'open', 'closed')
     or coalesce(f->>'access', 'public') not in ('public', 'internal') then
    raise exception 'form: The form settings are not valid.';
  end if;
  if coalesce(f->>'status', 'draft') = 'open' and coalesce(f->>'access', 'public') = 'public'
     and not _notice_ok(f->'notice') then
    raise exception 'form: A public form needs a complete privacy notice, reviewed by an owner or admin, before it can open.';
  end if;

  if tg_op = 'INSERT' then
    new.form_version := 1;
    insert into activity_log(org_id, sheet_id, chain_key, actor_kind, actor_id, action, new_value)
    values (new.org_id, new.sheet_id, '', case when auth.uid() is null then 'system' else 'user' end, auth.uid(),
            'view.form_created', jsonb_build_object('view_id', new.id) || _form_summary(new.name, f, 1));
    return new;
  end if;

  if old.config->'form' is distinct from new.config->'form' or old.name is distinct from new.name then
    new.form_version := old.form_version + 1;
    select string_agg(k, ', ' order by k) into changed
      from (select jsonb_object_keys(coalesce(old.config->'form', '{}'::jsonb)) k
            union select jsonb_object_keys(f)) ks
     where (old.config->'form'->k) is distinct from (f->k);
    if old.name is distinct from new.name then changed := concat_ws(', ', 'name', changed); end if;
    insert into activity_log(org_id, sheet_id, chain_key, actor_kind, actor_id, action, old_value, new_value, note)
    values (new.org_id, new.sheet_id, '', case when auth.uid() is null then 'system' else 'user' end, auth.uid(),
            'view.form_changed',
            jsonb_build_object('view_id', old.id) || _form_summary(old.name, old.config->'form', old.form_version),
            jsonb_build_object('view_id', new.id) || _form_summary(new.name, f, new.form_version),
            'Changed: ' || coalesce(changed, 'nothing'));
  else
    new.form_version := old.form_version;
  end if;
  return new;
end $$;
create trigger views_form_guard_biu before insert or update on views
  for each row execute function views_form_guard();

create or replace function views_form_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.type = 'form' and exists (select 1 from sheets where id = old.sheet_id) then
    insert into activity_log(org_id, sheet_id, chain_key, actor_kind, actor_id, action, old_value)
    values (old.org_id, old.sheet_id, '', case when auth.uid() is null then 'system' else 'user' end, auth.uid(),
            'view.form_deleted',
            jsonb_build_object('view_id', old.id) || _form_summary(old.name, old.config->'form', old.form_version));
  end if;
  return null;
end $$;
create trigger views_form_deleted_ad after delete on views for each row execute function views_form_deleted();

-- ───────────────────────── links: logged however they change ─────────────────────────

create or replace function form_links_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare op text := coalesce(current_setting('app.form_link_op', true), ''); act text;
begin
  if tg_op = 'INSERT' then
    act := case when op = 'regenerate' then 'form.link_regenerated' else 'form.link_created' end;
  elsif old.enabled and not new.enabled then
    if op = 'regenerate' then return null; end if;  -- logged once, as the new link
    act := 'form.link_disabled';
  else
    return null;
  end if;
  -- no token in the log: the log is readable by every member, the token is the form's only key
  insert into activity_log(org_id, sheet_id, chain_key, actor_kind, actor_id, action, new_value)
  values (new.org_id, new.sheet_id, '', case when auth.uid() is null then 'system' else 'user' end, auth.uid(), act,
          jsonb_build_object('view_id', new.view_id, 'link_id', new.id));
  return null;
end $$;
create trigger form_links_audit_aiu after insert or update on form_links
  for each row execute function form_links_audit();

-- ───────────────────────── RLS: owners and admins write forms and links ─────────────────────────

drop policy views_write on views;
create policy views_write on views for all
  using ((type <> 'form' and ((owner_id = auth.uid() and is_member(org_id)) or (owner_id is null and is_editor(org_id))))
         or (type = 'form' and owner_id is null and is_admin(org_id)))
  with check ((type <> 'form' and ((owner_id = auth.uid() and is_member(org_id)) or (owner_id is null and is_editor(org_id))))
              or (type = 'form' and owner_id is null and is_admin(org_id)));

drop policy form_links_write on form_links;
create policy form_links_write on form_links for all using (is_admin(org_id)) with check (is_admin(org_id));

-- ───────────────────────── creating an item from a form ─────────────────────────

-- _create_item with the form source: the source columns and the same facts in the item.created entry, one write.
create or replace function _insert_item(p_sheet uuid, p_group uuid, p_name text, p_position text, p_values jsonb,
                                        p_actor_kind text, p_actor_id uuid, p_source jsonb)
returns items language plpgsql security definer set search_path = public as $$
declare s sheets; v_seq int; it items; k text;
begin
  select * into s from sheets where id = p_sheet and archived_at is null;
  if s.id is null then raise exception 'sheet not found'; end if;
  if s.parent_sheet_id is not null then raise exception 'sheet holds sub-items: add them to an item'; end if;
  if not exists (select 1 from groups g where g.id = p_group and g.sheet_id = p_sheet) then raise exception 'group not in sheet'; end if;
  for k in select jsonb_object_keys(coalesce(p_values,'{}'::jsonb)) loop
    if not exists (select 1 from fields f where f.id::text = k and f.sheet_id = p_sheet and f.archived_at is null
                   and not (f.type = any(non_value_types()))) then
      raise exception 'field % cannot hold a value', k;
    end if;
  end loop;
  update sheets set next_seq = next_seq + 1, updated_at = now() where id = p_sheet returning next_seq - 1 into v_seq;
  insert into items(org_id, sheet_id, group_id, seq, display_id, name, "values", position, created_by, updated_by,
                    source_form_id, form_version, source_channel)
  values (s.org_id, p_sheet, p_group, v_seq, s.id_prefix || lpad(v_seq::text, greatest(3, length(v_seq::text)), '0'),
          p_name, coalesce(p_values,'{}'::jsonb), p_position, auth.uid(), auth.uid(),
          (p_source->>'form_id')::uuid, (p_source->>'form_version')::int, p_source->>'channel')
  returning * into it;
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value)
  values (it.org_id, it.sheet_id, it.id, '', p_actor_kind, p_actor_id, 'item.created',
          jsonb_build_object('name', it.name, 'group_id', it.group_id, 'values', it."values")
          || case when p_source is null then '{}'::jsonb else jsonb_build_object('source', jsonb_strip_nulls(p_source)) end);
  return it;
end $$;

create or replace function _create_item(p_sheet uuid, p_group uuid, p_name text, p_position text,
                                        p_values jsonb, p_actor_kind text, p_actor_id uuid)
returns items language sql security definer set search_path = public as $$
  select _insert_item(p_sheet, p_group, p_name, p_position, p_values, p_actor_kind, p_actor_id, null)
$$;

-- The one way a form becomes an item, for both channels. Checks the form's state, the fields on it (public: no
-- files, no directory fields), applies the hidden prefilled values, consent when the legal basis is consent, then
-- writes the item, its source and the item.created entry, and notifies the form's people. Refusals return
-- { ok: false, reason } so a public attempt still counts against the limits.
create or replace function _submit_form(p_view uuid, p_channel text, p_name text, p_values jsonb, p_position text,
                                        p_actor_kind text, p_actor_id uuid, p_consent boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v views; f jsonb; st text; allowed text[]; k text; g uuid; last_pos text; pos text := p_position;
        vals jsonb := coalesce(p_values, '{}'::jsonb); e jsonb; fid uuid; it items; src jsonb; consent_at timestamptz;
        uid text; title text;
begin
  select * into v from views where id = p_view and type = 'form' for update;
  if v.id is null or not exists (select 1 from sheets where id = v.sheet_id and archived_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  f := coalesce(v.config->'form', '{}'::jsonb);
  st := _form_state(v, p_channel);
  if st <> 'open' then return jsonb_build_object('ok', false, 'reason', st); end if;
  if p_name is null or length(btrim(p_name)) = 0 or length(p_name) > 500
     or jsonb_typeof(vals) <> 'object'
     or pos is null or pos !~ '^[0-9A-Za-z]{1,80}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- only the fields on the form's layout (public: never files or the directory)
  select coalesce(array_agg(fl.id::text), '{}') into allowed
    from jsonb_array_elements(case when jsonb_typeof(f->'fields') = 'array' then f->'fields' else '[]'::jsonb end) q
    join fields fl on fl.sheet_id = v.sheet_id and fl.key = q->>'key' and fl.archived_at is null
   where p_channel <> 'public' or not (fl.type = any(_public_form_hidden_types()));
  for k in select jsonb_object_keys(vals) loop
    if not (k = any(allowed)) then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  end loop;
  if p_channel = 'public' and f->'notice'->>'legalBasis' = 'consent' then
    if not coalesce(p_consent, false) then return jsonb_build_object('ok', false, 'reason', 'consent_required'); end if;
    consent_at := now();
  end if;
  -- hidden prefilled values: set here from the form's settings, over anything sent
  for e in select x from jsonb_array_elements(case when jsonb_typeof(f->'prefill') = 'array' then f->'prefill'
                                                   else '[]'::jsonb end) x loop
    select id into fid from fields where sheet_id = v.sheet_id and key = e->>'key' and archived_at is null
                                     and not (type = any(non_value_types()));
    if fid is not null and e ? 'value' then vals := vals || jsonb_build_object(fid::text, e->'value'); end if;
  end loop;
  -- the group: the form's, else the link's (older links), else the first
  g := (select id from groups where sheet_id = v.sheet_id and id::text = f->>'groupId');
  g := coalesce(g, (select group_id from form_links where view_id = v.id and enabled and group_id is not null limit 1),
                (select id from groups where sheet_id = v.sheet_id order by position collate "C" limit 1));
  -- two people at once may send the same end position: append after the current last key instead
  select position into last_pos from items where group_id = g and archived_at is null
   order by position collate "C" desc limit 1;
  if last_pos is not null and pos collate "C" <= last_pos collate "C" then pos := last_pos || 'V'; end if;
  src := jsonb_build_object('form_id', v.id, 'form_version', v.form_version, 'channel', p_channel,
                            'notice_version', case when p_channel = 'public' then f->'notice'->'version' end,
                            'consent_at', consent_at);
  it := _insert_item(v.sheet_id, g, btrim(p_name), pos, vals, p_actor_kind, p_actor_id, src);
  -- the people the form notifies (members of the workspace only)
  title := coalesce(nullif(btrim(f->>'title'), ''), v.name);
  for uid in select jsonb_array_elements_text(case when jsonb_typeof(f->'notify') = 'array' then f->'notify'
                                                   else '[]'::jsonb end) loop
    insert into notifications(org_id, user_id, item_id, kind, body)
    select v.org_id, m.user_id, it.id, 'notify', format('New answer to %s: %s %s', title, it.display_id, it.name)
      from memberships m where m.org_id = v.org_id and m.user_id::text = uid;
  end loop;
  return jsonb_build_object('ok', true, 'id', it.id, 'display_id', it.display_id, 'sheet_id', it.sheet_id,
                            'org_id', it.org_id, 'form_version', v.form_version);
end $$;

drop function if exists submit_public_form(text, text, text, jsonb, text, text);
drop function if exists submit_form(text, text, jsonb, text);

-- The public submit (service role, from the public form route only). p_ip_hash is HMAC-SHA-256 (hex) of the
-- visitor's IP and the form id with a server secret, made by the route; it lives here an hour at most.
create or replace function submit_public_form(p_token text, p_ip_hash text, p_name text, p_values jsonb,
                                              p_position text, p_honeypot text, p_consent boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare fl form_links; n int; day int;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  insert into form_rate_limits as r (ip_hash, window_start, hits)
  values (p_ip_hash, date_trunc('minute', now()), 1)
  on conflict (ip_hash, window_start) do update set hits = r.hits + 1
  returning hits into n;
  if random() < 0.02 then
    delete from form_rate_limits where window_start < now() - interval '1 hour';
    delete from form_link_hits where window_start < now() - interval '2 days';
  end if;
  if n > 10 then return jsonb_build_object('ok', false, 'reason', 'rate_limited'); end if;
  if coalesce(p_honeypot, '') <> '' then return jsonb_build_object('ok', false, 'reason', 'rejected'); end if;

  select * into fl from form_links where token = p_token and enabled;
  if fl.id is null or fl.view_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  -- per link: 100 an hour and 1 000 a day
  insert into form_link_hits as h (link_id, window_start, hits)
  values (fl.id, date_trunc('hour', now()), 1)
  on conflict (link_id, window_start) do update set hits = h.hits + 1
  returning hits into n;
  select coalesce(sum(hits), 0) into day from form_link_hits
   where link_id = fl.id and window_start > now() - interval '24 hours';
  if n > 100 or day > 1000 then return jsonb_build_object('ok', false, 'reason', 'rate_limited'); end if;

  return _submit_form(fl.view_id, 'public', p_name, p_values, p_position, 'form', fl.view_id, p_consent);
end $$;

-- An internal form, filled in by a signed-in editor: logged as that person, with the form as the source.
create or replace function submit_internal_form(p_view uuid, p_name text, p_values jsonb, p_position text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  select org_id into o from views where id = p_view and type = 'form';
  if o is null or not is_member(o) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not is_editor(o) then raise exception 'not allowed'; end if;
  return _submit_form(p_view, 'internal', p_name, p_values, p_position, 'user', auth.uid(), false);
end $$;

-- ───────────────────────── reading a public form ─────────────────────────

-- What a public link shows. Unknown or disabled link, or archived sheet: null. Not open: only the state and title.
-- Open: the questions and the fields on them (no files or directory fields), the notice to show, never the
-- prefilled values or the people notified.
drop function if exists get_public_form(text);
create or replace function get_public_form(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare fl form_links; s sheets; v views; f jsonb; st text; g uuid; keys text[]; title text;
begin
  select * into fl from form_links where token = p_token and enabled;
  if fl.id is null then return null; end if;
  select * into s from sheets where id = fl.sheet_id and archived_at is null;
  if s.id is null then return null; end if;
  select * into v from views where id = fl.view_id and type = 'form';
  if v.id is null then return null; end if;
  f := coalesce(v.config->'form', '{}'::jsonb);
  st := _form_state(v, 'public');
  title := coalesce(nullif(btrim(f->>'title'), ''), v.name, s.name);
  if st <> 'open' then
    return jsonb_build_object('state', st, 'viewId', v.id, 'title', title,
                              'opensAt', case when st = 'scheduled' then f->>'opensAt' end,
                              'timeZone', (select time_zone from orgs where id = s.org_id));
  end if;
  select coalesce(array_agg(e->>'key'), '{}') into keys
    from jsonb_array_elements(case when jsonb_typeof(f->'fields') = 'array' then f->'fields' else '[]'::jsonb end) e;
  g := coalesce((select id from groups where sheet_id = s.id and id::text = f->>'groupId'), fl.group_id,
                (select id from groups where sheet_id = s.id order by position collate "C" limit 1));
  return jsonb_build_object(
    'state', 'open',
    'title', title,
    'sheet', jsonb_build_object('id', s.id, 'name', s.name, 'itemLabel', s.item_label, 'idPrefix', s.id_prefix,
                                'timeZone', (select time_zone from orgs where id = s.org_id)),
    'controller', (select name from orgs where id = s.org_id),
    'viewId', v.id,
    'formVersion', v.form_version,
    'form', jsonb_strip_nulls(jsonb_build_object('title', f->'title', 'description', f->'description',
                                                 'nameLabel', f->'nameLabel', 'fields', coalesce(f->'fields', '[]'),
                                                 'confirmation', f->'confirmation', 'access', 'public',
                                                 'status', 'open')),
    'notice', jsonb_strip_nulls(jsonb_build_object('purpose', f->'notice'->'purpose',
                                'legalBasis', f->'notice'->'legalBasis', 'recipients', f->'notice'->'recipients',
                                'retention', f->'notice'->'retention', 'rights', f->'notice'->'rights',
                                'url', f->'notice'->'url', 'version', f->'notice'->'version')),
    'fields', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', fd.id, 'key', fd.key, 'name', fd.name, 'type', fd.type, 'position', fd.position,
                          'required', fd.required, 'description', fd.description, 'config', fd.config,
                          'validation', fd.validation) order by fd.position collate "C")
                        from fields fd
                       where fd.sheet_id = s.id and fd.archived_at is null and fd.key = any(keys)
                         and not (fd.type = any(_public_form_hidden_types()))), '[]'::jsonb),
    'lastPosition', (select position from items where group_id = g and archived_at is null
                      order by position collate "C" desc limit 1));
end $$;

-- ───────────────────────── links (owners and admins) ─────────────────────────

create or replace function _form_for_link(p_view uuid) returns views
language plpgsql stable security definer set search_path = public as $$
declare v views;
begin
  select * into v from views where id = p_view and type = 'form';
  if v.id is null or not is_member(v.org_id) then raise exception 'form: This form no longer exists.'; end if;
  if not is_admin(v.org_id) then raise exception 'not allowed'; end if;
  if v.owner_id is not null then raise exception 'form: Share this form before you publish a link.'; end if;
  return v;
end $$;

-- The form's live link, created when it has none.
create or replace function form_link_create(p_view uuid) returns form_links
language plpgsql security definer set search_path = public as $$
declare v views := _form_for_link(p_view); fl form_links;
begin
  select * into fl from form_links where view_id = v.id and enabled order by created_at desc limit 1;
  if fl.id is not null then return fl; end if;
  insert into form_links(org_id, sheet_id, view_id, created_by) values (v.org_id, v.sheet_id, v.id, auth.uid())
  returning * into fl;
  return fl;
end $$;

-- A new token; every older link of the form stops working in the same transaction.
create or replace function form_link_regenerate(p_view uuid) returns form_links
language plpgsql security definer set search_path = public as $$
declare v views := _form_for_link(p_view); fl form_links;
begin
  perform set_config('app.form_link_op', 'regenerate', true);
  update form_links set enabled = false, disabled_at = now() where view_id = v.id and enabled;
  insert into form_links(org_id, sheet_id, view_id, created_by) values (v.org_id, v.sheet_id, v.id, auth.uid())
  returning * into fl;
  perform set_config('app.form_link_op', '', true);
  return fl;
end $$;

-- The kill switch: no live link until a new one is created.
create or replace function form_link_disable(p_view uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v views := _form_for_link(p_view); n int;
begin
  update form_links set enabled = false, disabled_at = now() where view_id = v.id and enabled;
  get diagnostics n = row_count;
  return n;
end $$;

-- Responses per form of a sheet (cards in the Forms list). Runs as the caller: RLS decides what is counted.
create or replace function form_stats(p_sheet uuid)
returns table (view_id uuid, responses bigint, last_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select i.source_form_id, count(*), max(i.created_at) from items i
   where i.sheet_id = p_sheet and i.source_form_id is not null
   group by i.source_form_id
$$;

-- ───────────────────────── grants ─────────────────────────

revoke execute on function _form_ts(text), _public_form_hidden_types(), _notice_complete(jsonb), _notice_ok(jsonb),
  _form_state(views, text), _form_summary(text, jsonb, int), _form_for_link(uuid),
  _insert_item(uuid, uuid, text, text, jsonb, text, uuid, jsonb),
  _submit_form(uuid, text, text, jsonb, text, text, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function _create_item(uuid, uuid, text, text, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function _create_item(uuid, uuid, text, text, jsonb, text, uuid) to service_role;
revoke execute on function views_form_guard(), views_form_deleted(), form_links_audit() from public, anon, authenticated;

grant execute on function get_public_form(text) to anon, authenticated;
revoke execute on function submit_public_form(text, text, text, jsonb, text, text, boolean) from public, anon, authenticated;
grant execute on function submit_public_form(text, text, text, jsonb, text, text, boolean) to service_role;
revoke execute on function submit_internal_form(uuid, text, jsonb, text) from public, anon;
grant execute on function submit_internal_form(uuid, text, jsonb, text) to authenticated;
revoke execute on function form_link_create(uuid), form_link_regenerate(uuid), form_link_disable(uuid),
  form_stats(uuid) from public, anon;
grant execute on function form_link_create(uuid), form_link_regenerate(uuid), form_link_disable(uuid),
  form_stats(uuid) to authenticated;
