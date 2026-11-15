-- 0049_data_flow_export_log.sql · The data-flow record export is logged (docs/05 §4, owner decision 15 Nov 2026).
--
-- Exporting "Leaves the system" from Platform › Design (/[org]/design/print?part=leaves) writes `audit.exported` on
-- the workspace chain, as the other audit exports do (0034): who (the caller), when (the entry's time), the kind
-- `data_flow_record` and the filters used (app, pack, folder, Registers domain, "differs from pack") with how many
-- sheets and destinations it covered. Never an address or a field value: the scope stays a flat object of known keys
-- with scalar values. Only those who see the record can log its export: owners, admins and auditors whose access has
-- not ended. The plain flow print and the workspace print are not logged.

create or replace function log_audit_export(p_org uuid, p_kind text, p_scope jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  if p_org is null or not is_member(p_org) then raise exception 'not allowed'; end if;
  if p_kind is null or p_kind not in ('soa.csv', 'soa.print', 'audit_pack', 'management_review',
                                      'management_review.item', 'data_flow_record') then
    raise exception 'audit: unknown export kind';
  end if;
  -- the data-flow record is shown to owners, admins and auditors only (docs/05 §4)
  if p_kind = 'data_flow_record' and not has_role(p_org, array['owner', 'admin', 'auditor']::member_role[]) then
    raise exception 'not allowed';
  end if;
  if p_scope is null or jsonb_typeof(p_scope) <> 'object' or length(p_scope::text) > 4000 then
    raise exception 'audit: bad scope';
  end if;
  if exists (select 1 from jsonb_each(p_scope) e
              where e.key not in ('framework', 'sheet_id', 'sheet', 'folder_id', 'install_id', 'scope', 'from', 'to',
                                  'sheets', 'items', 'files', 'files_included', 'entries', 'chains', 'chains_ok',
                                  'chains_broken', 'item_id', 'format', 'app', 'pack', 'domain', 'differs',
                                  'destinations')
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
