-- Trend lines in the Table (docs/05 §3.1) read a sheet's recent value.changed entries in one query:
-- sheet, newest first. A partial index keeps that read cheap as the log grows.
create index if not exists activity_sheet_values_idx
  on activity_log(sheet_id, at desc)
  where action = 'value.changed';
