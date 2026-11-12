-- 0012_scheduler_inbox.sql · M9: the scheduler, the webhook worker, the inbox, My work and search.
-- 1. claim_schedule_occurrence: the scheduler's dedupe (docs/04 §8). `insert into scheduler_fired … on conflict do
--    nothing`, true when this call inserted the row, so a date fires exactly once per automation, item and occurrence.
--    The cron route calls it with the service role; "Run date checks now" calls it as the person, which needs an owner
--    or admin of the automation's workspace. scheduler_fired itself keeps no policies (service role only).
-- 2. claim_outbound_webhooks / record_webhook_attempt: the webhook worker (docs/04 §9). Claiming takes due
--    queued/retrying rows with `for update skip locked` and leases them for 5 minutes (next_attempt_at), so two
--    workers never send the same row. Recording an attempt sets sent / retrying (+1 attempt, the next time) /
--    dead_letter, and a dead letter tells the automation's creator in the same transaction. Service role only.
-- 3. Requests (docs/04 §5 request_update): an open `request` notification is done when the requested person next
--    changes the item. A trigger on the activity log does it in the transaction of the change itself, whatever
--    command made it (values, name, group, links, files, protected values).
-- 4. Notifications: people may mark their own notifications read and nothing else (before, the 0001 policy let them
--    rewrite any column of their own rows, e.g. done_at of a request or the body).
-- 5. items_for_people: items of a workspace where a people field holds one of the given people (My work's "Assigned
--    to me", search by person). SECURITY INVOKER: RLS on items and fields applies as usual.

-- ───────────────────────── 1. scheduler dedupe ─────────────────────────
create or replace function claim_schedule_occurrence(p_automation uuid, p_item uuid, p_occurrence text)
returns boolean language plpgsql security definer set search_path = public as $$
declare a automations; it items; n int;
begin
  select * into a from automations where id = p_automation;
  if a.id is null then raise exception 'automation not found'; end if;
  if not (coalesce(auth.role(), '') = 'service_role' or is_admin(a.org_id)) then raise exception 'not allowed'; end if;
  select * into it from items where id = p_item;
  if it.id is null or it.sheet_id <> a.sheet_id or it.archived_at is not null then
    raise exception 'item not found';
  end if;
  if p_occurrence is null or char_length(p_occurrence) not between 1 and 100 then
    raise exception 'bad occurrence';
  end if;
  insert into scheduler_fired(automation_id, item_id, occurrence) values (p_automation, p_item, p_occurrence)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- ───────────────────────── 2. webhook worker ─────────────────────────
create or replace function claim_outbound_webhooks(p_limit integer default 50)
returns setof outbound_webhooks language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'not allowed'; end if;
  return query
  update outbound_webhooks w set next_attempt_at = now() + interval '5 minutes'
   where w.id in (select x.id from outbound_webhooks x
                   where x.status in ('queued', 'retrying') and x.next_attempt_at <= now()
                   order by x.next_attempt_at, x.id
                   limit least(greatest(coalesce(p_limit, 50), 1), 50)
                   for update skip locked)
  returning w.*;
end $$;

create or replace function record_webhook_attempt(p_id uuid, p_status text, p_next_attempt_at timestamptz,
                                                  p_error text)
returns outbound_webhooks language plpgsql security definer set search_path = public as $$
declare w outbound_webhooks; a automations; it items;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'not allowed'; end if;
  if p_status not in ('sent', 'retrying', 'dead_letter') then raise exception 'bad status %', p_status; end if;
  select * into w from outbound_webhooks where id = p_id for update;
  if w.id is null then raise exception 'webhook not found'; end if;
  if w.status not in ('queued', 'retrying') then return w; end if;  -- already settled
  update outbound_webhooks
     set status = p_status,
         attempts = attempts + case when p_status = 'sent' then 0 else 1 end,
         next_attempt_at = case when p_status = 'retrying' then coalesce(p_next_attempt_at, now()) else next_attempt_at end,
         last_error = case when p_status = 'sent' then null else left(coalesce(p_error, 'Failed'), 500) end
   where id = p_id
  returning * into w;
  if p_status = 'dead_letter' and w.automation_id is not null then
    select * into a from automations where id = w.automation_id;
    if a.created_by is not null and exists (select 1 from memberships m
                                            where m.org_id = w.org_id and m.user_id = a.created_by) then
      select * into it from items where id = w.item_id;
      insert into notifications(org_id, user_id, item_id, kind, body, automation_id)
      values (w.org_id, a.created_by, it.id, 'system',
              left('Automation "' || a.name || '" could not send its webhook'
                   || coalesce(' for ' || it.display_id, '') || ' after ' || w.attempts || ' attempts: '
                   || coalesce(w.last_error, 'Failed'), 500),
              a.id);
    end if;
  end if;
  return w;
end $$;

-- ───────────────────────── 3. requests done when the person changes the item ─────────────────────────
create or replace function _request_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.actor_kind = 'user' and new.actor_id is not null and new.item_id is not null
     and new.action in ('value.changed', 'item.renamed', 'item.moved', 'link.changed', 'file.added',
                        'file.replaced', 'protected.changed', 'protected.cleared') then
    update notifications set done_at = now()
     where item_id = new.item_id and user_id = new.actor_id and kind = 'request' and done_at is null;
  end if;
  return null;
end $$;
revoke all on function _request_done() from public, anon, authenticated;
create trigger activity_request_done after insert on activity_log
  for each row execute function _request_done();

-- ───────────────────────── 4. notifications: mark read only ─────────────────────────
revoke update on notifications from authenticated, anon;
grant update (read_at) on notifications to authenticated;

-- ───────────────────────── 5. items by person ─────────────────────────
create or replace function items_for_people(p_org uuid, p_people uuid[], p_limit integer default 500)
returns setof items language sql stable security invoker set search_path = public as $$
  select i.* from items i
   where i.org_id = p_org and i.archived_at is null
     and exists (select 1 from fields f, unnest(p_people) p(id)
                  where f.sheet_id = i.sheet_id and f.type = 'people' and f.archived_at is null
                    and i."values" -> (f.id::text) @> jsonb_build_array(p.id::text))
   order by i.updated_at desc, i.id
   limit least(greatest(coalesce(p_limit, 500), 1), 2000)
$$;

-- ───────────────────────── grants ─────────────────────────
revoke all on function claim_schedule_occurrence(uuid, uuid, text) from public, anon;
grant execute on function claim_schedule_occurrence(uuid, uuid, text) to authenticated, service_role;
revoke all on function claim_outbound_webhooks(integer) from public, anon, authenticated;
grant execute on function claim_outbound_webhooks(integer) to service_role;
revoke all on function record_webhook_attempt(uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function record_webhook_attempt(uuid, text, timestamptz, text) to service_role;
revoke all on function items_for_people(uuid, uuid[], integer) from public, anon;
grant execute on function items_for_people(uuid, uuid[], integer) to authenticated, service_role;
