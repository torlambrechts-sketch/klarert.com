# Security

Load this when working on auth, RLS, secrets, GDPR concerns, or any anonymity-sensitive feature.

Compliance platforms are juicy targets: they centralize regulated data (HMS, varsling, sykefravær, personalia) across many tenants. A single RLS hole or auth bypass can end the company. Every change touches security.

## 1. Threat model (assumed, not theoretical)

- **Cross-tenant leakage**: a user from org A reads data from org B. This is the most likely failure mode for an RLS-driven multi-tenant Postgres app. Mitigation: every table has `organization_id`, every policy uses `current_org_id()`, every test switches users and asserts.
- **Anonymity break**: a varsling reporter is re-identified through metadata, joins, or audit logs. Mitigation: structural anonymity (separate table, no FK, no IP/session), automated tests that try to join and fail.
- **Privilege escalation**: an `employee` reads `whistleblowing_reports` because of a missed `has_role()` check or because `org_admin` was conflated with `varsling_committee`. Mitigation: roles are data, RBAC SQL helpers are the only check, no TS role enums.
- **Service-role leak**: the service-role key reaches the browser bundle. Mitigation: a CI scan that fails the build if `SUPABASE_SERVICE_ROLE_KEY` appears in any file under `app/(app)` or `components/`.
- **Storage bypass**: signed URLs leak files past RLS. Mitigation: files served via authenticated Next.js routes that re-check permissions, not via direct signed URLs except where the bucket itself is permission-gated.
- **Audit-log tampering**: someone deletes a row from `audit_log` to hide a state change. Mitigation: no UPDATE or DELETE policies on `audit_log`; revoke from `authenticated` role at the GRANT level.
- **Workflow-engine misuse**: a section component bypasses workflows and writes directly to another module's tables. Mitigation: per-module RLS that only allows the workflow runner (a designated `service_role` function with `SECURITY DEFINER`) to write certain tables.
- **Public endpoints abuse**: the public varsling endpoint is hammered or used to enumerate tracking codes. Mitigation: rate limiting on IP + session + per-org global; constant-time token comparison; tracking codes long enough that brute-force is infeasible.

## 2. RLS testing — the only proof that matters

Every tenant-scoped table ships with a `supabase/tests/<table>_rls.sql` pgTAP file. The structure:

```sql
-- supabase/tests/deviations_rls.sql
begin;
select plan(16);

-- Setup: two orgs, two users in each, one varsling_committee in org A
select setup_two_orgs_two_users_each();

-- Org A user can read their own deviations
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"<user_a1>","org_id":"<org_a>"}';
select results_eq(
  $$ select count(*) from deviations $$,
  $$ values (3::bigint) $$,
  'org A user sees only org A deviations'
);

-- Org A user CANNOT read org B deviations even if they know the id
select results_eq(
  $$ select count(*) from deviations where id = '<some_org_b_deviation_id>' $$,
  $$ values (0::bigint) $$,
  'org A user cannot read org B deviation by id'
);

-- ... INSERT, UPDATE, DELETE per role × per org × per status

select finish();
rollback;
```

Run `supabase test db` in CI. A failing RLS test blocks merge.

**The matrix to cover per table:**

| Role | SELECT own org | SELECT other org | INSERT own org | INSERT other org | UPDATE own org | UPDATE other org | DELETE own org | DELETE other org |
|---|---|---|---|---|---|---|---|---|

Test every cell. Most cells are deny — those still need an explicit test, because the failure mode is "policy permits when it shouldn't".

## 3. Anonymity testing

Anonymity is a schema-level guarantee. We prove it with two kinds of test:

### Schema test (structural)

```sql
-- supabase/tests/whistleblowing_anonymity.sql
select plan(4);

-- No reporter_id column exists
select hasnt_column('whistleblowing_reports', 'reporter_id');
select hasnt_column('whistleblowing_reports', 'created_by');
select hasnt_column('whistleblowing_reports', 'ip_address');

-- No FK from whistleblowing_reports to profiles or auth.users
select is_empty(
  $$ select 1
     from information_schema.referential_constraints rc
     join information_schema.key_column_usage k using (constraint_name)
     where k.table_name = 'whistleblowing_reports'
       and k.column_name like '%user%' or k.column_name like '%reporter%' $$,
  'no FK leak from whistleblowing_reports to user-identifying tables'
);
```

### Join test (try and fail)

```sql
-- Try every plausible join. Each must return no path.
select plan(3);

select is_empty(
  $$ select 1 from whistleblowing_reports r
     left join audit_log a on a.row_id::text = r.id::text
     where a.user_id is not null $$,
  'audit_log never links a real user to a whistleblowing row'
);
```

If any test fails, do not merge. The anonymity guarantee is the product.

## 4. The SQL helpers everyone uses

```sql
create or replace function current_org_id() returns uuid
language sql stable security definer as $$
  select (current_setting('request.jwt.claims', true)::jsonb -> 'org_id')::uuid;
$$;

create or replace function has_permission(perm text) returns boolean
language sql stable security definer as $$
  select exists (
    select 1
    from user_roles ur
    join role_permissions rp on rp.role_id = ur.role_id
    where ur.user_id = auth.uid()
      and ur.organization_id = current_org_id()
      and rp.permission = perm
  );
$$;

create or replace function has_role(role_slug text) returns boolean
language sql stable security definer as $$
  select exists (
    select 1
    from user_roles ur
    join roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and ur.organization_id = current_org_id()
      and r.slug = role_slug
  );
$$;
```

Every RLS policy uses these. TypeScript never enumerates roles or permissions; it asks the database.

## 5. Auth and session

- Supabase Auth with email/password + magic link.
- JWT claims include `org_id` for the **active** org (a user can belong to multiple orgs; the URL `/[org]/...` and a session cookie agree on which is active).
- Changing active org issues a new JWT — server-side flow, no client-side claim rewriting.
- Session timeout: idle 8 h, max 30 days. Sensitive operations (varsling reading, RBAC editing) require re-auth within 15 minutes.
- MFA is opt-in for `employee`, **required** for `org_admin`, `varsling_committee`, `platform_admin`.
- Service-role key lives in Vercel env vars, accessed only from Server Actions / Edge Functions. CI lint check: `grep -r SERVICE_ROLE app/(app) components/` must return empty.

## 6. The "service-role barrier" rule

Server code that uses the service-role client (`createServiceClient()`) lives in `lib/supabase/service.ts` and is **never imported** by client components. We enforce this with an ESLint rule:

```js
// eslint-config/no-service-client-in-client.js
{
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['**/supabase/service*'],
        importNames: ['createServiceClient', 'serviceClient'],
        message: 'Service role client is server-only. Use lib/supabase/server.ts in Server Components/Actions.',
      }],
    }],
  },
  overrides: [{
    files: ['app/**/route.ts', 'app/**/actions.ts', 'modules/**/actions.ts', 'supabase/functions/**'],
    rules: { 'no-restricted-imports': 'off' },
  }],
}
```

## 7. Public endpoints (varsling, anonym survey)

Public means **unauthenticated**. The risk surface is highest here.

- Implemented as Supabase Edge Functions, not Next.js routes (so Supabase logging policies apply independently).
- Rate-limited via Upstash KV or Vercel KV: per IP, per session cookie, per-org global. Limits are aggressive — humans don't submit varsling 50 times an hour.
- Logging configured to **scrub** request headers. Document the scrub config in `supabase/functions/<name>/README.md`. The CI build pulls the Edge Function config and asserts the scrub is present.
- Input validated server-side with Zod. Never trust the client.
- Constant-time comparison for token lookup (tracking codes). Use `crypto.timingSafeEqual` on equal-length hashes.
- CSRF is N/A on unauthenticated endpoints, but the form must include a captcha (hCaptcha) above a threshold of submissions per IP.
- Response bodies never reveal whether a token exists vs. is invalid. Same shape, same timing, same status.

## 8. Storage

Three rules cover 90% of storage security:

1. **Buckets are private by default.** Public buckets only for things with no PII (e.g. `public-assets`).
2. **Storage policies mirror table RLS.** If `documents` is readable by the org, `documents/{org_id}/...` is readable by the org. Use Supabase Storage policies referencing `auth.uid()` and the same RBAC helpers.
3. **Files served via authenticated Next.js routes** (`app/api/files/[id]/route.ts`). The route re-checks permission, then streams the file from Supabase using the service client. Direct signed URLs are forbidden unless time-limited (≤ 5 minutes) and the bucket is itself permission-restricted.

Evidence and certificate buckets carry per-org folders. Cross-tenant access via guessed paths is impossible because policies enforce `(storage.foldername(name))[1] = current_org_id()::text`.

## 9. GDPR / Datatilsynet

Norway implements GDPR via Personopplysningsloven. Datatilsynet enforces.

- **Lawful basis**: documented per data category in `data_categories` table (purpose, basis, retention period). The platform displays this in a privacy dashboard per tenant.
- **Lagringsbegrensning** (storage limitation): every personal-data table has a `retention_class` column. A `pg_cron` job runs nightly and soft-deletes rows past their retention. After 90 days in soft-delete, hard delete. Both events are written to `audit_log`.
- **Rett til sletting**: subject access requests are workflow-driven. `subject_rights_requests(type, subject_id, status, evidence)` table; resolution within 30 days; cascading soft-delete with audit trail. Some data (statutory retention) is exempt — document exemptions per category.
- **Databehandleravtale** (DPA): auto-generated, version-controlled DPA per tenant at signup, with sub-processor list. Update notifications when sub-processors change.
- **E-postinnsyn**: if the platform ever provides employer-mailbox-access tooling, it must implement the template required by FOR-2018-07-02-1108 — written notice, justification, log, employee opportunity to be present.
- **Cross-border transfer**: data stays in EU/EEA. Supabase region pinned to `eu-central-1` (Frankfurt) or `eu-west-1` (Ireland). Document the choice; no transfers to US.
- **Breach notification**: 72-hour clock to Datatilsynet from awareness. Document the runbook in `docs/runbooks/breach.md`.

## 10. Audit log — append-only and complete

```sql
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  table_name text not null,
  row_id uuid,                          -- nullable for org-level events
  action text not null check (action in ('insert', 'update', 'delete', 'access', 'export', 'purge')),
  changed_by uuid references profiles(id),     -- null for anonymous and system actions
  changed_via text not null check (changed_via in ('user', 'workflow', 'cron', 'service')),
  diff jsonb,                            -- before/after, scrubbed for PII categories
  occurred_at timestamptz not null default now()
);

revoke update, delete on audit_log from authenticated, anon;
-- Only platform_admin role via a SECURITY DEFINER purge function may delete (for retention compliance).
```

Audit triggers are generated, not hand-written, via a `make_audit_trigger(table_name)` SQL function. Every state-changing table calls it in its migration.

Audit log itself respects `organization_id` RLS — an org sees only its own events. `platform_admin` sees across, with that fact itself audited (an `access` event on `audit_log` is written).

## 11. Secrets

- Live in Vercel env vars and Supabase Vault, never in repo, `.env` files in repo are templates with placeholder values.
- Rotated annually; rotation runbook in `docs/runbooks/rotate-secrets.md`.
- The CI build scans for accidentally-committed secrets via `gitleaks`. PR blocked on positive find.
- Edge Functions read secrets from Supabase Vault, not from env vars.

## 12. Dependencies

- Renovate bot on a weekly schedule.
- Critical vulns (CVSS ≥ 9 or anything Supabase / Next.js / React core) block merge until patched.
- No new dependency without explicit approval — see CLAUDE.md.
- npm audit on every CI run; failure on `high` or above.

## 13. Logging

- Application logs go to Vercel + Supabase. No PII in log messages — log IDs and event types, not content.
- Public endpoints (varsling) are configured to scrub headers; verified in CI by reading the function config.
- Audit log is the system of record for security-relevant events. Application logs are debugging aids and have a short retention (30 days).

## 14. Quick checklist for any security-touching PR

- [ ] RLS policies present and pgTAP tested for all four operations × every role.
- [ ] If anonymous: structural-anonymity tests present and passing.
- [ ] No service-role client imported under `app/` or `components/` (lint enforced).
- [ ] No raw `gray-*` colors (lint enforced).
- [ ] No new public endpoint without rate limiting and Zod input validation.
- [ ] No new personal-data table without `retention_class` and a purge workflow.
- [ ] Storage policies mirror table RLS.
- [ ] Audit trigger present on every new table that changes state.
- [ ] CI scans (gitleaks, npm audit, ESLint security rules) clean.

## 15. What not to do

- Don't write an RLS policy that uses `current_setting('app.user_id')` or any custom session variable — Supabase doesn't reliably set those across pooled connections. Use `auth.uid()` and `current_org_id()` only.
- Don't `SECURITY DEFINER` a function without setting `search_path = pg_catalog, public` explicitly. Search-path injection is real.
- Don't store IPs, user-agents, session IDs, or device fingerprints on any table that touches anonymity. The data itself is the breach.
- Don't ship a feature whose RLS test you couldn't write. If you can't articulate who is allowed to read what, the design isn't done.
- Don't grant the `authenticated` role broad table privileges and rely on RLS alone. Use `grant select, insert (...) on X to authenticated` minimally — RLS is a second line.
- Don't expose Postgres errors to the client. Server Actions return typed errors; the network response carries a safe message and a request ID.
