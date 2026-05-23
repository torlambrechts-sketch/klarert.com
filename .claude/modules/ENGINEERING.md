# Engineering

Load this when writing Server Actions, components, tests, or anything about how we build.

The architectural rules in CLAUDE.md tell you *what* to build. This file is *how*.

## 1. Server Actions — the canonical shape

Every mutation in the app is a Server Action. Every Server Action looks the same:

```ts
// modules/alert/actions/create-deviation.ts
'use server';

import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import { actionResult, type ActionResult } from '@/lib/actions/result';

export const createDeviationInput = z.object({
  templateId: z.string().uuid(),
  title: z.string().min(3).max(200),
  description: z.string().max(5000).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  category: z.string().optional(),
  occurredAt: z.string().datetime().optional(),
});

export type CreateDeviationInput = z.infer<typeof createDeviationInput>;

export async function createDeviation(
  raw: unknown
): Promise<ActionResult<{ id: string }>> {
  const parsed = createDeviationInput.safeParse(raw);
  if (!parsed.success) return actionResult.invalid(parsed.error.flatten());

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('deviations')
    .insert(parsed.data)
    .select('id')
    .single();

  if (error) return actionResult.databaseError(error);
  return actionResult.ok({ id: data.id });
}
```

### Rules

- **Always `'use server'`.** One action per file. Filename matches the action.
- **Zod schema co-located.** Exported so the client form can `useForm({ resolver: zodResolver(schema) })`.
- **Never throw to the client.** Return `ActionResult<T>` — see below.
- **No service-role client.** Server Actions run as the authenticated user via the SSR Supabase client. The service-role client lives in `lib/supabase/service.ts` and is only imported by Edge Functions and cron jobs.
- **`organization_id` is implicit.** It's set by a DB default referencing `current_org_id()` and gated by RLS. The action does not pass it in (and trying to pass a different org's id is denied by RLS).
- **No cross-module writes.** If creating a deviation should also create a task, emit the `deviation.created` event and let the workflow engine fan out. The action does not write to `tasks`.

### The `ActionResult` type

```ts
// lib/actions/result.ts
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: 'invalid'; fieldErrors: Record<string, string[]>; formErrors: string[] }
  | { ok: false; code: 'unauthorized' }
  | { ok: false; code: 'forbidden' }
  | { ok: false; code: 'conflict'; message: string }
  | { ok: false; code: 'not_found' }
  | { ok: false; code: 'rate_limited'; retryAfterSec: number }
  | { ok: false; code: 'database_error'; requestId: string };

export const actionResult = {
  ok<T>(data: T): ActionResult<T> { return { ok: true, data }; },
  invalid(flattened: { fieldErrors: Record<string, string[]>; formErrors: string[] }) {
    return { ok: false as const, code: 'invalid' as const, ...flattened };
  },
  forbidden() { return { ok: false as const, code: 'forbidden' as const }; },
  // ...
  databaseError(err: { message: string }) {
    const requestId = crypto.randomUUID();
    console.error('[db]', requestId, err.message);
    return { ok: false as const, code: 'database_error' as const, requestId };
  },
};
```

Database errors are never returned verbatim. The client sees a request ID it can quote to support; the actual error lives in the logs.

## 2. Server Components first

Default to Server Components. Pass Promises down (Next 15) when a child needs streaming. Add `'use client'` only when you need:

- Stateful interactivity (form state, drag-and-drop, optimistic UI)
- Browser APIs (clipboard, geolocation, IndexedDB)
- Third-party libraries that are client-only (some chart libs)

If you reach for `useEffect` to fetch data on mount, stop. The component should be a Server Component. The only legitimate `useEffect` fetches are for things that genuinely change after mount (websocket subs, polling realtime). Even then, prefer Supabase Realtime via a small hook, not a raw `useEffect + fetch`.

## 3. The component registry

Every section component is registered. Pages compose by listing section IDs in a `pages.layout` JSONB. The layout engine reads it.

```ts
// lib/registry/components.ts
import dynamic from 'next/dynamic';

export const COMPONENT_REGISTRY = {
  AvvikKanban: {
    component: dynamic(() => import('@/modules/alert/sections/avvik-kanban')),
    module: 'alert',
    permissions: ['avvik.read'],
    layout: { colspan: 8, defaultRowspan: 'auto' },
    i18nKey: 'sections.avvikKanban',
    preview: '/section-previews/avvik-kanban.png',
  },
  // ...
} as const satisfies Record<string, SectionDefinition>;
```

The registry is typed. Section IDs are a union (`keyof typeof COMPONENT_REGISTRY`). The layout engine refuses unknown IDs at compile time.

**Never** import a section component directly into a page file. The layout engine is the only consumer.

## 4. Forms — React Hook Form + Zod + FormField

```tsx
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createDeviationInput, createDeviation } from '@/modules/alert/actions/create-deviation';
import { FormField } from '@/components/data/form-field';

export function CreateDeviationForm() {
  const form = useForm<z.infer<typeof createDeviationInput>>({
    resolver: zodResolver(createDeviationInput),
    defaultValues: { severity: 'medium' },
  });

  async function onSubmit(values: z.infer<typeof createDeviationInput>) {
    const result = await createDeviation(values);
    if (!result.ok) {
      if (result.code === 'invalid') {
        Object.entries(result.fieldErrors).forEach(([name, msgs]) => {
          form.setError(name as never, { message: msgs[0] });
        });
        return;
      }
      toast.error(t(`errors.${result.code}`));
      return;
    }
    router.push(`/avvik/${result.data.id}`);
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <FormField name="title" label={t('deviation.title')} />
      <FormField name="severity" label={t('deviation.severity')} render={(field) => <SeveritySelect {...field} />} />
      {/* ... */}
    </form>
  );
}
```

`FormField` wraps shadcn's `Label`, the control, and `FormMessage`. It reads the schema description (Zod's `.describe()`) for the helper text.

## 5. i18n

- Default `nb-NO`, fallback `en`.
- All strings go through `t()`. No raw user-facing strings in JSX.
- Translation files under `messages/<locale>.json` (next-intl).
- Pluralization via ICU MessageFormat.
- Norwegian text reviewed for tone (formal `du`, no superlatives, no emojis).
- Built-in template content (templates table) is itself localized — `templates.locale` column. The Norwegian version is the source of truth.

## 6. State management

- Server state: Supabase + React Server Components + Server Actions. No client cache beyond router-level Next.js cache.
- Client state: `useState` for component-local, `useReducer` for complex local, URL state (`useSearchParams`) for things shareable via link.
- No Redux, no Zustand, no Jotai, no Recoil, no React Query. If you reach for one, the design is probably wrong — the data should live on the server.

## 7. Error handling

Three layers:

### Action layer
Returns `ActionResult`. Never throws.

### Component layer (Client)
Renders the appropriate state component based on the result code:
- `invalid` → inline errors via `form.setError`
- `unauthorized` → toast + redirect to login
- `forbidden` → `<ErrorState>` "Du har ikke tilgang til dette"
- `not_found` → `<ErrorState>` "Fant ikke"
- `database_error` → toast with request ID

### Route layer (Server)
`error.tsx` files at every route segment. Render `<ErrorState>` with a retry. Log to Vercel + Sentry.

`not-found.tsx` files where 404s are possible.

## 8. Testing strategy

### Unit
- Pure functions: vitest. Co-located `*.test.ts`. Fast, no mocks beyond stubs.
- Server Actions: not unit-tested; covered by integration tests.

### Integration (the bulk of tests)
- Each Server Action has a test under `modules/<module>/actions/*.int.test.ts` that:
  1. Spins up a local Supabase (`supabase start`)
  2. Seeds two orgs, several users with different roles
  3. Calls the action as each user, asserts the result code and DB state
- Run via `vitest --pool threads` against the local Supabase instance.

### Database (pgTAP)
- RLS matrix tests per table — see SECURITY.md and DATABASE.md.
- Run via `supabase test db` in CI.

### Component (React Testing Library)
- Only for components with non-trivial interaction (forms, builders).
- Read-only display components are not tested at the component level; they're covered by Playwright.

### E2E (Playwright)
- One happy path per major user journey. We do not chase E2E coverage; they're slow and flaky.
- Critical paths: org signup, varsling submission via public form, varsling read by committee, deviation create → close, AMU meeting end-to-end.

### Visual regression
- Chromatic or Percy on key registered section components. Run on PR.

## 9. CI pipeline

Every PR:
1. `pnpm install --frozen-lockfile`
2. `pnpm typecheck` (no errors)
3. `pnpm lint` (no errors, includes our custom rules)
4. `gitleaks` (no secrets)
5. `pnpm audit --audit-level high` (no high+ vulns)
6. `supabase start` + `supabase db push` (apply migrations)
7. `supabase test db` (pgTAP RLS + anonymity tests)
8. `pnpm test` (vitest unit + integration)
9. `pnpm test:e2e` on a deployed preview (Playwright)
10. Chromatic visual regression

Merging requires all checks green and a code-owner review of any file under `supabase/migrations/`, `lib/registry/`, or `lib/rbac/`.

## 10. Observability

- **Application logs**: structured JSON, no PII. `request_id`, `user_id` (or `anonymous`), `org_id`, `action`, `outcome`.
- **Audit log**: the system of record for security-relevant events. See DATABASE.md.
- **Sentry**: errors + performance. PII scrubbing on at the SDK level.
- **Supabase logs**: query timing for slow-query detection. Scrubbed for public endpoints.
- **Synthetic checks**: 5-minute uptime on `/health` and `/api/health/db` from a few European regions.

Every Server Action call generates a request ID. The client sees it on errors. Support quotes it; we find the trace.

## 11. Performance budget

- Server-rendered HTML for an interactive page: ≤ 80 kB compressed.
- Client JS for a route: ≤ 150 kB compressed first load. Dashboard heavy with charts may go to 250 kB; budget it explicitly.
- LCP ≤ 2.5 s on a mid-range device on 4G.
- TTI ≤ 4 s on the same.
- Database query budget: 95th percentile ≤ 250 ms for list views; ≤ 50 ms for detail views.

Lighthouse runs in CI on the deployed preview. PR fails if a budget regresses by > 10 %.

## 12. Accessibility

- Lint with `eslint-plugin-jsx-a11y` at error level.
- Manual screen-reader pass on every new section component.
- Tab order verified before merge.
- Color contrast verified (already passes given the palette).
- See DESIGN_SYSTEM.md §13.

## 13. Commit hygiene

- Conventional commits: `feat(alert): add severity filter to kanban`.
- One concern per PR. A migration + its UI is one PR; an unrelated refactor is another.
- PR description follows a template: Summary, Test plan, Compliance impact.
- The PR is merged via squash. The squash message is the same conventional commit.

## 14. Branching

- `main` is always deployable.
- Feature branches: `claude/<short-name>-<slug>` or `<user>/<short-name>`.
- No long-lived branches. If a feature is too big, ship it behind a `module_config` flag.

## 15. Feature flags

- Live in `module_config` rows, scoped per org.
- Read server-side. Never burn into UI strings (see CLAUDE.md "lessons paid for already").
- Two kinds:
  - **Module toggles**: `organization_modules.enabled`. The whole module on/off.
  - **Within-module flags**: `module_config(organization_id, key, value)`. Granular features.
- Removing a flag is a separate PR after the feature has been stable for a release. Dead flags rot fast.

## 16. Documentation

- Module instruction files in `.claude/modules/` are the engineering docs. Keep them current — if a module's behavior diverges from its `.md`, update the `.md` first.
- Runbooks under `docs/runbooks/` for ops events: incident response, breach notification, secret rotation, restore from backup.
- No README-driven development. The CLAUDE.md and module files are the source.

## 17. The accountability checklist (every PR)

Mentally walk through this before requesting review:

- [ ] Does this change touch RLS? If yes, did I add pgTAP coverage?
- [ ] Did I add a Zod schema for every new Server Action?
- [ ] Did I cross any module boundary? If yes, is it through a workflow trigger?
- [ ] Did I touch personal data? If yes, did I set a `retention_class`?
- [ ] Did I add a new section? If yes, is it registered with `module` and `permissions`?
- [ ] Did I add a new outbox/queue? If yes, did I ship the worker in the same PR?
- [ ] Did I write any nb-NO text? Did a fluent reviewer check the tone?
- [ ] Will an Arbeidstilsynet inspector see this in an export? If yes, does it print cleanly?

## 18. What not to do

- Don't use `fetch` for internal data. Use Server Actions or Server Components.
- Don't use a `try / catch` in a Server Action that swallows an error. Either return an `ActionResult` or let the framework's error boundary handle it.
- Don't pass the Supabase client around as a prop. Create it per call site with `createServerClient()` / `createClient()`.
- Don't write a custom hook that wraps another hook to "make it easier". The team should read the underlying API.
- Don't add a comment that restates the code. Add a comment that explains *why*.
- Don't optimize prematurely. Measure first.
- Don't ship a feature whose backend isn't done. No `disabled` buttons hiding TODOs.
