-- The fields of a sheet are found by index whatever their state (0045_fields_sheet_index.sql): activity_a_mask reads a
-- sheet's restricted and personal-data fields, archived ones included, for every created item, and must not scan the
-- fields of every workspace to do it. Run: pnpm db:test
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(2);

select has_index('public', 'fields', 'fields_sheet_all_idx', array['sheet_id'],
                 'fields has a plain index on sheet_id');
select is((select indpred is null from pg_index where indexrelid = 'public.fields_sheet_all_idx'::regclass), true,
          'the index covers archived fields too (no predicate)');

select * from finish();
rollback;
