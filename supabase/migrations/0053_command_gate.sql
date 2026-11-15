-- 0053_command_gate.sql · Writes come only through the app's server commands (security review SA-3; CLAUDE.md rule 2).
--
-- Before: every write RPC (set_item_values, create_item, move_item, set_item_links …) and the structure tables
-- (fields, groups, views, automations, dashboards …) were callable by anyone signed in, with the public anon key and
-- their own session, straight against PostgREST. That skipped what lives only in the commands: field-type
-- validation, required / min / max / unique, status rules ("fill in X first", required comments) and automations.
--
-- Design (why a gate rather than SQL copies of the engine): the engine's validation, status rules and automations
-- are TypeScript run by the commands (docs/02 §4). Re-implementing 58 field types, formulas and status rules in SQL
-- would leave two rule sets to drift apart, and still could not run automations on a direct call. A PostgREST
-- pre-request function instead refuses every *mutating* request from a person unless it carries a short-lived
-- proof that only the app's server can make. Reads are untouched (the browser keeps its RLS reads and Realtime).
--
-- `api_request_guard()` (PostgREST `db-pre-request`, run before every API request):
-- * GET, HEAD and OPTIONS pass (reads, RLS applies).
-- * Requests made as the service role pass: the scheduler, the webhook worker, the public form route and the
--   automation runner (CLAUDE.md rule 6) are already server-only.
-- * An RPC to a function that is STABLE or IMMUTABLE passes: it cannot write (sheet_levels, form_stats,
--   get_public_form, verify_activity_chain …). Every function that writes is VOLATILE (pgTAP checks the read
--   functions the browser calls stay non-volatile).
-- * Anything else from `authenticated` or `anon` (table inserts, updates, deletes, and RPCs to volatile functions,
--   GraphQL included) needs the header `x-klarert-command: t=<unix seconds>,v1=<hex>` where
--   v1 = HMAC-SHA256(secret, "<t>.<user id>"), t within five minutes. The secret is the Vault secret
--   `klarert_command_secret`; the server holds the same value in `SUPABASE_COMMAND_SECRET` and adds the header in
--   `src/lib/supabase/server.ts` only. The proof is bound to the person and expires, so a header seen in a log cannot
--   be replayed by someone else or later. Without a configured secret every such write is refused (fail closed).
-- Refusals read `access: Changes are made in the app, not through the API.` (403).
--
-- Public forms and the scheduler are unaffected (service role). Direct SQL (migrations, pgTAP, the seed) does not go
-- through PostgREST and is unaffected; the database's own rules (RLS, guard triggers) still apply to every caller.

create or replace function _command_secret() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'klarert_command_secret'
   order by created_at desc limit 1
$$;
revoke execute on function _command_secret() from public, anon, authenticated;

-- The proof the server sends for a person (or for nobody, signed out): hex HMAC-SHA256 of "<t>.<user id>".
create or replace function _command_proof(p_t bigint, p_user uuid) returns text
language sql stable security definer set search_path = public, extensions as $$
  select encode(hmac(p_t::text || '.' || coalesce(p_user::text, ''), _command_secret(), 'sha256'), 'hex')
$$;
revoke execute on function _command_proof(bigint, uuid) from public, anon, authenticated;

create or replace function api_request_guard() returns void
language plpgsql stable security definer set search_path = public as $$
declare m text := upper(coalesce(current_setting('request.method', true), ''));
        p text := coalesce(current_setting('request.path', true), '');
        r text := coalesce(current_setting('role', true), '');
        h jsonb; fn text; sch text; proof text; t bigint; v1 text;
begin
  if m in ('', 'GET', 'HEAD', 'OPTIONS') then return; end if;
  if r not in ('authenticated', 'anon') then return; end if;
  h := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  if p like '/rpc/%' then
    fn := substr(p, 6);
    sch := coalesce(nullif(h ->> 'content-profile', ''), 'public');
    -- a function that cannot write passes (every overload stable or immutable)
    if exists (select 1 from pg_proc where proname = fn and pronamespace = to_regnamespace(sch))
       and not exists (select 1 from pg_proc where proname = fn and pronamespace = to_regnamespace(sch)
                                                and provolatile = 'v') then
      return;
    end if;
  end if;
  proof := h ->> 'x-klarert-command';
  if proof is not null and proof ~ '^t=[0-9]{1,12},v1=[0-9a-f]{64}$' and _command_secret() is not null then
    t := substring(proof from '^t=([0-9]+),')::bigint;
    v1 := substring(proof from ',v1=([0-9a-f]+)$');
    if abs(extract(epoch from now())::bigint - t) <= 300 and v1 = _command_proof(t, auth.uid()) then
      return;
    end if;
  end if;
  raise exception using errcode = '42501', message = 'access: Changes are made in the app, not through the API.';
end $$;
revoke execute on function api_request_guard() from public;
grant execute on function api_request_guard() to anon, authenticated;

alter role authenticator set pgrst.db_pre_request to 'public.api_request_guard';
notify pgrst, 'reload config';
