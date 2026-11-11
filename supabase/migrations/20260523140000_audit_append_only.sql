-- Enforce strict append-only on klarert.audit_log even against bypassrls
-- callers (service_role, postgres). RLS alone is not enough — it does not
-- apply to roles with BYPASSRLS, which would let an operator with service
-- credentials rewrite or erase the audit trail. A BEFORE trigger that
-- unconditionally raises closes that hole.
--
-- The trigger runs SECURITY INVOKER (default) so the executing role is
-- visible to the exception path. Postgres background processes that need
-- to purge for retention should drop this trigger explicitly inside a
-- transaction and restore it after — and the retention helper itself
-- should be the only path that does that.

create or replace function klarert.tg_audit_log_append_only() returns trigger
language plpgsql
as $$
begin
  raise exception 'klarert.audit_log is append-only: % is not allowed', TG_OP
    using errcode = 'insufficient_privilege';
end;
$$;

revoke all on function klarert.tg_audit_log_append_only() from public, anon, authenticated;

drop trigger if exists audit_log_no_update on klarert.audit_log;
create trigger audit_log_no_update
  before update on klarert.audit_log
  for each row execute function klarert.tg_audit_log_append_only();

drop trigger if exists audit_log_no_delete on klarert.audit_log;
create trigger audit_log_no_delete
  before delete on klarert.audit_log
  for each row execute function klarert.tg_audit_log_append_only();

comment on function klarert.tg_audit_log_append_only is
  'BEFORE UPDATE/DELETE trigger on audit_log. Always raises. Closes the audit-tampering hole that RLS leaves open for bypassrls roles.';
