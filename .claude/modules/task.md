# Task module

Load this when working on the central task tracker or its Kanban view.

## Purpose

Every other module produces tasks: a deviation needs follow-up action, a survey result needs review, a checklist item failed, an AMU meeting passed a vote. Rather than each module reinventing assignment, deadlines, and status, they all create rows in `tasks`.

The `tasks` table already exists from `001_core_platform.sql`. This file describes how to **use it correctly** and what UI to build.

## The contract

Every task has:

- A `source_module` and `source_id` pointing back to the originating object
- A clear `title` (human-readable, doesn't require opening the source)
- An `assigned_to` (a profile, never a role — assignment is concrete)
- A `due_at`
- A `status` from `('open', 'in_progress', 'blocked', 'done', 'cancelled')`
- A `priority` from `('low', 'normal', 'high', 'urgent')`

Tasks are never created by a section component directly. They are created by a workflow action `create_task`. This is enforced by:

- Server Action `createTask` requiring a `workflow_run_id` parameter (or a `manual: true` flag with audit reason)
- A trigger on `tasks` that writes the origin to `audit_log`

## Cross-module linkage

When a deviation generates a task, the task carries `source_module = 'deviations'` and `source_id = <deviation_id>`. The task detail view fetches a one-line summary from the source via a SQL view `task_source_summary` that joins per module type.

Don't fetch the source from the client. Use the view, server-side, in the task detail page.

## Views

Two main views, both registered as section components:

- `TaskKanban` — columns by status, swimlanes optional (by assignee, by module)
- `TaskList` — table view with filters: assignee, status, module, due window, priority

Both views read from a single SQL function `list_tasks(filters jsonb)` that handles permission filtering, joining, and pagination server-side. Don't paginate in the client.

## Personal vs admin views

A regular employee sees only tasks assigned to them. HMS leads see all open tasks in the org. AMU members see tasks linked to AMU meeting decisions. Drive this from `role_permissions`, not from inline checks.

## Workflows

A task becoming overdue triggers a notification to the assignee, then to the manager after 3 days. This is itself a workflow trigger — `event = 'task.overdue'`, action `create_notification`.

A task being closed should bubble up to its source: closing a task linked to a deviation may transition the deviation's status, depending on the deviation's template config. The workflow engine handles this; don't write a `useEffect` that polls.

## Section components

- `TaskKanban` — drag-and-drop between columns, optimistic UI
- `TaskList` — filterable, sortable, with quick-edit on rows
- `TaskDetail` — single-task page with linked source, comments, audit timeline
- `TaskInbox` — assignee-scoped view (this is the user's "my work" page)
- `TaskComplianceWidget` — for dashboards: counts overdue tasks per module

## Deliverables checklist

- [ ] No new tables (uses existing `tasks`)
- [ ] `task_source_summary` SQL view
- [ ] `list_tasks` SQL function with permission filtering
- [ ] Server Actions: `createTask` (workflow-only), `updateTaskStatus`, `assignTask`, `addComment`
- [ ] Section components registered
- [ ] Audit trigger on `tasks` (state change → `audit_log`)
- [ ] Notification workflow triggers for overdue tasks

## What not to do

- Don't let modules write to `tasks` directly. Always through `createTask` and the workflow engine.
- Don't denormalize source data into the task row (no `deviation_severity` column). Use the view.
- Don't show all tasks to all users — even read-only. Permission filter at the SQL level.
