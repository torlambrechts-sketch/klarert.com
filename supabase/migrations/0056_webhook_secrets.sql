-- 0056_webhook_secrets.sql · Webhook addresses stay with the worker; outbound webhooks are signed
-- (security review SA-5, SA-12).
--
-- Before: a webhook action kept its address in `automations.actions[].url`, readable by everyone who can read the sheet
-- (viewers and time-boxed auditors included), and in the sheet's log (`automations.insert/update`). Slack, Teams and
-- Zapier incoming-webhook addresses are bearer secrets. Receivers had no way to tell a Klarert POST from a forged one.
--
-- Now:
-- 1. `automation_secrets (automation_id, org_id, webhook_urls {ref: url}, signing_key)`: RLS on and no policy, no
--    grants to API roles: only the service role (the runner and the webhook worker) reads it, and definer functions
--    write it. One row per automation.
-- 2. `automations_webhook_secrets` (BEFORE INSERT OR UPDATE OF actions): a webhook action's `url` is moved into
--    `automation_secrets` and replaced by `urlRef` (the key) and `urlHost` (the host, for "Send a webhook to
--    hooks.slack.com"). An action that keeps its `urlRef` keeps its address; a `urlRef` copied from another
--    automation of the workspace that the person can read (Duplicate) gets its own copy; addresses no action uses are
--    dropped. Members read only refs and hosts; the builder shows the host and asks for a new address to change it.
-- 3. `audit_schema` logs an automation's webhook addresses as their host only (`hooks.slack.com/…`).
-- 4. Log entries written before this migration that hold an address in clear are readable by owners and admins only.
-- 5. Data migration: every existing automation with a webhook address is rewritten once (the trigger moves the
--    address; the log entry shows hosts only). Runs, actions and the queue are unaffected.
-- 6. SA-12: each automation has a random `signing_key`. The worker sends `X-Klarert-Signature: t=<unix>,v1=<hex
--    HMAC-SHA256(signing_key, "<t>.<body>")>`. Owners and admins read the key with `automation_signing_key(id)`,
--    logged as `automation.key_viewed` on the sheet's chain.

create table automation_secrets (
  automation_id uuid primary key references automations(id) on delete cascade deferrable initially deferred,
  org_id uuid not null references orgs(id) on delete cascade,
  webhook_urls jsonb not null default '{}'::jsonb check (jsonb_typeof(webhook_urls) = 'object'),
  signing_key text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  created_at timestamptz not null default now()
);
alter table automation_secrets enable row level security;
revoke all on automation_secrets from anon, authenticated;
grant select on automation_secrets to service_role;
create trigger automation_secrets_tenancy_fixed before update on automation_secrets
  for each row execute function _tenancy_fixed('org_id', 'automation_id');

-- "hooks.slack.com/…": the host of an address, never its path or query
create or replace function _webhook_host(p_url text) returns text
language sql immutable set search_path = public as $$
  select coalesce(substring(p_url from '^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^@/?#]*@)?([^/:?#]+)'), 'an address that is not valid')
$$;

-- An automation row (as jsonb) with each webhook action's address reduced to its host.
create or replace function _mask_webhook_row(p_row jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select case when p_row is null or jsonb_typeof(p_row -> 'actions') is distinct from 'array' then p_row
              else jsonb_set(p_row, '{actions}', (
                select coalesce(jsonb_agg(case when a ->> 'type' = 'webhook' and a ? 'url'
                                               then jsonb_set(a, '{url}', to_jsonb(_webhook_host(a ->> 'url') || '/…'))
                                               else a end order by n), '[]'::jsonb)
                  from jsonb_array_elements(p_row -> 'actions') with ordinality x(a, n)))
         end
$$;

-- True when a logged automation row still holds a webhook address in clear (entries from before 0056).
create or replace function activity_has_webhook_url(p_old jsonb, p_new jsonb) returns boolean
language sql immutable set search_path = public as $$
  select exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_old -> 'actions') = 'array'
                                                          then p_old -> 'actions' else '[]'::jsonb end) a
                  where a ->> 'type' = 'webhook' and a ->> 'url' ~ '^https?://')
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_new -> 'actions') = 'array'
                                                          then p_new -> 'actions' else '[]'::jsonb end) a
                  where a ->> 'type' = 'webhook' and a ->> 'url' ~ '^https?://')
$$;
grant execute on function activity_has_webhook_url(jsonb, jsonb) to authenticated;

create or replace function automations_webhook_secrets() returns trigger
language plpgsql security definer set search_path = public as $$
declare acts jsonb := '[]'::jsonb; a jsonb; urls jsonb := '{}'::jsonb; prev jsonb := '{}'::jsonb; ref text;
        u text; src automations;
begin
  if jsonb_typeof(new.actions) is distinct from 'array' then return new; end if;
  if tg_op = 'UPDATE' then
    select webhook_urls into prev from automation_secrets where automation_id = old.id;
    prev := coalesce(prev, '{}'::jsonb);
  end if;
  for a in select x from jsonb_array_elements(new.actions) x loop
    if jsonb_typeof(a) = 'object' and a ->> 'type' = 'webhook' then
      u := nullif(btrim(coalesce(a ->> 'url', '')), '');
      if u is not null and u ~ '^https?://' then
        -- a new or changed address
        ref := gen_random_uuid()::text;
        urls := urls || jsonb_build_object(ref, u);
        a := (a - 'url') || jsonb_build_object('urlRef', ref, 'urlHost', _webhook_host(u));
      elsif jsonb_typeof(a -> 'urlRef') = 'string' then
        ref := a ->> 'urlRef';
        if prev ? ref then
          urls := urls || jsonb_build_object(ref, prev -> ref);
        else
          -- copied from another automation of the workspace that the person can read (Duplicate)
          u := null;
          select s.webhook_urls ->> ref into u
            from automation_secrets s join automations x on x.id = s.automation_id
           where s.webhook_urls ? ref and s.org_id = new.org_id and x.id <> new.id
             and (not _is_person() or _sheet_level_for(auth.uid(), x.sheet_id) <> 'none')
           limit 1;
          if u is not null then
            ref := gen_random_uuid()::text;
            urls := urls || jsonb_build_object(ref, u);
            a := a || jsonb_build_object('urlRef', ref, 'urlHost', _webhook_host(u));
          else
            a := a - 'urlRef' - 'urlHost';
          end if;
        end if;
        a := a - 'url';
      else
        a := a - 'url' - 'urlRef' - 'urlHost';
      end if;
    end if;
    acts := acts || jsonb_build_array(a);
  end loop;
  new.actions := acts;
  insert into automation_secrets (automation_id, org_id, webhook_urls) values (new.id, new.org_id, urls)
  on conflict (automation_id) do update set webhook_urls = excluded.webhook_urls;
  return new;
end $$;
create trigger automations_webhook_secrets before insert or update of actions on automations
  for each row execute function automations_webhook_secrets();

-- the sheets' log: addresses as hosts only
create or replace function audit_schema() returns trigger
language plpgsql security definer set search_path = public as $$
declare o uuid; s uuid; rec jsonb; old_r jsonb; new_r jsonb;
begin
  old_r := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  new_r := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  if tg_table_name = 'automations' then
    old_r := _mask_webhook_row(old_r);
    new_r := _mask_webhook_row(new_r);
  end if;
  rec := coalesce(new_r, old_r);
  -- bookkeeping columns (sequence, counters, timestamps) are not schema changes
  if tg_op = 'UPDATE' and (old_r - array['next_seq','updated_at','run_count','last_run_at'])
                        = (new_r - array['next_seq','updated_at','run_count','last_run_at']) then
    return null;
  end if;
  o := (rec->>'org_id')::uuid;
  s := case when tg_table_name = 'sheets' then (rec->>'id')::uuid else (rec->>'sheet_id')::uuid end;
  insert into activity_log(org_id, sheet_id, chain_key, actor_kind, actor_id, action, old_value, new_value)
  values (o, s, '', case when auth.uid() is null then 'system' else 'user' end, auth.uid(),
          tg_table_name || '.' || lower(tg_op), old_r, new_r);
  return null;
end $$;

-- 4. earlier log entries with an address in clear: owners and admins only
drop policy if exists activity_log_read on activity_log;
create policy activity_log_read on activity_log for select using (
  case when sheet_id is null then is_member(org_id) and (action !~~ 'folder.access%' or is_admin(org_id))
       else sheet_id in (select readable_sheet_ids()) end
  and (field_id is null or not (field_id = any ((select hidden_field_ids())::uuid[]))
       or (activity_value_masked(old_value) and activity_value_masked(new_value)))
  and (new_value is null or jsonb_typeof(new_value) <> 'object' or jsonb_typeof(new_value -> 'values') <> 'object'
       or not ((new_value -> 'values') ?| (select hidden_field_keys()))
       or not exists (select 1 from jsonb_each(activity_log.new_value -> 'values') e(key, value)
                       where e.key = any ((select hidden_field_keys())::text[]) and not activity_value_masked(e.value)))
  and (action !~~ 'automations.%' or not activity_has_webhook_url(old_value, new_value) or is_admin(org_id)));

-- 5. data migration: move existing addresses (each automation once)
update automations set actions = actions
 where exists (select 1 from jsonb_array_elements(case when jsonb_typeof(actions) = 'array' then actions
                                                       else '[]'::jsonb end) a
                where a ->> 'type' = 'webhook' and a ? 'url');
-- every automation has a key (the trigger made rows for those it touched)
insert into automation_secrets (automation_id, org_id)
select id, org_id from automations on conflict (automation_id) do nothing;

-- 6. SA-12: the signing key, for owners and admins who can edit the sheet; logged
create or replace function automation_signing_key(p_automation uuid) returns text
language plpgsql security definer set search_path = public as $$
declare a automations; k text;
begin
  select * into a from automations where id = p_automation;
  if a.id is null or not is_admin(a.org_id) then raise exception 'automation not found'; end if;
  perform _need_sheet(a.sheet_id, 'editor');
  insert into automation_secrets (automation_id, org_id) values (a.id, a.org_id) on conflict (automation_id) do nothing;
  select signing_key into k from automation_secrets where automation_id = a.id;
  insert into activity_log(org_id, sheet_id, chain_key, actor_kind, actor_id, action, new_value, note)
  values (a.org_id, a.sheet_id, '', 'user', auth.uid(), 'automation.key_viewed',
          jsonb_build_object('automation_id', a.id, 'name', a.name), a.name);
  return k;
end $$;
revoke execute on function automation_signing_key(uuid) from public, anon;
grant execute on function automation_signing_key(uuid) to authenticated;

revoke execute on function automations_webhook_secrets(), _mask_webhook_row(jsonb), _webhook_host(text)
  from public, anon, authenticated;
