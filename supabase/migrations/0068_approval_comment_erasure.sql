-- 0068_approval_comment_erasure.sql · Retention erasure reaches approval comments outside the log
-- (docs/09 §10.1 item 1, owner decision 15 Nov 2026: option b).
--
-- Before: 0065 kept approval comments out of the activity log in clear, but the approval's own record kept them for
-- good: `workflow_decisions.comment` (append-only) and `workflow_instances.submit_comment`.
--
-- Now:
-- 1. `workflow_decisions_append_only` has one narrow exception: inside retention erasure (`app.retention_op =
--    'erase'`, transaction-local, set only by `retention_execute`) an update may set `comment` from a value to null,
--    and nothing else on the row may change. The decision itself (outcome, step, round, who, when) stays.
-- 2. `workflow_instances_comment_guard`: `submit_comment` changes only the same way (to null, inside erasure). No API
--    role can update the table at all (0040); this keeps the definer functions to the same rule.
-- 3. `retention_execute` with `comments` (and anonymise) clears both for the item and counts them in the tombstone
--    as `approval_comments_erased`. It is patched from its current definition, stopping if a line is not there.

create or replace function workflow_decisions_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('app.purge_org', true) = old.org_id::text then return old; end if;
  -- retention erasure: the comment goes, the decision stays
  if tg_op = 'UPDATE' and coalesce(current_setting('app.retention_op', true), '') = 'erase'
     and old.comment is not null and new.comment is null
     and (to_jsonb(new) - 'comment') = (to_jsonb(old) - 'comment') then
    return new;
  end if;
  raise exception 'workflow_decisions is append-only';
end $$;

create or replace function workflow_instances_comment_guard() returns trigger language plpgsql as $$
begin
  if new.submit_comment is distinct from old.submit_comment
     and not (coalesce(current_setting('app.retention_op', true), '') = 'erase' and new.submit_comment is null) then
    raise exception 'workflow_instances: the submit comment changes only by retention erasure';
  end if;
  return new;
end $$;
drop trigger if exists workflow_instances_comment_guard on workflow_instances;
create trigger workflow_instances_comment_guard before update on workflow_instances
  for each row execute function workflow_instances_comment_guard();
revoke all on function workflow_instances_comment_guard() from public, anon, authenticated;

do $$
declare d text := pg_get_functiondef('retention_execute(uuid, text)'::regprocedure);
        decl_old text := $s$with_comments boolean;$s$;
        off_old text := $s$  perform set_config('app.retention_op', '', true);$s$;
        tomb_old text := $s$'earlier_entries_in_clear', n_clear,$s$;
begin
  if position(decl_old in d) = 0 or position(off_old in d) = 0 or position(tomb_old in d) = 0 then
    raise exception 'retention_execute changed: update 0068';
  end if;
  d := replace(d, decl_old, $s$with_comments boolean; n_wf int := 0; n_wf2 int := 0;$s$);
  d := replace(d, off_old, $s$  -- approval comments kept with the approval's record (0068): the decisions stay, their comments go
  if with_comments then
    update workflow_decisions set comment = null where item_id = it.id and comment is not null;
    get diagnostics n_wf = row_count;
    update workflow_instances set submit_comment = null where item_id = it.id and submit_comment is not null;
    get diagnostics n_wf2 = row_count;
    n_wf := n_wf + n_wf2;
  end if;
$s$ || off_old);
  d := replace(d, tomb_old, tomb_old || $s$ 'approval_comments_erased', n_wf,$s$);
  execute d;
end $$;
