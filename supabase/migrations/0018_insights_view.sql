-- 0018 · The Insights view (docs/05 §3.6): a sheet's charts and figures are a view like Kanban or Calendar, so its
-- layout lives in views.config.insights and is saved through the view commands under the views RLS policies.
-- Only the allowed types change; existing values stay.
alter table views drop constraint if exists views_type_check;
alter table views add constraint views_type_check
  check (type in ('list', 'grid', 'kanban', 'calendar', 'form', 'insights'));
