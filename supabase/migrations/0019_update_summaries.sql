-- 0019 · Comment markers on rows and cards (docs/05 §3.1): per item of a sheet, how many updates people wrote and the
-- latest one's opening words and author, for the bubble's count and tooltip. One grouped read instead of every update
-- row. SECURITY INVOKER: item_updates and items RLS apply, so a person only counts what they may read.
create or replace function item_update_summaries(p_sheet uuid)
returns table (item_id uuid, updates integer, last_body text, last_author uuid, last_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select u.item_id,
         count(*)::integer,
         (array_agg(left(u.body, 200) order by u.created_at desc))[1],
         (array_agg(u.author_id order by u.created_at desc))[1],
         max(u.created_at)
    from item_updates u
    join items i on i.id = u.item_id
   where i.sheet_id = p_sheet and u.kind = 'update' and i.archived_at is null
   group by u.item_id
$$;

revoke execute on function item_update_summaries(uuid) from public, anon;
grant execute on function item_update_summaries(uuid) to authenticated;
