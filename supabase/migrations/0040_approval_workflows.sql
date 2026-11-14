-- 0040_approval_workflows.sql · Multi-step approval workflows (owner approved; docs/02 §19, docs/04 §13).
-- 1. Definitions are data per sheet: sheets.settings.workflows (an array, shape in src/engine/approvals/definition.ts).
--    Only owners and admins change them (sheets_workflows_guard); a person who is not an admin creating a sheet (a
--    copy) gets it without workflows. Packs write them through install_pack and upgrade_pack (app.pack_op).
-- 2. workflow_instances: one run of a workflow on one item, with a copy of the definition and the approvers of every
--    step fixed at submit. At most one in progress per item. workflow_decisions: one row per decision, insert-only.
--    Both are read under the item's sheet access and written only by the RPCs below.
-- 3. workflow_submit / workflow_decide / workflow_withdraw write the instance, the decision, the item's own changes
--    (the workflow step field, the status the workflow sets, the lock) and the activity log entries in one
--    transaction, so every decision is in the item's hash chain (who, step, decision, comment, time).
-- 4. Approvers need read access to the item: one without it is reported when the item is submitted, never skipped.
--    The person who submitted cannot approve their own submission unless the definition says allowSelfApproval.
--    Approvers may hold only view access: the item's own changes are written with app.workflow_op, which the items
--    access guard lets through for the transaction (the RPC has checked who may act).

-- ───────────────────────── tables ─────────────────────────
create table workflow_instances (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  sheet_id        uuid not null references sheets(id) on delete cascade,
  item_id         uuid not null references items(id) on delete cascade,
  workflow_id     text not null,
  definition      jsonb not null,
  status          text not null default 'in_progress'
                  check (status in ('in_progress', 'approved', 'rejected', 'withdrawn')),
  step_index      int,
  round           int not null default 1,
  step_started_at timestamptz,
  step_due_at     timestamptz,
  -- the approvers of every step, fixed at submit: [[user id, …], …]
  approvers       jsonb not null,
  -- the current step's approvers (the inbox reads it)
  step_approvers  uuid[] not null default '{}',
  submitted_by    uuid,
  submitted_at    timestamptz not null default now(),
  submit_comment  text check (char_length(submit_comment) <= 2000),
  automation_id   uuid,
  ended_at        timestamptz,
  ended_by        uuid,
  end_reason      text check (end_reason in ('approved', 'draft', 'closed', 'withdrawn')),
  check ((status = 'in_progress') = (ended_at is null)),
  check ((status = 'in_progress') = (step_index is not null))
);
create unique index workflow_instances_live_key on workflow_instances(item_id) where status = 'in_progress';
create index workflow_instances_item_idx on workflow_instances(item_id, submitted_at desc);
create index workflow_instances_sheet_live_idx on workflow_instances(sheet_id) where status = 'in_progress';
create index workflow_instances_approvers_idx on workflow_instances using gin (step_approvers)
  where status = 'in_progress';

create table workflow_decisions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  instance_id uuid not null references workflow_instances(id) on delete cascade,
  item_id     uuid not null,
  step_index  int not null,
  step_id     text not null,
  step_name   text not null,
  round       int not null,
  user_id     uuid not null,
  decision    text not null check (decision in ('approved', 'rejected')),
  comment     text check (char_length(comment) <= 2000),
  decided_at  timestamptz not null default now(),
  unique (instance_id, step_index, round, user_id)
);
create index workflow_decisions_instance_idx on workflow_decisions(instance_id, decided_at);

-- decisions are never changed; only the workspace purge deletes (as activity_log)
create or replace function workflow_decisions_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('app.purge_org', true) = old.org_id::text then return old; end if;
  raise exception 'workflow_decisions is append-only';
end $$;
create trigger workflow_decisions_no_change before update or delete on workflow_decisions
  for each row execute function workflow_decisions_append_only();

alter table workflow_instances enable row level security;
alter table workflow_decisions enable row level security;
revoke insert, update, delete, truncate on workflow_instances, workflow_decisions from anon, authenticated;
create policy workflow_instances_read on workflow_instances for select using (
  is_member(org_id) and sheet_id in (select readable_sheet_ids()));
create policy workflow_decisions_read on workflow_decisions for select using (
  is_member(org_id) and instance_id in (select id from workflow_instances));

-- ───────────────────────── who changes definitions ─────────────────────────
create or replace function sheets_workflows_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.pack_op', true), '') <> '' or not _is_person() then return new; end if;
  if tg_op = 'INSERT' then
    -- a copy made by someone who is not an admin starts without approval workflows
    if new.settings ? 'workflows' and not is_admin(new.org_id) then
      new.settings := new.settings - 'workflows';
    end if;
  elsif (old.settings -> 'workflows') is distinct from (new.settings -> 'workflows') and not is_admin(new.org_id) then
    raise exception 'not allowed: only owners and admins change approval workflows';
  end if;
  return new;
end $$;
create trigger sheets_workflows_guard before insert or update on sheets
  for each row execute function sheets_workflows_guard();

-- the approval RPCs write the item for approvers who may only view it (they checked who may act)
create or replace function items_access_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.workflow_op', true), '') = 'on' then return new; end if;
  perform _need_sheet(new.sheet_id, 'editor');
  return new;
end $$;

-- ───────────────────────── helpers (internal) ─────────────────────────
create or replace function _wf_definition(p_sheet uuid, p_workflow text) returns jsonb
language sql stable security definer set search_path = public as $$
  select w from sheets s,
         jsonb_array_elements(case when jsonb_typeof(s.settings->'workflows') = 'array'
                                   then s.settings->'workflows' else '[]'::jsonb end) w
   where s.id = p_sheet and w->>'id' = p_workflow
   limit 1
$$;

-- The definition holds what the database relies on: steps, approver rules, modes and rejection targets.
create or replace function _wf_valid(p_def jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(p_def->'steps') = 'array' and jsonb_array_length(p_def->'steps') between 1 and 10
     and not exists (
       select 1 from jsonb_array_elements(p_def->'steps') s
        where coalesce(s->>'id', '') = '' or coalesce(s->>'name', '') = ''
           or coalesce(s->'approvers'->>'kind', '') not in ('people', 'field', 'jobRole', 'team')
           or coalesce(s->>'mode', '') not in ('any', 'all')
           or coalesce(s->'onReject'->>'to', '') not in ('step', 'draft', 'close'))
$$;

-- Live members a rule names on an item now (sorted, no duplicates).
create or replace function _wf_resolve(p_item items, p_rule jsonb) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare f fields; v jsonb; role_name text; team uuid; out uuid[];
begin
  case p_rule->>'kind'
    when 'people' then
      select array_agg(m.user_id order by m.user_id) into out from memberships m
       where m.org_id = p_item.org_id and (m.expires_at is null or m.expires_at > now())
         and m.user_id::text in (select jsonb_array_elements_text(
               case when jsonb_typeof(p_rule->'userIds') = 'array' then p_rule->'userIds' else '[]'::jsonb end));
    when 'field' then
      select * into f from fields where sheet_id = p_item.sheet_id and key = p_rule->>'fieldKey'
                                    and archived_at is null and type = 'people';
      if f.id is null then return '{}'; end if;
      v := _full_values(p_item.id, p_item."values") -> f.id::text;
      select array_agg(m.user_id order by m.user_id) into out from memberships m
       where m.org_id = p_item.org_id and (m.expires_at is null or m.expires_at > now())
         and m.user_id::text in (select jsonb_array_elements_text(
               case when jsonb_typeof(v) = 'array' then v when jsonb_typeof(v) = 'string' then jsonb_build_array(v)
                    else '[]'::jsonb end));
    when 'jobRole' then
      role_name := coalesce((select name from job_roles where org_id = p_item.org_id
                                                          and id::text = p_rule->>'roleId'), p_rule->>'roleName');
      select array_agg(m.user_id order by m.user_id) into out from memberships m
       where m.org_id = p_item.org_id and (m.expires_at is null or m.expires_at > now())
         and lower(btrim(m.job_title)) = lower(btrim(role_name));
    when 'team' then
      team := coalesce((select id from teams where org_id = p_item.org_id and id::text = p_rule->>'teamId'),
                       (select id from teams where org_id = p_item.org_id
                         and lower(btrim(name)) = lower(btrim(p_rule->>'teamName')) limit 1));
      select array_agg(m.user_id order by m.user_id) into out from team_members t
        join memberships m on m.org_id = t.org_id and m.user_id = t.user_id
                          and (m.expires_at is null or m.expires_at > now())
       where t.team_id = team;
    else
      return '{}';
  end case;
  return coalesce(out, '{}');
end $$;

-- "Required before submit": a stored value that is not empty, a link, or a current file.
create or replace function _wf_filled(p_item items, p_field fields) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if p_field.type in ('link', 'requirement', 'controllink') then
    return exists (select 1 from item_links where field_id = p_field.id and from_item = p_item.id);
  end if;
  if p_field.type in ('evidence', 'attachment') then
    return exists (select 1 from files where field_id = p_field.id and item_id = p_item.id
                                          and replaced_by is null and archived_at is null);
  end if;
  v := _full_values(p_item.id, p_item."values") -> p_field.id::text;
  return not (v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb or v = '{}'::jsonb
              or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = ''));
end $$;

-- Set an option field of the item (in memory) to an option it has, logging the change as the actor. Restricted and
-- unknown fields and options that no longer exist are left alone. Returns the item.
create or replace function _wf_set_option(it items, p_field_key text, p_option text, p_actor_kind text,
                                          p_actor uuid, p_note text) returns items
language plpgsql security definer set search_path = public as $$
declare f fields; old_v jsonb; new_v jsonb;
begin
  if p_field_key is null or coalesce(p_option, '') = '' then return it; end if;
  select * into f from fields where sheet_id = it.sheet_id and key = p_field_key and archived_at is null
                                and restricted_to is null;
  if f.id is null or not exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(f.config->'options') = 'array'
                                            then f.config->'options' else '[]'::jsonb end) o
     where o->>'id' = p_option) then
    return it;
  end if;
  old_v := it."values" -> f.id::text;
  new_v := to_jsonb(p_option);
  if old_v is not distinct from new_v then return it; end if;
  it."values" := jsonb_set(it."values", array[f.id::text], new_v, true);
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, field_id,
                           old_value, new_value, note)
  values (it.org_id, it.sheet_id, it.id, '', p_actor_kind, p_actor, 'value.changed', f.id, old_v, new_v, p_note);
  return it;
end $$;

-- The item's changes of one approval move, saved: the step field, the status the workflow sets (the documents
-- register's approval rules and the sub-item close gate apply as for a person's edit), and the lock. Returns
-- [{ field_id, before, after }] for the automation events.
create or replace function _wf_apply(p_item uuid, p_def jsonb, p_step_option text, p_status_option text,
                                     p_lock boolean, p_actor_kind text, p_actor uuid, p_automation uuid,
                                     p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it items; before jsonb; sf fields; settings jsonb; open text[]; label text; listed text; k text;
        changes jsonb := '[]'::jsonb; reason text;
begin
  select * into it from items where id = p_item for update;
  before := it."values";
  it := _wf_set_option(it, p_def->'stepField'->>'fieldKey', p_step_option, p_actor_kind, p_actor, null);
  it := _wf_set_option(it, p_def->'statusField'->>'fieldKey', p_status_option, p_actor_kind, p_actor, p_note);
  -- the sub-item close gate (0020), as set_item_values
  settings := case when it.parent_id is null then _subitem_settings(it.sheet_id) else '{}'::jsonb end;
  if coalesce((settings->>'blockClose')::boolean, false) then
    sf := _status_field(it.sheet_id);
    if sf.id is not null and _option_done(sf, it."values" -> sf.id::text)
       and not _option_done(sf, before -> sf.id::text) then
      open := _open_subitems(it.id);
      if cardinality(open) > 0 then
        label := coalesce(nullif(settings->>'label', ''), 'Sub-items');
        listed := array_to_string(open[1:5], ', ')
                  || case when cardinality(open) > 5 then ' and ' || (cardinality(open) - 5) || ' more' else '' end;
        raise exception 'subitems open: % still open: %. Close them before closing %.', label, listed, it.display_id;
      end if;
    end if;
  end if;
  if _document_register(it.sheet_id) then
    it := _document_transition(it, before, p_automation, p_note);
  end if;
  for k in select keys.x from (select jsonb_object_keys(before) x union select jsonb_object_keys(it."values")) keys loop
    if (before -> k) is distinct from (it."values" -> k) then
      changes := changes || jsonb_build_array(jsonb_build_object('field_id', k, 'before', before -> k,
                                                                  'after', it."values" -> k));
    end if;
  end loop;
  if p_lock and not it.locked then
    reason := 'Approved: ' || coalesce(p_def->>'name', 'approval');
    it.locked := true;
    it.lock_reason := reason;
    insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, note)
    values (it.org_id, it.sheet_id, it.id, '', p_actor_kind, p_actor, 'item.locked', reason);
  end if;
  if jsonb_array_length(changes) > 0 or p_lock then
    perform set_config('app.workflow_op', 'on', true);
    update items set "values" = it."values", locked = it.locked, lock_reason = it.lock_reason,
                     updated_at = now(), updated_by = coalesce(auth.uid(), updated_by)
     where id = it.id;
    perform set_config('app.workflow_op', '', true);
  end if;
  return changes;
end $$;

create or replace function _wf_step_option(p_def jsonb, p_index int) returns text
language sql immutable as $$
  select nullif(p_def->'steps'->p_index->>'optionId', '')
$$;

-- Notify people about an item (the notifications guard drops anyone who cannot read it).
create or replace function _wf_notify(it items, p_users uuid[], p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications(org_id, user_id, item_id, kind, body)
  select it.org_id, u, it.id, 'notify', left(p_body, 500)
    from (select distinct unnest(p_users) u) x where u is not null
     and exists (select 1 from memberships m where m.org_id = it.org_id and m.user_id = x.u);
end $$;

create or replace function _wf_uuids(p jsonb) returns uuid[]
language sql immutable as $$
  select coalesce(array_agg(x::uuid), '{}') from jsonb_array_elements_text(
    case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) x
$$;

-- ───────────────────────── submit ─────────────────────────
-- A person (an editor of the sheet; owners and admins also on a locked item) or the automation runner
-- (p_automation, service role: the start_workflow action, p_submitter = the person who started the chain).
create or replace function workflow_submit(p_item uuid, p_workflow text, p_comment text default null,
                                           p_automation uuid default null, p_submitter uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it items; def jsonb; submitter uuid; actor_kind text; actor uuid; problems text[] := '{}';
        f fields; k text; names text[]; s jsonb; i int := 0; ids uuid[]; all_ids jsonb := '[]'::jsonb;
        blocked text; self_out boolean; inst workflow_instances; due timestamptz; changes jsonb;
        n int; tz text;
begin
  select * into it from items where id = p_item and archived_at is null for update;
  if it.id is null then raise exception 'item not found'; end if;
  if not can_write(it.org_id, p_automation) then raise exception 'not allowed'; end if;
  if p_automation is null then
    if auth.uid() is null then raise exception 'not allowed'; end if;
    perform _need_sheet(it.sheet_id, 'editor');
    if it.locked and not is_admin(it.org_id) then
      raise exception 'item locked: %', coalesce(it.lock_reason, 'approved');
    end if;
    submitter := auth.uid();
    actor_kind := 'user';
    actor := auth.uid();
  else
    submitter := (select m.user_id from memberships m where m.org_id = it.org_id and m.user_id = p_submitter);
    actor_kind := 'automation';
    actor := p_automation;
  end if;
  if char_length(p_comment) > 2000 then raise exception 'approval: keep the comment under 2000 characters.'; end if;
  def := _wf_definition(it.sheet_id, p_workflow);
  if def is null then raise exception 'approval: this approval workflow no longer exists.'; end if;
  if not _wf_valid(def) then raise exception 'approval: % is not set up correctly. Check its steps.', def->>'name'; end if;
  if not coalesce((def->>'enabled')::boolean, false) then
    raise exception 'approval: % is turned off.', def->>'name';
  end if;
  if exists (select 1 from workflow_instances where item_id = it.id and status = 'in_progress') then
    raise exception 'approval: this item is already waiting for approval.';
  end if;

  -- required fields
  names := '{}';
  for k in select jsonb_array_elements_text(case when jsonb_typeof(def->'requiredFields') = 'array'
                                                 then def->'requiredFields' else '[]'::jsonb end) loop
    select * into f from fields where sheet_id = it.sheet_id and key = k and archived_at is null;
    if f.id is not null and not _wf_filled(it, f) then names := names || f.name; end if;
  end loop;
  if cardinality(names) > 0 then
    problems := problems || ('Fill in ' || case when cardinality(names) = 1 then names[1]
                             else array_to_string(names[1:cardinality(names) - 1], ', ') || ' and ' || names[cardinality(names)] end
                             || ' before submitting.');
  end if;

  -- approvers of every step, fixed now; nobody skipped silently
  for s in select x from jsonb_array_elements(def->'steps') x loop
    i := i + 1;
    ids := _wf_resolve(it, s->'approvers');
    self_out := false;
    if submitter is not null and submitter = any(ids) and not coalesce((def->>'allowSelfApproval')::boolean, false) then
      ids := array_remove(ids, submitter);
      self_out := true;
    end if;
    if cardinality(ids) = 0 then
      problems := problems || ('Step ' || i || ', ' || (s->>'name') || ': ' ||
        case when self_out then 'you are the only approver and cannot approve your own submission.'
             else 'no one can approve it.' end);
    else
      select string_agg(p.display_name, ', ' order by p.display_name) into blocked
        from unnest(ids) u join profiles p on p.id = u
       where _sheet_level_for(u, it.sheet_id) = 'none';
      if blocked is not null then
        problems := problems || ('Step ' || i || ', ' || (s->>'name') || ': ' || blocked
                                 || ' cannot open this sheet. Give them access or change the approvers.');
      end if;
      select string_agg(p.display_name, ', ' order by p.display_name) into blocked
        from unnest(ids) u join profiles p on p.id = u
        join memberships m on m.org_id = it.org_id and m.user_id = u
       where m.role = 'auditor';
      if blocked is not null then
        problems := problems || ('Step ' || i || ', ' || (s->>'name') || ': ' || blocked
                                 || ' can only view as an auditor. Change the approvers.');
      end if;
    end if;
    all_ids := all_ids || jsonb_build_array(to_jsonb(ids));
  end loop;
  if cardinality(problems) > 0 then
    raise exception 'approval: %', array_to_string(problems, ' ');
  end if;

  due := case when def->'steps'->0->'sla' is not null and jsonb_typeof(def->'steps'->0->'sla') = 'object'
              then now() + make_interval(hours => ((def->'steps'->0->'sla'->>'amount')::int
                                                  * case when def->'steps'->0->'sla'->>'unit' = 'days' then 24 else 1 end))
         end;
  insert into workflow_instances(org_id, sheet_id, item_id, workflow_id, definition, status, step_index, round,
                                 step_started_at, step_due_at, approvers, step_approvers, submitted_by,
                                 submit_comment, automation_id)
  values (it.org_id, it.sheet_id, it.id, def->>'id', def, 'in_progress', 0, 1, now(), due, all_ids,
          _wf_uuids(all_ids->0), submitter, nullif(btrim(coalesce(p_comment, '')), ''), p_automation)
  returning * into inst;
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value, note)
  values (it.org_id, it.sheet_id, it.id, '', actor_kind, actor, 'workflow.submitted',
          jsonb_build_object('instance_id', inst.id, 'workflow_id', def->>'id', 'workflow', def->>'name',
                             'submitted_by', submitter,
                             'steps', (select jsonb_agg(x->>'name') from jsonb_array_elements(def->'steps') x),
                             'approvers', all_ids),
          nullif(btrim(coalesce(p_comment, '')), ''));
  changes := _wf_apply(it.id, def, _wf_step_option(def, 0), def->'statusField'->>'onSubmit', false,
                       actor_kind, actor, p_automation, nullif(btrim(coalesce(p_comment, '')), ''));
  perform _wf_notify(it, inst.step_approvers,
    'Approval needed: ' || it.display_id || ' ' || it.name || ' · step 1, ' || (def->'steps'->0->>'name')
    || ' (' || (def->>'name') || ')');
  return jsonb_build_object('instance_id', inst.id, 'workflow_id', def->>'id', 'status', 'in_progress',
                            'step_index', 0, 'changes', changes);
end $$;

-- ───────────────────────── decide ─────────────────────────
-- People only: an approver of the current step with read access to the item. Rejecting needs a comment.
create or replace function workflow_decide(p_instance uuid, p_decision text, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare inst workflow_instances; it items; def jsonb; step jsonb; me uuid := auth.uid(); idx int; total int;
        outcome text; next_idx int; target text; approved_by uuid[]; waiting uuid[]; changes jsonb := '[]'::jsonb;
        due timestamptz; note text := nullif(btrim(coalesce(p_comment, '')), ''); v_end text;
        submitter_note text;
begin
  if me is null or not _is_person() then raise exception 'not allowed'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'approval: choose approve or reject.'; end if;
  select * into inst from workflow_instances where id = p_instance for update;
  if inst.id is null or not is_member(inst.org_id) then raise exception 'approval: this approval no longer exists.'; end if;
  select * into it from items where id = inst.item_id for update;
  if it.id is null or it.archived_at is not null then raise exception 'item not found'; end if;
  perform _need_sheet(it.sheet_id, 'viewer');
  if inst.status <> 'in_progress' then raise exception 'approval: this approval has already ended.'; end if;
  def := inst.definition;
  idx := inst.step_index;
  total := jsonb_array_length(def->'steps');
  step := def->'steps'->idx;
  if has_role(inst.org_id, array['auditor']::member_role[]) then
    raise exception 'approval: auditors have read-only access.';
  end if;
  if inst.submitted_by = me and not coalesce((def->>'allowSelfApproval')::boolean, false) then
    raise exception 'approval: you submitted this item and cannot approve your own submission.';
  end if;
  if not (me = any(inst.step_approvers)) then
    raise exception 'approval: you are not an approver of this step.';
  end if;
  if exists (select 1 from workflow_decisions where instance_id = inst.id and step_index = idx
                                                and round = inst.round and user_id = me) then
    raise exception 'approval: you have already decided on this step.';
  end if;
  if p_decision = 'rejected' and note is null then raise exception 'approval: say why you reject it.'; end if;
  if char_length(note) > 2000 then raise exception 'approval: keep the comment under 2000 characters.'; end if;

  insert into workflow_decisions(org_id, instance_id, item_id, step_index, step_id, step_name, round, user_id,
                                 decision, comment)
  values (inst.org_id, inst.id, it.id, idx, step->>'id', step->>'name', inst.round, me, p_decision, note);

  -- what the decision does (the same rules as src/engine/approvals/runtime.ts decide)
  if p_decision = 'rejected' then
    if step->'onReject'->>'to' = 'step' then
      select (o.n - 1)::int into next_idx from jsonb_array_elements(def->'steps') with ordinality o(s, n)
       where o.s->>'id' = step->'onReject'->>'stepId';
      if next_idx is null or next_idx > idx then next_idx := idx; end if;
      outcome := 'returned';
    else
      outcome := 'rejected';
      v_end := case when step->'onReject'->>'to' = 'draft' then 'draft' else 'closed' end;
    end if;
  else
    approved_by := array(select user_id from workflow_decisions where instance_id = inst.id and step_index = idx
                                                                 and round = inst.round and decision = 'approved');
    waiting := array(select u from unnest(inst.step_approvers) u where not (u = any(approved_by)));
    if step->>'mode' = 'all' and cardinality(waiting) > 0 then
      outcome := 'waiting';
    elsif idx + 1 < total then
      outcome := 'next';
      next_idx := idx + 1;
    else
      outcome := 'approved';
      v_end := 'approved';
    end if;
  end if;

  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value, note)
  values (it.org_id, it.sheet_id, it.id, '', 'user', me, 'workflow.decided',
          jsonb_build_object('instance_id', inst.id, 'workflow_id', inst.workflow_id, 'workflow', def->>'name',
                             'step_index', idx, 'step_id', step->>'id', 'step', step->>'name', 'round', inst.round,
                             'decision', p_decision, 'outcome', outcome,
                             'next_step', case when next_idx is not null then def->'steps'->next_idx->>'name' end),
          note);

  if outcome in ('next', 'returned') then
    due := case when jsonb_typeof(def->'steps'->next_idx->'sla') = 'object'
                then now() + make_interval(hours => ((def->'steps'->next_idx->'sla'->>'amount')::int
                                                    * case when def->'steps'->next_idx->'sla'->>'unit' = 'days' then 24 else 1 end))
           end;
    update workflow_instances
       set step_index = next_idx, round = round + case when outcome = 'returned' then 1 else 0 end,
           step_started_at = now(), step_due_at = due, step_approvers = _wf_uuids(approvers->next_idx)
     where id = inst.id returning * into inst;
    changes := _wf_apply(it.id, def, _wf_step_option(def, next_idx), null, false, 'user', me, null, null);
    perform _wf_notify(it, inst.step_approvers,
      'Approval needed: ' || it.display_id || ' ' || it.name || ' · step ' || (next_idx + 1) || ', '
      || (def->'steps'->next_idx->>'name') || ' (' || (def->>'name') || ')');
    if outcome = 'returned' then
      perform _wf_notify(it, array[inst.submitted_by],
        'Sent back to ' || (def->'steps'->next_idx->>'name') || ': ' || it.display_id || ' ' || it.name
        || ' · ' || note);
    end if;
  elsif outcome in ('approved', 'rejected') then
    update workflow_instances
       set status = outcome, step_index = null, step_approvers = '{}', ended_at = now(), ended_by = me,
           end_reason = v_end, step_due_at = null
     where id = inst.id returning * into inst;
    insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value, note)
    values (it.org_id, it.sheet_id, it.id, '', 'user', me, 'workflow.' || outcome,
            jsonb_build_object('instance_id', inst.id, 'workflow_id', inst.workflow_id, 'workflow', def->>'name',
                               'end_reason', v_end),
            case when outcome = 'rejected' then note end);
    if outcome = 'approved' then
      changes := _wf_apply(it.id, def, nullif(def->'stepField'->>'approved', ''), def->'statusField'->>'onApproved',
                           coalesce((def->>'lockOnApproval')::boolean, false), 'user', me, null, note);
      submitter_note := 'Approved: ' || it.display_id || ' ' || it.name || ' (' || (def->>'name') || ')';
    else
      changes := _wf_apply(it.id, def,
                           case when v_end = 'closed' then coalesce(nullif(def->'stepField'->>'rejected', ''),
                                                                         nullif(def->'stepField'->>'draft', ''))
                                else nullif(def->'stepField'->>'draft', '') end,
                           def->'statusField'->>'onRejected', false, 'user', me, null, note);
      submitter_note := 'Rejected: ' || it.display_id || ' ' || it.name || ' (' || (def->>'name') || ') · ' || note;
    end if;
    perform _wf_notify(it, array[inst.submitted_by], submitter_note);
  end if;

  return jsonb_build_object('instance_id', inst.id, 'workflow_id', inst.workflow_id, 'status', inst.status,
                            'outcome', outcome, 'step_index', idx, 'step_id', step->>'id',
                            'next_step_index', next_idx, 'changes', changes);
end $$;

-- ───────────────────────── withdraw ─────────────────────────
-- The person who submitted, or an owner or admin who can read the item.
create or replace function workflow_withdraw(p_instance uuid, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare inst workflow_instances; it items; me uuid := auth.uid(); changes jsonb;
        note text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if me is null or not _is_person() then raise exception 'not allowed'; end if;
  select * into inst from workflow_instances where id = p_instance for update;
  if inst.id is null or not is_member(inst.org_id) then raise exception 'approval: this approval no longer exists.'; end if;
  select * into it from items where id = inst.item_id for update;
  if it.id is null then raise exception 'item not found'; end if;
  perform _need_sheet(it.sheet_id, 'viewer');
  if inst.status <> 'in_progress' then raise exception 'approval: this approval has already ended.'; end if;
  if inst.submitted_by is distinct from me and not is_admin(inst.org_id) then
    raise exception 'approval: only the person who submitted it, an owner or an admin can withdraw it.';
  end if;
  if char_length(note) > 2000 then raise exception 'approval: keep the comment under 2000 characters.'; end if;
  update workflow_instances set status = 'withdrawn', step_index = null, step_approvers = '{}', step_due_at = null,
                                ended_at = now(), ended_by = me, end_reason = 'withdrawn'
   where id = inst.id returning * into inst;
  insert into activity_log(org_id, sheet_id, item_id, chain_key, actor_kind, actor_id, action, new_value, note)
  values (it.org_id, it.sheet_id, it.id, '', 'user', me, 'workflow.withdrawn',
          jsonb_build_object('instance_id', inst.id, 'workflow_id', inst.workflow_id,
                             'workflow', inst.definition->>'name'), note);
  changes := _wf_apply(it.id, inst.definition, nullif(inst.definition->'stepField'->>'draft', ''), null, false,
                       'user', me, null, null);
  return jsonb_build_object('instance_id', inst.id, 'workflow_id', inst.workflow_id, 'status', inst.status,
                            'changes', changes);
end $$;

-- ───────────────────────── grants ─────────────────────────
revoke all on function sheets_workflows_guard(), workflow_decisions_append_only(), items_access_guard()
  from public, anon, authenticated;
revoke all on function _wf_definition(uuid, text), _wf_valid(jsonb), _wf_resolve(items, jsonb),
  _wf_filled(items, fields), _wf_set_option(items, text, text, text, uuid, text),
  _wf_apply(uuid, jsonb, text, text, boolean, text, uuid, uuid, text), _wf_step_option(jsonb, int),
  _wf_notify(items, uuid[], text), _wf_uuids(jsonb)
  from public, anon, authenticated;
revoke all on function workflow_submit(uuid, text, text, uuid, uuid), workflow_decide(uuid, text, text),
  workflow_withdraw(uuid, text) from public, anon;
grant execute on function workflow_submit(uuid, text, text, uuid, uuid), workflow_decide(uuid, text, text),
  workflow_withdraw(uuid, text) to authenticated;
grant execute on function workflow_submit(uuid, text, text, uuid, uuid) to service_role;
grant select on workflow_instances, workflow_decisions to authenticated, service_role;
grant insert, update, delete on workflow_instances, workflow_decisions to service_role;

-- ───────────────────────── packs: approval workflows in manifests ─────────────────────────
-- install_pack writes a sheet's settings as the plan gives them, workflows included. upgrade_pack (0035) updates only
-- the columns it names, so the update is written by apply_pack_upgrade: upgrade_pack (whichever definition is current)
-- and then p_plan.update.workflows ([{ sheet_id, workflows }], a sheet's list replaced as a whole, chosen by the
-- three-way diff in src/engine/packs/upgrade.ts), in one transaction, to sheets of the install only. The app calls
-- apply_pack_upgrade; upgrade_pack keeps its contract.
create or replace function apply_pack_upgrade(p_install uuid, p_plan jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; e jsonb; n int := 0;
begin
  r := upgrade_pack(p_install, p_plan);
  for e in select x from jsonb_array_elements(case when jsonb_typeof(p_plan->'update'->'workflows') = 'array'
                                                   then p_plan->'update'->'workflows' else '[]'::jsonb end) x loop
    if jsonb_typeof(e->'workflows') is distinct from 'array' then
      raise exception 'upgrade plan: approval workflows must be a list';
    end if;
    perform set_config('app.pack_op', 'upgrade', true);
    update sheets set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{workflows}', e->'workflows'),
                      updated_at = now()
     where id = (e->>'sheet_id')::uuid and pack_install_id = p_install;
    if not found then
      raise exception 'upgrade plan: a sheet that is not the install''s own (%)', e->>'sheet_id';
    end if;
    n := n + 1;
  end loop;
  perform set_config('app.pack_op', '', true);
  return r || jsonb_build_object('workflows', n);
end $$;
revoke all on function apply_pack_upgrade(uuid, jsonb) from public, anon;
grant execute on function apply_pack_upgrade(uuid, jsonb) to authenticated;
