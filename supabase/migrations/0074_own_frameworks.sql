-- 0074_own_frameworks.sql · P8: a workspace's own frameworks (docs/12 Your own frameworks, docs/02 §17; owner decisions
-- of 16 Nov 2026).
--
-- A workspace may write its own requirement set (a customer's security schedule, internal policies, a code we don't
-- ship) and get the same library sheet, statement of applicability, coverage, Controls link, evidence and audit pack as
-- a catalogue framework. The three catalogue tables are reused with an owner column (null means our catalogue):
--
-- 1. `org_id` on frameworks, requirements and crosswalks. An own framework's key has the reserved form
--    `w<first 8 hex of the org id>-<slug>`; `(org_id is null) = (key !~ '^w[0-9a-f]{8}-')` keeps the two kinds apart, so
--    the primary key (key, version), items.requirement_ref and every `<key>@<version>#<ref>` stay unchanged and the seed
--    can never collide with a workspace's key.
-- 2. `requirements.text`: the customer's full wording (up to 4,000 characters), only in a workspace's own rows. Titles
--    stay at most 80 characters. `frameworks.titles` gains `customer`, the value of every own framework and of no
--    catalogue framework (docs/12 Licensing: customer text never enters the catalogue). The url is optional for own rows.
-- 3. Cross-walks the workspace authors (own requirement → catalogue requirement) carry `created_by` and `created_at`;
--    they are insert-only: a change retires the old row (`retired_at`, `retired_by`) and inserts a new one. A pair is
--    unique among live rows. The catalogue's cross-walks never change and are never retired.
-- 4. `packs.owner_org_id`: the library pack of an own framework belongs to its workspace (and, in P9, a private pack).
-- 5. `framework_drafts`: an own framework being written, changed freely until it is published. Owners and admins.
-- 6. Reads: `org_id is null or is_member(org_id)` on the framework tables, `owner_org_id is null or
--    is_member(owner_org_id)` on packs. Writes only through the definer RPCs below, which set `app.framework_op`
--    (own_framework_guard refuses an own row written any other way). catalogue_guard keeps its rules for both kinds of
--    row: nothing is deleted (except with its workspace), a ref, parent and kind never change within an edition.
-- 7. RPCs (SECURITY DEFINER, each checks visibility itself): publish_framework, set_crosswalk, retire_crosswalk,
--    save_framework_draft, delete_framework_draft. adopt_framework, install_pack, upgrade_pack and
--    move_framework_edition refuse another workspace's own framework or pack. Granted to `authenticated` only.

-- ───────────────────────── 1. owners ─────────────────────────
alter table frameworks   add column org_id uuid references orgs(id) on delete cascade;
alter table requirements add column org_id uuid references orgs(id) on delete cascade;
alter table crosswalks
  add column org_id     uuid references orgs(id) on delete cascade,
  add column created_by uuid references profiles(id) on delete set null,
  add column retired_at timestamptz,
  add column retired_by uuid references profiles(id) on delete set null;
alter table packs add column owner_org_id uuid references orgs(id) on delete cascade;

create index frameworks_org_idx on frameworks(org_id) where org_id is not null;
create index requirements_org_idx on requirements(org_id) where org_id is not null;
create index crosswalks_org_idx on crosswalks(org_id) where org_id is not null;
create index packs_owner_idx on packs(owner_org_id) where owner_org_id is not null;

-- the reserved key form, tied to the owner's id
alter table frameworks add constraint frameworks_owner_key
  check ((org_id is null) = (key !~ '^w[0-9a-f]{8}-')
         and (org_id is null or substr(key, 2, 8) = left(org_id::text, 8)));
alter table requirements add constraint requirements_owner_key
  check ((org_id is null) = (framework_key !~ '^w[0-9a-f]{8}-'));
-- an own requirement belongs to its framework's workspace (catalogue rows: org_id null, not checked)
alter table frameworks add constraint frameworks_key_owner unique (key, version, org_id);
alter table requirements add constraint requirements_framework_owner
  foreign key (framework_key, framework_version, org_id) references frameworks(key, version, org_id);
alter table packs add constraint packs_owner_key
  check ((owner_org_id is null) = (key !~ '^(framework-)?w[0-9a-f]{8}-')
         and (owner_org_id is null or substr(regexp_replace(key, '^framework-', ''), 2, 8) = left(owner_org_id::text, 8)));

-- ───────────────────────── 2. customer text ─────────────────────────
alter table requirements add column text text
  check (text is null or (org_id is not null and char_length(text) between 1 and 4000));
alter table frameworks drop constraint if exists frameworks_titles_check;
alter table frameworks add constraint frameworks_titles_check
  check (titles in ('own-words', 'official-short', 'customer') and ((titles = 'customer') = (org_id is not null)));
-- a workspace's own framework may have no web page
alter table frameworks alter column url drop not null;
alter table frameworks add constraint frameworks_url_owner check (url is not null or org_id is not null);

-- ───────────────────────── 3. cross-walks: who mapped it, insert-only with retire ─────────────────────────
do $$
declare c text;
begin
  -- the old unique pair (0030): a retired row must not block the pair's new row
  for c in select conname from pg_constraint where conrelid = 'crosswalks'::regclass and contype = 'u' loop
    execute format('alter table crosswalks drop constraint %I', c);
  end loop;
end $$;
-- one live row per pair; retired rows keep their own timestamps (catalogue rows are never retired)
alter table crosswalks add constraint crosswalks_live_pair
  unique nulls not distinct (from_framework, from_version, from_ref, to_framework, to_version, to_ref, retired_at);
alter table crosswalks add constraint crosswalks_owner
  check (
    case when org_id is null then
      from_framework !~ '^w[0-9a-f]{8}-' and to_framework !~ '^w[0-9a-f]{8}-'
      and created_by is null and retired_at is null and retired_by is null
    else
      (from_framework ~ '^w[0-9a-f]{8}-' or to_framework ~ '^w[0-9a-f]{8}-')
      and (from_framework !~ '^w[0-9a-f]{8}-' or substr(from_framework, 2, 8) = left(org_id::text, 8))
      and (to_framework !~ '^w[0-9a-f]{8}-' or substr(to_framework, 2, 8) = left(org_id::text, 8))
    end);
create index crosswalks_live_from_idx on crosswalks(from_framework, from_version, from_ref) where retired_at is null;

-- Reference numbers are for ever (0030), for both kinds of row: nothing is deleted (a workspace's own rows go with the
-- workspace), a requirement's ref, parent, kind and owner never change, a framework's key, version and owner never
-- change, a cross-walk never changes. The one exception: a workspace's own cross-walk is retired once, by
-- retire_crosswalk or set_crosswalk (app.framework_op), and nothing else about it changes.
create or replace function catalogue_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.org_id is not null and not exists (select 1 from orgs where id = old.org_id) then return old; end if;
    raise exception 'the requirement catalogue is append-only';
  end if;
  if tg_table_name = 'crosswalks' then
    if old.org_id is not null and old.retired_at is null and new.retired_at is not null
       and coalesce(current_setting('app.framework_op', true), '') = 'on'
       and (to_jsonb(new) - 'retired_at' - 'retired_by') = (to_jsonb(old) - 'retired_at' - 'retired_by') then
      return new;
    end if;
    raise exception 'a cross-walk never changes: add a new mapping version';
  end if;
  if tg_table_name = 'requirements' then
    if (new.framework_key, new.framework_version, new.ref, new.parent_ref, new.kind, new.org_id)
         is distinct from (old.framework_key, old.framework_version, old.ref, old.parent_ref, old.kind, old.org_id) then
      raise exception 'a requirement''s ref, parent and kind never change';
    end if;
  elsif tg_table_name = 'frameworks' then
    if (new.key, new.version, new.org_id) is distinct from (old.key, old.version, old.org_id) then
      raise exception 'a framework''s key and version never change';
    end if;
  end if;
  return new;
end $$;
revoke all on function catalogue_guard() from public, anon, authenticated;

-- A workspace's own rows are written only by the RPCs below (app.framework_op), never by the seed path or a direct
-- write. Catalogue rows (org_id null) are unaffected: the seed writes them as before.
create or replace function own_framework_guard() returns trigger language plpgsql as $$
begin
  if coalesce(to_jsonb(new)->>'org_id', to_jsonb(new)->>'owner_org_id') is not null
     and coalesce(current_setting('app.framework_op', true), '') <> 'on' then
    raise exception 'a workspace''s own framework is written only by publish_framework';
  end if;
  return new;
end $$;
revoke all on function own_framework_guard() from public, anon, authenticated;
create trigger frameworks_own_guard before insert or update on frameworks for each row execute function own_framework_guard();
create trigger requirements_own_guard before insert or update on requirements for each row execute function own_framework_guard();
create trigger crosswalks_own_guard before insert or update on crosswalks for each row execute function own_framework_guard();
create trigger packs_own_guard before insert or update on packs for each row execute function own_framework_guard();

-- ───────────────────────── 5. drafts ─────────────────────────
create table framework_drafts (
  org_id     uuid not null references orgs(id) on delete cascade,
  key        text not null check (key ~ '^w[0-9a-f]{8}-[a-z0-9][a-z0-9-]{0,29}$'),
  body       jsonb not null check (jsonb_typeof(body) = 'object'),
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (org_id, key),
  check (substr(key, 2, 8) = left(org_id::text, 8))
);
alter table framework_drafts enable row level security;
create policy framework_drafts_read on framework_drafts for select to authenticated using (is_admin(org_id));
revoke all on framework_drafts from anon;
revoke insert, update, delete, truncate on framework_drafts from authenticated;

-- ───────────────────────── 6. reads ─────────────────────────
drop policy if exists frameworks_read on frameworks;
drop policy if exists requirements_read on requirements;
drop policy if exists crosswalks_read on crosswalks;
drop policy if exists packs_read on packs;
create policy frameworks_read on frameworks for select to authenticated using (org_id is null or is_member(org_id));
create policy requirements_read on requirements for select to authenticated using (org_id is null or is_member(org_id));
create policy crosswalks_read on crosswalks for select to authenticated using (org_id is null or is_member(org_id));
create policy packs_read on packs for select to authenticated using (owner_org_id is null or is_member(owner_org_id));

-- ───────────────────────── 7. publishing ─────────────────────────
-- The owner prefix of a workspace's keys: 'w' and the first 8 hex digits of its id, then '-'.
create or replace function _own_key_prefix(p_org uuid) returns text language sql immutable as $$
  select 'w' || left(p_org::text, 8) || '-'
$$;
revoke all on function _own_key_prefix(uuid) from public, anon, authenticated, service_role;

-- Publish a workspace's own framework (docs/12 Your own frameworks). Owners and admins. p_framework is the framework
-- the server built from the draft (src/server/commands/own-frameworks.ts):
--   { key, version, revision, title, short_title, kind, source, licence, publisher, hash, rights_confirmed,
--     requirements: [{ ref, parent, kind, title, text, guidance, questions, evidence, tags }] (in order),
--     edition_mapping: [{ from_ref, to_ref, relation }] (a new edition only) }
-- p_pack is its library pack ({ key, version, title, description, manifest, hash }, frameworkToPack) and p_mappings
-- the draft's cross-walks to catalogue requirements ([{ ref, to, relation, note }], `to` a requirement key).
-- * The first publish is edition 1, revision 1. Publishing again is the next revision of the latest edition: wording
--   may change and requirements may be added, every ref stays with its parent and kind. Removing or renumbering one is
--   the next edition (revision 1): the previous edition is marked withdrawn and replaced by it, and its edition mapping
--   is written as cross-walks, so the workspace moves with move_framework_edition.
-- * Checks the key is this workspace's, the person confirmed the right to use the text and gave a source, the licence
--   and publisher are the workspace's ("Provided by <source>. Owned by <workspace>."), the limits (1 to 2,000
--   requirements, refs unique, every parent present, no cycles, a group plus at most 4 levels below it), and that the
--   pack is this framework's library: one library sheet naming the framework, nothing else.
-- * Writes the pack (owner_org_id), the framework, its requirements and the cross-walks, removes the draft and logs
--   `framework.published` (revision, hash) and `crosswalk.added` per mapping on the workspace chain. One transaction.
create or replace function publish_framework(p_org uuid, p_framework jsonb, p_pack jsonb, p_mappings jsonb default '[]')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key text := p_framework->>'key';
  v_version text := p_framework->>'version';
  v_rev int;
  v_reqs jsonb := p_framework->'requirements';
  v_org orgs; cur frameworks; latest frameworks;
  v_source text := btrim(coalesce(p_framework->>'source', ''));
  v_licence text; v_pack_key text; v_pack_version text; v_edition boolean := false;
  n_items int; n_all int; n_reached int; v_depth int; bad text; e jsonb; v_to text[]; v_id bigint;
  n_map int := 0; n_ed int := 0; m jsonb;
begin
  if not is_admin(p_org) then raise exception 'not allowed: only owners and admins publish frameworks'; end if;
  select * into v_org from orgs where id = p_org;
  if v_org.id is null then raise exception 'workspace not found'; end if;
  if v_key is null or v_key !~ '^w[0-9a-f]{8}-[a-z0-9][a-z0-9-]{0,29}$' or left(v_key, 10) <> _own_key_prefix(p_org) then
    raise exception 'publish: the key is not this workspace''s';
  end if;
  if coalesce(p_framework->>'version', '') !~ '^[1-9][0-9]{0,3}$' or coalesce(p_framework->>'revision', '') !~ '^[1-9][0-9]{0,2}$' then
    raise exception 'publish: bad version';
  end if;
  v_rev := (p_framework->>'revision')::int;
  if coalesce(p_framework->>'rights_confirmed', '') <> 'true' then
    raise exception 'publish: confirm that you have the right to use this text in this workspace';
  end if;
  if char_length(v_source) not between 1 and 300 then raise exception 'publish: give a source line (1 to 300 characters)'; end if;
  v_licence := 'Provided by ' || v_source || '. Owned by ' || v_org.name || '.';
  if p_framework->>'licence' is distinct from v_licence or p_framework->>'publisher' is distinct from v_org.name then
    raise exception 'publish: the licence note is "%"', v_licence;
  end if;

  -- ── which publish this is: the first, a revision of the latest edition, or the next edition
  select * into latest from frameworks where key = v_key order by version::int desc limit 1;
  if latest.key is not null and latest.org_id is distinct from p_org then
    raise exception 'publish: the key is not this workspace''s';
  end if;
  select * into cur from frameworks where key = v_key and version = v_version;
  if latest.key is null then
    if v_version <> '1' or v_rev <> 1 then raise exception 'publish: a new framework starts at edition 1, revision 1'; end if;
  elsif cur.key is not null then
    if cur.version <> latest.version then raise exception 'publish: only the latest edition changes'; end if;
    if v_rev <> cur.revision + 1 then
      raise exception 'publish: % changed since you opened it. Open it again', cur.title;
    end if;
    select string_agg(r.ref, ', ' order by r.position) into bad from requirements r
     where r.framework_key = v_key and r.framework_version = v_version
       and not exists (select 1 from jsonb_array_elements(v_reqs) x
                        where x->>'ref' = r.ref and nullif(x->>'parent', '') is not distinct from r.parent_ref
                          and x->>'kind' = r.kind);
    if bad is not null then
      raise exception 'publish: removing or renumbering a requirement needs a new edition (%)', left(bad, 200);
    end if;
  else
    if v_version::int <> latest.version::int + 1 or v_rev <> 1 then
      raise exception 'publish: the next edition is %, revision 1', latest.version::int + 1;
    end if;
    v_edition := true;
  end if;

  -- ── the requirements: limits, unique refs, parents, depth
  if jsonb_typeof(v_reqs) is distinct from 'array' then raise exception 'publish: no requirements'; end if;
  n_all := jsonb_array_length(v_reqs);
  select count(*) into n_items from jsonb_array_elements(v_reqs) x where x->>'kind' <> 'theme';
  if n_items not between 1 and 2000 or n_all > 4000 then
    raise exception 'publish: a framework has 1 to 2,000 requirements';
  end if;
  select string_agg(ref, ', ') into bad from (
    select x->>'ref' ref from jsonb_array_elements(v_reqs) x group by 1 having count(*) > 1) d;
  if bad is not null then raise exception 'publish: refs used twice (%)', left(bad, 200); end if;
  select string_agg(x->>'ref', ', ') into bad from jsonb_array_elements(v_reqs) x
   where nullif(x->>'parent', '') is not null
     and not exists (select 1 from jsonb_array_elements(v_reqs) y where y->>'ref' = x->>'parent');
  if bad is not null then raise exception 'publish: unknown parents (%)', left(bad, 200); end if;
  with recursive t(ref, d) as (
    select x->>'ref', 0 from jsonb_array_elements(v_reqs) x where nullif(x->>'parent', '') is null
    union all
    select x->>'ref', t.d + 1 from jsonb_array_elements(v_reqs) x join t on x->>'parent' = t.ref where t.d < 6)
  select count(distinct ref), coalesce(max(d), 0) into n_reached, v_depth from t;
  if n_reached <> n_all then raise exception 'publish: a requirement is its own parent (a cycle)'; end if;
  if v_depth > 4 then raise exception 'publish: too deep: a group and at most 4 levels below it'; end if;

  -- ── the library pack: this framework's, one library sheet, nothing else
  v_pack_key := 'framework-' || v_key || case when v_version = '1' then '' else '-' || v_version end;
  v_pack_version := v_version || '.' || v_rev || '.0';
  if p_pack->>'key' is distinct from v_pack_key or p_pack->>'version' is distinct from v_pack_version
     or coalesce(p_pack->>'hash', '') !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_pack->'manifest') is distinct from 'object'
     or p_pack->'manifest'->>'key' is distinct from v_pack_key or p_pack->'manifest'->>'version' is distinct from v_pack_version then
    raise exception 'publish: the pack is not this framework''s library';
  end if;
  if jsonb_typeof(p_pack->'manifest'->'sheets') is distinct from 'array' or jsonb_array_length(p_pack->'manifest'->'sheets') <> 1
     or (p_pack->'manifest'->'sheets'->0->>'isLibrary') is distinct from 'true'
     or p_pack->'manifest'->'sheets'->0->'framework'->>'key' is distinct from v_key
     or p_pack->'manifest'->'sheets'->0->'framework'->>'version' is distinct from v_version
     or jsonb_array_length(coalesce(p_pack->'manifest'->'automations', '[]')) > 0
     or jsonb_array_length(coalesce(p_pack->'manifest'->'dashboards', '[]')) > 0
     or jsonb_array_length(coalesce(p_pack->'manifest'->'requires', '[]')) > 0
     or jsonb_array_length(coalesce(p_pack->'manifest'->'extends', '[]')) > 0
     or jsonb_array_length(coalesce(p_pack->'manifest'->'apps', '[]')) > 0 then
    raise exception 'publish: the pack is not this framework''s library';
  end if;

  perform set_config('app.framework_op', 'on', true);
  insert into packs (key, version, title, description, manifest, hash, owner_org_id)
  values (v_pack_key, v_pack_version, left(coalesce(p_pack->>'title', ''), 120), coalesce(p_pack->>'description', ''),
          p_pack->'manifest', p_pack->>'hash', p_org);

  if cur.key is null then
    insert into frameworks (key, version, revision, title, short_title, publisher, kind, source, licence, url, titles,
                            pack_key, pack_version, hash, status, status_checked_on, org_id)
    values (v_key, v_version, v_rev, p_framework->>'title', p_framework->>'short_title', v_org.name,
            coalesce(p_framework->>'kind', 'internal'), v_source, v_licence, null, 'customer', v_pack_key, v_pack_version,
            p_framework->>'hash', 'current', current_date, p_org);
  else
    update frameworks
       set revision = v_rev, title = p_framework->>'title', short_title = p_framework->>'short_title',
           publisher = v_org.name, kind = coalesce(p_framework->>'kind', 'internal'), source = v_source,
           licence = v_licence, pack_version = v_pack_version, hash = p_framework->>'hash', status_checked_on = current_date
     where key = v_key and version = v_version;
  end if;

  -- one statement, so a child may be listed before its parent (the self reference is checked at its end)
  insert into requirements (framework_key, framework_version, ref, parent_ref, kind, position, title, text, guidance,
                            questions, evidence, tags, org_id)
  select v_key, v_version, x->>'ref', nullif(x->>'parent', ''), x->>'kind', (o - 1)::int, x->>'title',
         nullif(x->>'text', ''), nullif(x->>'guidance', ''),
         coalesce(array(select jsonb_array_elements_text(coalesce(x->'questions', '[]'))), '{}'),
         coalesce(array(select jsonb_array_elements_text(coalesce(x->'evidence', '[]'))), '{}'),
         coalesce(array(select jsonb_array_elements_text(coalesce(x->'tags', '[]'))), '{}'),
         p_org
    from jsonb_array_elements(v_reqs) with ordinality a(x, o)
  on conflict (framework_key, framework_version, ref) do update
     set position = excluded.position, title = excluded.title, text = excluded.text, guidance = excluded.guidance,
         questions = excluded.questions, evidence = excluded.evidence, tags = excluded.tags;

  -- ── a new edition: the edition mapping, and the previous edition is replaced
  if v_edition then
    for e in select x from jsonb_array_elements(coalesce(p_framework->'edition_mapping', '[]')) x loop
      if e->>'relation' not in ('equivalent', 'partial', 'related')
         or not exists (select 1 from requirements where framework_key = v_key and framework_version = latest.version
                                                    and ref = e->>'from_ref' and kind <> 'theme')
         or not exists (select 1 from requirements where framework_key = v_key and framework_version = v_version
                                                    and ref = e->>'to_ref' and kind <> 'theme') then
        raise exception 'publish: the edition mapping names a requirement that does not exist';
      end if;
      insert into crosswalks (from_framework, from_version, from_ref, to_framework, to_version, to_ref, relation, note,
                              source, org_id, created_by)
      values (v_key, latest.version, e->>'from_ref', v_key, v_version, e->>'to_ref', e->>'relation', '', 'Edition mapping',
              p_org, auth.uid())
      on conflict do nothing;
      n_ed := n_ed + 1;
    end loop;
    update frameworks set status = 'withdrawn', superseded_by = v_key || '@' || v_version, status_checked_on = current_date
     where key = v_key and version = latest.version;
  end if;

  -- ── cross-walks the draft brings (copying a catalogue framework's structure), for the person to review
  for m in select x from jsonb_array_elements(coalesce(p_mappings, '[]')) x loop
    v_to := regexp_match(coalesce(m->>'to', ''), '^([a-z0-9][a-z0-9-]{0,39})@([0-9A-Za-z.-]{1,20})#(.{1,40})$');
    if v_to is null
       or not exists (select 1 from requirements where framework_key = v_to[1] and framework_version = v_to[2]
                                                  and ref = v_to[3] and org_id is null and kind <> 'theme')
       or not exists (select 1 from requirements where framework_key = v_key and framework_version = v_version
                                                  and ref = m->>'ref' and kind <> 'theme')
       or coalesce(m->>'relation', '') not in ('equivalent', 'partial', 'related')
       or char_length(coalesce(m->>'note', '')) > 300 then
      raise exception 'publish: a mapping names a requirement that does not exist';
    end if;
    if exists (select 1 from crosswalks c where c.retired_at is null and c.org_id = p_org
                 and c.from_framework = v_key and c.from_version = v_version and c.from_ref = m->>'ref'
                 and c.to_framework = v_to[1] and c.to_version = v_to[2] and c.to_ref = v_to[3]) then
      continue;
    end if;
    insert into crosswalks (from_framework, from_version, from_ref, to_framework, to_version, to_ref, relation, note,
                            source, org_id, created_by)
    values (v_key, v_version, m->>'ref', v_to[1], v_to[2], v_to[3], m->>'relation', coalesce(m->>'note', ''),
            'Your mapping', p_org, auth.uid())
    returning id into v_id;
    insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, new_value)
    values (p_org, '', 'user', auth.uid(), 'crosswalk.added',
            jsonb_build_object('id', v_id, 'from', v_key || '@' || v_version || '#' || (m->>'ref'), 'to', m->>'to',
                               'relation', m->>'relation', 'note', coalesce(m->>'note', '')));
    n_map := n_map + 1;
  end loop;
  perform set_config('app.framework_op', '', true);

  delete from framework_drafts where org_id = p_org and key = v_key;

  insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, new_value)
  values (p_org, '', 'user', auth.uid(), 'framework.published',
          jsonb_build_object('framework', v_key, 'version', v_version, 'revision', v_rev, 'title', p_framework->>'title',
                             'hash', p_framework->>'hash', 'pack_key', v_pack_key, 'pack_version', v_pack_version,
                             'requirements', n_items, 'edition', v_edition, 'source', v_source,
                             'rights_confirmed', true, 'mappings', n_map, 'edition_mapping', n_ed));
  return jsonb_build_object('key', v_key, 'version', v_version, 'revision', v_rev, 'pack_key', v_pack_key,
                            'pack_version', v_pack_version, 'edition', v_edition, 'requirements', n_items,
                            'mappings', n_map, 'edition_mapping', n_ed);
end $$;

-- ───────────────────────── cross-walks the workspace authors ─────────────────────────
-- Map one of the workspace's own requirements to a catalogue requirement (owners and admins). The relation is
-- equivalent, partial or related. The same pair, relation and note again: nothing changes. A different relation or
-- note retires the live row (`crosswalk.retired`) and inserts a new one (`crosswalk.added`). Returns the live row's id.
create or replace function set_crosswalk(p_org uuid, p_from text, p_to text, p_relation text, p_note text default '')
returns bigint
language plpgsql security definer set search_path = public as $$
declare a text[]; b text[]; c crosswalks; v_id bigint; v_note text := btrim(coalesce(p_note, ''));
begin
  if not is_admin(p_org) then raise exception 'not allowed: only owners and admins map requirements'; end if;
  a := regexp_match(coalesce(p_from, ''), '^([a-z0-9][a-z0-9-]{0,39})@([0-9A-Za-z.-]{1,20})#(.{1,40})$');
  b := regexp_match(coalesce(p_to, ''), '^([a-z0-9][a-z0-9-]{0,39})@([0-9A-Za-z.-]{1,20})#(.{1,40})$');
  if a is null or not exists (select 1 from requirements where framework_key = a[1] and framework_version = a[2]
                                                         and ref = a[3] and org_id = p_org and kind <> 'theme') then
    raise exception 'map: not a requirement of this workspace''s own frameworks';
  end if;
  if b is null or not exists (select 1 from requirements where framework_key = b[1] and framework_version = b[2]
                                                         and ref = b[3] and org_id is null and kind <> 'theme') then
    raise exception 'map: not a requirement of the catalogue';
  end if;
  if coalesce(p_relation, '') not in ('equivalent', 'partial', 'related') then raise exception 'map: bad relation'; end if;
  if char_length(v_note) > 300 then raise exception 'map: the note is longer than 300 characters'; end if;

  select * into c from crosswalks
   where retired_at is null and org_id = p_org
     and from_framework = a[1] and from_version = a[2] and from_ref = a[3]
     and to_framework = b[1] and to_version = b[2] and to_ref = b[3]
   for update;
  if c.id is not null and c.relation = p_relation and c.note = v_note then return c.id; end if;

  perform set_config('app.framework_op', 'on', true);
  if c.id is not null then
    update crosswalks set retired_at = clock_timestamp(), retired_by = auth.uid() where id = c.id;
    insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, old_value)
    values (p_org, '', 'user', auth.uid(), 'crosswalk.retired',
            jsonb_build_object('id', c.id, 'from', p_from, 'to', p_to, 'relation', c.relation, 'note', c.note));
  end if;
  insert into crosswalks (from_framework, from_version, from_ref, to_framework, to_version, to_ref, relation, note, source,
                          org_id, created_by)
  values (a[1], a[2], a[3], b[1], b[2], b[3], p_relation, v_note, 'Your mapping', p_org, auth.uid())
  returning id into v_id;
  perform set_config('app.framework_op', '', true);
  insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, new_value)
  values (p_org, '', 'user', auth.uid(), 'crosswalk.added',
          jsonb_build_object('id', v_id, 'from', p_from, 'to', p_to, 'relation', p_relation, 'note', v_note));
  return v_id;
end $$;

-- Retire one of the workspace's own cross-walks (owners and admins); logged `crosswalk.retired`. The row stays.
create or replace function retire_crosswalk(p_org uuid, p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare c crosswalks;
begin
  if not is_admin(p_org) then raise exception 'not allowed: only owners and admins map requirements'; end if;
  select * into c from crosswalks where id = p_id and org_id = p_org and retired_at is null for update;
  if c.id is null then raise exception 'map: this mapping no longer exists'; end if;
  perform set_config('app.framework_op', 'on', true);
  update crosswalks set retired_at = clock_timestamp(), retired_by = auth.uid() where id = c.id;
  perform set_config('app.framework_op', '', true);
  insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, old_value)
  values (p_org, '', 'user', auth.uid(), 'crosswalk.retired',
          jsonb_build_object('id', c.id,
                             'from', c.from_framework || '@' || c.from_version || '#' || c.from_ref,
                             'to', c.to_framework || '@' || c.to_version || '#' || c.to_ref,
                             'relation', c.relation, 'note', c.note));
end $$;

-- ───────────────────────── drafts ─────────────────────────
-- Save a draft (owners and admins): the whole body, replacing what was there. A key already published must be this
-- workspace's own. Logged `framework.draft_saved` (key, title, how many rows), never the text.
create or replace function save_framework_draft(p_org uuid, p_key text, p_body jsonb) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_at timestamptz := now();
begin
  if not is_admin(p_org) then raise exception 'not allowed: only owners and admins write frameworks'; end if;
  if coalesce(p_key, '') !~ '^w[0-9a-f]{8}-[a-z0-9][a-z0-9-]{0,29}$' or left(p_key, 10) <> _own_key_prefix(p_org) then
    raise exception 'draft: the key is not this workspace''s';
  end if;
  if exists (select 1 from frameworks where key = p_key and org_id is distinct from p_org) then
    raise exception 'draft: the key is not this workspace''s';
  end if;
  if jsonb_typeof(p_body) is distinct from 'object' or jsonb_typeof(p_body->'requirements') is distinct from 'array' then
    raise exception 'draft: bad body';
  end if;
  insert into framework_drafts (org_id, key, body, updated_by, updated_at)
  values (p_org, p_key, p_body, auth.uid(), v_at)
  on conflict (org_id, key) do update set body = excluded.body, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, new_value)
  values (p_org, '', 'user', auth.uid(), 'framework.draft_saved',
          jsonb_build_object('key', p_key, 'title', left(coalesce(p_body->>'title', ''), 120),
                             'rows', jsonb_array_length(p_body->'requirements')));
  return v_at;
end $$;

-- Delete a draft (owners and admins); a published framework is not touched. Logged `framework.draft_deleted`.
create or replace function delete_framework_draft(p_org uuid, p_key text) returns boolean
language plpgsql security definer set search_path = public as $$
declare d framework_drafts;
begin
  if not is_admin(p_org) then raise exception 'not allowed: only owners and admins write frameworks'; end if;
  delete from framework_drafts where org_id = p_org and key = p_key returning * into d;
  if d.key is null then return false; end if;
  insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, old_value)
  values (p_org, '', 'user', auth.uid(), 'framework.draft_deleted',
          jsonb_build_object('key', d.key, 'title', left(coalesce(d.body->>'title', ''), 120)));
  return true;
end $$;

-- ───────────────────────── visibility in the definer functions that read the catalogue ─────────────────────────
-- adopt_framework (0037) with one more check: the framework is the catalogue's or this workspace's own.
create or replace function adopt_framework(p_org uuid, p_framework text, p_version text, p_plan jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare fw frameworks; out jsonb; inst uuid; lib uuid; rf uuid; bad text; n int; want int;
begin
  if not is_admin(p_org) then raise exception 'not allowed: only owners and admins adopt frameworks'; end if;
  select * into fw from frameworks where key = p_framework and version = p_version;
  if fw.key is null or (fw.org_id is not null and fw.org_id <> p_org) then raise exception 'framework not found'; end if;
  if (p_plan->'pack'->>'key', p_plan->'pack'->>'version') is distinct from (fw.pack_key, fw.pack_version) then
    raise exception 'adopt: the plan is not this framework''s library';
  end if;
  if exists (select 1 from sheets s where s.org_id = p_org and s.archived_at is null
               and s.settings->'framework'->>'key' = fw.key and s.settings->'framework'->>'version' = fw.version) then
    raise exception 'framework already adopted';
  end if;

  out := install_pack(p_org, p_plan);
  inst := (out->>'install_id')::uuid;
  select id into lib from sheets
   where pack_install_id = inst and is_library and parent_sheet_id is null
     and settings->'framework'->>'key' = fw.key and settings->'framework'->>'version' = fw.version;
  if lib is null or (select count(*) from sheets where pack_install_id = inst) <> 1 then
    raise exception 'adopt: the plan must hold exactly the framework''s library sheet';
  end if;
  rf := _library_ref_field(lib);
  if rf is null then raise exception 'adopt: the library has no Ref field'; end if;

  perform set_config('app.pack_op', 'adopt', true);
  update items i set requirement_ref = e->>'requirement_ref'
    from jsonb_array_elements(coalesce(p_plan->'items', '[]')) e
   where i.id = (e->>'id')::uuid and i.pack_install_id = inst and i.sheet_id = lib
     and nullif(e->>'requirement_ref', '') is not null;
  perform set_config('app.pack_op', '', true);

  select string_agg(coalesce(i.requirement_ref, i.display_id), ', ') into bad from items i
   where i.sheet_id = lib and (
     i.requirement_ref is null
     or not exists (select 1 from requirements r
                     where i.requirement_ref = r.framework_key || '@' || r.framework_version || '#' || r.ref
                       and r.framework_key = fw.key and r.framework_version = fw.version and r.kind <> 'theme')
     or (i."values" ->> rf::text) is distinct from split_part(i.requirement_ref, '#', 2));
  if bad is not null then raise exception 'adopt: not requirements of %: %', fw.title, left(bad, 300); end if;
  select count(*) into n from items where sheet_id = lib;
  select count(*) into want from requirements where framework_key = fw.key and framework_version = fw.version and kind <> 'theme';
  if n <> want then raise exception 'adopt: % has % requirements, the plan %', fw.title, want, n; end if;

  insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, new_value)
  values (p_org, '', 'user', auth.uid(), 'framework.adopted',
          jsonb_build_object('framework', fw.key, 'version', fw.version, 'title', fw.title, 'sheet_id', lib,
                             'install_id', inst, 'requirements', n));
  return out || jsonb_build_object('sheet_id', lib, 'requirements', n);
end $$;

-- install_pack (0044) with one more check first: the pack is the catalogue's or this workspace's own.
create or replace function install_pack(p_org uuid, p_plan jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; pk packs; e jsonb; s sheets; v_id text; n int := 0; v_list jsonb;
begin
  select * into pk from packs where key = p_plan->'pack'->>'key' and version = p_plan->'pack'->>'version';
  if pk.key is not null and pk.owner_org_id is not null and pk.owner_org_id is distinct from p_org then
    raise exception 'pack not found';
  end if;
  r := _install_pack_rows(p_org, p_plan);
  if jsonb_typeof(p_plan->'workflows') = 'array' and jsonb_array_length(p_plan->'workflows') > 0 then
    perform set_config('app.pack_op', 'install', true);
    for e in select x from jsonb_array_elements(p_plan->'workflows') x loop
      v_id := e->'workflow'->>'id';
      if jsonb_typeof(e->'workflow') is distinct from 'object' or not _pack_owns_workflow(pk.key, v_id)
         or not _wf_valid(e->'workflow') then
        raise exception 'pack plan: an approval workflow on another pack''s sheet needs an id in the pack''s namespace';
      end if;
      select * into s from sheets where id = (e->>'sheet_id')::uuid for update;
      if s.id is null or not _pack_extend_target(p_org, pk.manifest, s.id) then
        raise exception 'pack plan: approval workflows go on a sheet of a pack this one requires';
      end if;
      -- the manifest ships it on that sheet
      if not exists (
        select 1 from jsonb_array_elements(coalesce(pk.manifest->'extends', '[]')) x
                 join pack_installs pi on pi.id = s.pack_install_id and pi.pack_key = x->>'pack',
             jsonb_array_elements(coalesce(x->'workflows', '[]')) w
         where x->>'sheet' = s.pack_ref and w->>'id' = v_id) then
        raise exception 'pack plan: the pack does not ship the approval workflow % on this sheet', v_id;
      end if;
      v_list := case when jsonb_typeof(s.settings->'workflows') = 'array' then s.settings->'workflows' else '[]'::jsonb end;
      if exists (select 1 from jsonb_array_elements(v_list) w where w->>'id' = v_id) then continue; end if;
      update sheets set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{workflows}', v_list || jsonb_build_array(e->'workflow')),
                        updated_at = now()
       where id = s.id;
      n := n + 1;
    end loop;
    perform set_config('app.pack_op', '', true);
  end if;
  return r || jsonb_build_object('workflows', n);
end $$;

-- upgrade_pack (0042) behind the same check: the version it moves to is the catalogue's or the workspace's own.
-- apply_pack_upgrade calls upgrade_pack by name and so gets the check too.
alter function upgrade_pack(uuid, jsonb) rename to _upgrade_pack_rows;
revoke all on function _upgrade_pack_rows(uuid, jsonb) from public, anon, authenticated, service_role;
create or replace function upgrade_pack(p_install uuid, p_plan jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i pack_installs; pk packs;
begin
  select * into i from pack_installs where id = p_install;
  if i.id is null or not is_member(i.org_id) then raise exception 'pack install not found'; end if;
  select * into pk from packs where key = i.pack_key and version = p_plan->'pack'->>'version';
  if pk.key is not null and pk.owner_org_id is not null and pk.owner_org_id is distinct from i.org_id then
    raise exception 'pack version not found';
  end if;
  return _upgrade_pack_rows(p_install, p_plan);
end $$;

-- move_framework_edition (0037, its note made the system's by 0065) with visibility: both frameworks are the catalogue's or this workspace's own, and only
-- live cross-walks of the catalogue or of this workspace count.
create or replace function move_framework_edition(p_org uuid, p_from_sheet uuid, p_to_sheet uuid,
                                                  p_copies jsonb, p_links jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a sheets; b sheets; fa frameworks; fb frameworks; e jsonb; fi items; ti items; n_copied int := 0;
        n_links int := 0; n_locked int := 0; note text; it record;
begin
  if not is_admin(p_org) then raise exception 'not allowed: only owners and admins move a library to a new edition'; end if;
  select * into a from sheets where id = p_from_sheet and org_id = p_org and is_library and archived_at is null;
  select * into b from sheets where id = p_to_sheet and org_id = p_org and is_library and archived_at is null;
  if a.id is null or b.id is null then raise exception 'move: both libraries must be live in this workspace'; end if;
  select * into fa from frameworks where key = a.settings->'framework'->>'key' and version = a.settings->'framework'->>'version'
                                     and (org_id is null or org_id = p_org);
  select * into fb from frameworks where key = b.settings->'framework'->>'key' and version = b.settings->'framework'->>'version'
                                     and (org_id is null or org_id = p_org);
  if fa.key is null or fb.key is null or fa.key <> fb.key then raise exception 'move: not two editions of one framework'; end if;
  if fa.superseded_by is distinct from fb.key || '@' || fb.version then
    raise exception 'move: % does not replace %', fb.title, fa.title;
  end if;
  if a.settings->'framework' ? 'movedTo' then raise exception 'move: % was already moved', fa.title; end if;
  perform _need_sheet(a.id, 'editor');
  perform _need_sheet(b.id, 'editor');
  note := 'Copied from ' || fa.title || ' (move to ' || fb.title || ')';

  for e in select * from jsonb_array_elements(coalesce(p_copies, '[]')) loop
    select * into fi from items where id = (e->>'from_item')::uuid and sheet_id = a.id;
    select * into ti from items where id = (e->>'to_item')::uuid and sheet_id = b.id and archived_at is null;
    if fi.id is null or ti.id is null then raise exception 'move: an item is not in its library'; end if;
    if not exists (select 1 from crosswalks c
                    where c.relation = 'equivalent' and c.retired_at is null and (c.org_id is null or c.org_id = p_org)
                      and ((c.from_framework || '@' || c.from_version || '#' || c.from_ref = fi.requirement_ref
                            and c.to_framework || '@' || c.to_version || '#' || c.to_ref = ti.requirement_ref)
                        or (c.to_framework || '@' || c.to_version || '#' || c.to_ref = fi.requirement_ref
                            and c.from_framework || '@' || c.from_version || '#' || c.from_ref = ti.requirement_ref))) then
      raise exception 'move: % is not the same requirement as %', ti.requirement_ref, fi.requirement_ref;
    end if;
    if jsonb_typeof(e->'patch') <> 'object' then raise exception 'move: bad patch'; end if;
    -- the note is the system's, not a person's (0065)
    perform set_config('app.system_note', 'on', true);
    perform set_item_values(ti.id, e->'patch', null, null, note);
    perform set_config('app.system_note', '', true);
    n_copied := n_copied + 1;
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_links, '[]')) loop
    -- one end is a new library item that took over an old one's answers
    if not exists (select 1 from items x where x.sheet_id = b.id
                     and x.id in ((e->>'from_item')::uuid, (e->>'to_item')::uuid)) then
      raise exception 'move: a link must end at the new library';
    end if;
    perform set_item_links((e->>'field_id')::uuid, (e->>'from_item')::uuid, array[(e->>'to_item')::uuid], 'add');
    n_links := n_links + 1;
  end loop;

  -- the old library becomes read-only: its items are locked and the sheet says where the work moved
  for it in select id from items where sheet_id = a.id and archived_at is null and not locked loop
    perform set_item_lock(it.id, true, 'Moved to ' || fb.title);
    n_locked := n_locked + 1;
  end loop;
  update sheets set settings = jsonb_set(settings, '{framework,movedTo}',
                                         jsonb_build_object('sheetId', b.id, 'version', fb.version, 'title', fb.title,
                                                            'at', now()))
   where id = a.id;

  insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, new_value)
  values (p_org, '', 'user', auth.uid(), 'framework.moved',
          jsonb_build_object('framework', fa.key, 'from', fa.version, 'to', fb.version, 'from_sheet', a.id,
                             'to_sheet', b.id, 'copied', n_copied, 'links', n_links, 'locked', n_locked));
  return jsonb_build_object('copied', n_copied, 'links', n_links, 'locked', n_locked);
end $$;

-- ───────────────────────── grants (0008: nothing is executable unless granted) ─────────────────────────
revoke all on function publish_framework(uuid, jsonb, jsonb, jsonb), set_crosswalk(uuid, text, text, text, text),
  retire_crosswalk(uuid, bigint), save_framework_draft(uuid, text, jsonb), delete_framework_draft(uuid, text),
  adopt_framework(uuid, text, text, jsonb), upgrade_pack(uuid, jsonb), install_pack(uuid, jsonb),
  move_framework_edition(uuid, uuid, uuid, jsonb, jsonb)
  from public, anon;
grant execute on function publish_framework(uuid, jsonb, jsonb, jsonb), set_crosswalk(uuid, text, text, text, text),
  retire_crosswalk(uuid, bigint), save_framework_draft(uuid, text, jsonb), delete_framework_draft(uuid, text),
  adopt_framework(uuid, text, text, jsonb), upgrade_pack(uuid, jsonb), move_framework_edition(uuid, uuid, uuid, jsonb, jsonb)
  to authenticated;
-- the seed's service role installs catalogue packs (0024)
grant execute on function install_pack(uuid, jsonb) to authenticated, service_role;
