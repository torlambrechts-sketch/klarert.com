-- 0077_reserved_slug_standards.sql · The public site's standard pages (/standards/iso-9001 …) take the address
-- `standards` (owner decision, 17 Nov 2026).
--
-- `_reserved_slugs()` (0073) is the list of top-level addresses a workspace cannot take. It must equal `RESERVED_SLUGS`
-- in `src/lib/reserved-slugs.ts` (a unit test compares them with the newest migration that defines the function). This
-- replaces it with the same list plus `standards`, in the same order as the TypeScript list. `workspace_slug_available`,
-- `create_workspace` and the `orgs_slug_reserved` trigger call it, so they refuse the new address at once. A workspace
-- that already has the address keeps it (the trigger only checks a new or changed address). Internal: not executable by
-- any API role (`create or replace` keeps the revoke of 0073; it is repeated so this file stands on its own).

create or replace function _reserved_slugs() returns text[]
language sql immutable set search_path = public as $$
  select array['_next', 'account', 'account-deleted', 'api', 'auth', 'f', 'favicon.ico', 'frameworks', 'invite', 'login',
               'onboarding', 'opengraph-image', 'platform', 'poster', 'privacy', 'robots.txt', 'sitemap.xml', 'standards',
               'terms']::text[]
$$;
revoke all on function _reserved_slugs() from public, anon, authenticated, service_role;
