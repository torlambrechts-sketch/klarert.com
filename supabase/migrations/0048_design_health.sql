-- 0048_design_health.sql · Health for the Design tab and Platform › Design (docs/05 §3.8, owner decision 15 Nov 2026).
--
-- The Design area says how each automation is doing in words: "Dead letter: 2 webhooks failed", "1 run failed in 30
-- days". Members read automation_runs under RLS, but nobody reads outbound_webhooks (its URLs and payloads stay with
-- the worker), so the webhook queue's state needs a function. design_health returns AGGREGATES ONLY, per automation
-- on a sheet the caller can read: failed and partly done runs in the last 30 days among the workspace's latest 5000
-- runs, the last failure, and dead-letter and retrying deliveries in the last 30 days (at most 5000 rows). No URL,
-- payload, error text or item is returned. Bounded so it stays cheap on large workspaces.

create index if not exists outbound_webhooks_org_problem_idx
  on outbound_webhooks(org_id, created_at desc) where status in ('dead_letter', 'retrying');

create or replace function design_health(p_org uuid)
returns table (automation_id uuid, failed_runs int, partial_runs int, last_failed_at timestamptz,
               dead_letters int, retrying int)
language sql stable security definer set search_path = public as $$
  with mine as (
    select a.id from automations a
     where a.org_id = p_org and is_member(p_org)
       and a.sheet_id in (select readable_sheet_ids())
  ),
  runs as (
    select r.automation_id, r.status, r.started_at
      from (select automation_id, status, started_at from automation_runs
             where org_id = p_org order by id desc limit 5000) r
     where r.started_at > now() - interval '30 days' and r.status in ('failed', 'partial')
  ),
  hooks as (
    select w.automation_id, w.status from outbound_webhooks w
     where w.org_id = p_org and w.status in ('dead_letter', 'retrying')
       and w.created_at > now() - interval '30 days'
     order by w.created_at desc limit 5000
  )
  select m.id,
         (select count(*)::int from runs where runs.automation_id = m.id and runs.status = 'failed'),
         (select count(*)::int from runs where runs.automation_id = m.id and runs.status = 'partial'),
         (select max(runs.started_at) from runs where runs.automation_id = m.id and runs.status = 'failed'),
         (select count(*)::int from hooks where hooks.automation_id = m.id and hooks.status = 'dead_letter'),
         (select count(*)::int from hooks where hooks.automation_id = m.id and hooks.status = 'retrying')
    from mine m
$$;

revoke all on function design_health(uuid) from public, anon;
grant execute on function design_health(uuid) to authenticated;
