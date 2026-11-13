-- P5 · Audit outputs (docs/11 Audit outputs). Every export (statement of applicability as CSV or print, the audit
-- pack zip, management review inputs) is logged on the workspace chain as `audit.exported`: who (the caller), what
-- (the kind) and the scope the exporting command describes. Any member may export what they can read, auditors too
-- (is_member ignores an auditor whose access has ended). The scope is a flat object of known keys with scalar values,
-- so the log cannot be used to store anything else.

create or replace function log_audit_export(p_org uuid, p_kind text, p_scope jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  if p_org is null or not is_member(p_org) then raise exception 'not allowed'; end if;
  if p_kind is null or p_kind not in ('soa.csv', 'soa.print', 'audit_pack', 'management_review', 'management_review.item') then
    raise exception 'audit: unknown export kind';
  end if;
  if p_scope is null or jsonb_typeof(p_scope) <> 'object' or length(p_scope::text) > 4000 then
    raise exception 'audit: bad scope';
  end if;
  if exists (select 1 from jsonb_each(p_scope) e
              where e.key not in ('framework', 'sheet_id', 'sheet', 'folder_id', 'install_id', 'scope', 'from', 'to',
                                  'sheets', 'items', 'files', 'files_included', 'entries', 'chains', 'chains_ok',
                                  'chains_broken', 'item_id', 'format')
                 or jsonb_typeof(e.value) not in ('string', 'number', 'boolean', 'null')) then
    raise exception 'audit: bad scope';
  end if;
  insert into activity_log (org_id, chain_key, actor_kind, actor_id, action, new_value, note)
  values (p_org, '', 'user', auth.uid(), 'audit.exported', jsonb_build_object('kind', p_kind) || p_scope,
          coalesce(_member_name(auth.uid()), 'Someone') || ' exported ' || replace(p_kind, '_', ' '))
  returning id into new_id;
  return new_id;
end $$;

revoke all on function log_audit_export(uuid, text, jsonb) from public, anon;
grant execute on function log_audit_export(uuid, text, jsonb) to authenticated;
