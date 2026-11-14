-- 0045 · An index on fields(sheet_id) for every field, archived ones included.
--
-- activity_a_mask (0027, 0036) runs for every activity entry and, for an item.created entry, reads the sheet's
-- restricted and personal-data fields with `where sheet_id = … and (restricted_to is not null or
-- _field_personal(config))`, archived fields included (their values are masked too). The only sheet_id indexes were
-- partial (archived_at is null; restricted_to is not null), so that read was a sequential scan of every field of
-- every workspace, once per created item: creating items got slower as the whole database grew (10 000 rows from an
-- import took over 8 s, the API's statement timeout, once the table held about 8 000 fields). With this index it
-- reads the sheet's own fields.
create index if not exists fields_sheet_all_idx on fields(sheet_id);
