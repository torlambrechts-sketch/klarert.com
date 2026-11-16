-- 0066_public_config_allow_list.sql · Public forms show a field's config through an allow-list per field type
-- (security review 9.1 item 5).
--
-- Before (0062, L2): `_public_field_config(config)` removed a deny-list of internal keys (allowedUserIds, targetSheetId,
-- formulas, personalData …) from each field's config before `get_public_form` gave it to a signed-out visitor. A new
-- field type, or a new key on an old one, reached the public unless someone remembered to add it to the list.
--
-- Now: `_public_field_config(type, config)` keeps only the keys the field type allows on a public form. The lists are
-- data in the field registry (`publicConfigKeys` on each type in src/engine/fields, read by
-- src/engine/fields/public-config.ts); the JSON below is that registry's `publicConfigSql()`, and
-- public-config.test.ts fails when they differ. A type not in the list (files, the directory, links, computed types,
-- types not yet on the list) gets `{}`; a key not in its type's list is left out. `get_public_form` is patched to call
-- it with the field's type, and the one-argument deny-list version is dropped.

create or replace function _public_field_config(p_type text, p_config jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce((select jsonb_object_agg(e.key, e.value)
                     from jsonb_each(case when jsonb_typeof(p_config) = 'object' then p_config else '{}'::jsonb end) e
                    where coalesce(k.keys, '[]'::jsonb) ? e.key), '{}'::jsonb)
    from (select (
-- public-config-keys:begin
$json${
  "applicability": ["reasonRequiredWhenNot"],
  "check": [],
  "checklist": ["lines"],
  "classification": ["options"],
  "comment": [],
  "country": [],
  "date": ["relative"],
  "datetime": [],
  "dropdown": ["options"],
  "duration": ["unit"],
  "email": [],
  "finding": ["options"],
  "justification": ["whenFieldKey","whenValues"],
  "location": [],
  "longtext": [],
  "maturity": [],
  "measurement": ["direction","target","unit"],
  "multiselect": ["options"],
  "number": ["bands","decimals","higherIsBetter","unit"],
  "pdmarker": [],
  "percent": ["bar"],
  "phone": ["defaultCountry"],
  "question": ["options","question","weight"],
  "rating": ["scale"],
  "recurrence": [],
  "retention": ["fromFieldKey","years"],
  "riskmatrix": ["bands","impactLabels","likelihoodLabels","size"],
  "severity": ["options"],
  "status": ["options"],
  "text": [],
  "timeline": [],
  "url": [],
  "value": ["allowOther","currency"],
  "version": [],
  "yesno": ["allowNA"]
}$json$
-- public-config-keys:end
          ::jsonb -> p_type) as keys) k
$$;
revoke execute on function _public_field_config(text, jsonb) from public, anon, authenticated;

do $$
declare d text := pg_get_functiondef('get_public_form(text)'::regprocedure);
begin
  if position($s$_public_field_config(fd.config)$s$ in d) = 0 then raise exception 'get_public_form changed: update 0066'; end if;
  execute replace(d, $s$_public_field_config(fd.config)$s$, $s$_public_field_config(fd.type, fd.config)$s$);
end $$;

drop function if exists _public_field_config(jsonb);
