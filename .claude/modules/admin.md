# Admin & Organization module

Load this when working on organizations, users, roles, module activation, or the template management system.

## Purpose

The admin module is the backbone. It owns:

- Organizations (tenants) and their settings
- Users, roles, and the RBAC tables that every other module reads from
- Module activation (which modules are turned on for which org)
- The template management system used by **every** other module

Get this right before building anything else. Every later module depends on it.

## What already exists

You should not redo what `001_core_platform.sql` already created. That migration set up:

- `organizations`, `profiles`, `roles`, `role_permissions`, `user_roles`, `departments`
- `modules` (registry of available modules) and `organization_modules` (which are enabled)
- `pages`, `page_sections` (layout engine), `workflow_triggers`, `workflow_actions`
- `tasks`, `audit_log`, `notifications`
- RLS helper functions (`has_permission`, `current_org_id`)

Your job here is to **add the template system on top** and build the admin UI.

## New tables to add

```sql
-- Generic template store used by every module.
-- module_type is a discriminator ('survey', 'checklist', 'alert', 'meeting', ...).
-- config is the shape the module knows how to interpret.
create table templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade, -- null = system template
  module_type text not null,
  name text not null,
  description text,
  config jsonb not null,
  version int not null default 1,
  parent_template_id uuid references templates(id), -- for "duplicate this system template"
  is_active boolean not null default true,
  is_system boolean not null default false,        -- true only when organization_id is null
  locale text not null default 'nb-NO',
  created_at timestamptz default now(),
  created_by uuid references profiles(id),
  updated_at timestamptz default now()
);

create index templates_org_module_idx on templates(organization_id, module_type) where is_active;
create index templates_system_idx on templates(module_type) where is_system;

-- Constraint: system templates have null org, org templates have non-null org.
alter table templates add constraint templates_system_xor_org
  check ((is_system = true and organization_id is null)
      or (is_system = false and organization_id is not null));
```

## RLS for templates

Three patterns, all needed:

1. **System templates**: readable by everyone, writable only by users with the `platform_admin` permission.
2. **Org templates**: readable by everyone in the org, writable by users with `templates.manage` in that org.
3. **Cross-org leakage**: explicitly denied. A user from org A must not be able to see org B's templates even via timing attacks — the policy must filter, not the application.

```sql
alter table templates enable row level security;

create policy templates_select on templates for select using (
  is_system = true
  or organization_id = current_org_id()
);

create policy templates_insert on templates for insert with check (
  (is_system = true and has_permission('platform.admin'))
  or (organization_id = current_org_id() and has_permission('templates.manage'))
);

create policy templates_update on templates for update using (
  (is_system = true and has_permission('platform.admin'))
  or (organization_id = current_org_id() and has_permission('templates.manage'))
);

create policy templates_delete on templates for delete using (
  (is_system = true and has_permission('platform.admin'))
  or (organization_id = current_org_id() and has_permission('templates.manage'))
);
```

## Duplicating a system template

When an org admin wants to customize a system template, they don't edit the system one — they duplicate it. The duplicate has:

- `organization_id` = their org
- `is_system` = false
- `parent_template_id` = the system template's id
- `config` = deep copy of the system template's config

Implement this as a Server Action `duplicateTemplate(systemTemplateId)`. The user must have `templates.manage` for the duplicate to land in their org. The system template is never modified.

## Module activation

`organization_modules` already exists. Build a "Modules" admin page where org admins can:

- See all available modules
- Toggle enabled/disabled
- See which templates exist for each module
- Quick-link to "create from system template" for each disabled module

When a module is disabled, its pages should disappear from the navigation. The layout engine already filters by permission; extend it to also filter by `organization_modules.enabled`.

## Roles

Built-in roles to seed:

| Role | Scope | Purpose |
|---|---|---|
| `platform_admin` | global | Anthropic-side support; can edit system templates |
| `org_admin` | org | full control of the org |
| `hms_lead` | org | HMS coordinator; manages most modules |
| `verneombud` | org | Safety representative (statutory role under AML) |
| `amu_member` | org | AMU committee member |
| `employee` | org | default role for all users |
| `varsling_committee` | org | restricted: only role that can read whistleblowing cases |

`varsling_committee` is critical. The RLS on whistleblowing alerts must be scoped to this role *and only this role* plus the reporter (via the anonymous tracking code path). See `alert.md`.

## Admin UI

Use the existing `PageShell` + `COMPONENT_REGISTRY` pattern. Register these section components:

- `OrgSettingsForm` — name, org number, address, settings JSON
- `UserList` — invite, deactivate, assign roles
- `RoleEditor` — edit role permissions (only for `org_admin`)
- `ModuleToggleList` — enable/disable modules
- `TemplateLibrary` — list templates filtered by module, with "Duplicate" / "Edit" / "Activate" actions
- `TemplateEditor` — wraps the module-specific editor (each module exports its own; see e.g. `survey.md`)

All admin pages live at `/[org]/admin/...`. The layout engine handles permission filtering.

## Deliverables checklist

- [ ] Migration `002_templates.sql` with the `templates` table, indexes, constraints, RLS, and audit trigger
- [ ] Seed migration `003_seed_roles_and_modules.sql` with the built-in roles and module registry entries
- [ ] Server Actions: `createTemplate`, `updateTemplate`, `duplicateTemplate`, `deactivateTemplate`, `listTemplates(moduleType, scope)`
- [ ] Section components registered in `COMPONENT_REGISTRY`
- [ ] Admin pages composed from registry sections (no direct imports)
- [ ] Zod schemas exported for all actions

## Things to verify before moving on

Open a SQL console as two different users in two different orgs and run `select * from templates;`. Each user sees only their own org's templates plus system templates. If user A can see user B's org's data even once, the RLS is broken — stop and fix before continuing to other modules.
