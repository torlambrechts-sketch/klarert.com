-- 0031_requirement_details.sql · richer requirement content and official short titles (docs/12 Licensing)
-- Titles may be the official short clause, control or article headings (titles = 'official-short'); everything
-- else we ship is our own words: a purpose, guidance, audit questions and typical evidence.

alter table frameworks drop constraint if exists frameworks_titles_check;
alter table frameworks add constraint frameworks_titles_check check (titles in ('own-words', 'official-short'));

alter table requirements
  add column purpose   text check (purpose is null or char_length(purpose) between 1 and 300),
  add column questions text[] not null default '{}' check (cardinality(questions) <= 8),
  add column evidence  text[] not null default '{}' check (cardinality(evidence) <= 10);
