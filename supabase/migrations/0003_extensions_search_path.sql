-- 0003_extensions_search_path.sql · pgcrypto lives in the `extensions` schema on Supabase
-- activity_hash() calls digest(), and the SECURITY DEFINER writers that reach it (audit_schema, _create_item,
-- set_item_values …) pin search_path to `public`, so every activity log insert failed on Supabase.
-- PGlite (scripts/test-migration.mjs) installs pgcrypto in `public`; listing both schemas works in both places.
alter function activity_hash(text, timestamptz, text, uuid, text, uuid, jsonb, jsonb, text)
  set search_path = public, extensions;

-- token defaults are evaluated with the caller's search_path, which may be pinned to `public`
alter table invites    alter column token set default encode(extensions.gen_random_bytes(24), 'hex');
alter table form_links alter column token set default encode(extensions.gen_random_bytes(32), 'hex');
