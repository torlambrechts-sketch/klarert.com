# Register module — Stoffkartotek (Chemical register)

Load this when working on the chemical register, safety data sheets, hazard symbols, or *Forskrift om utførelse av arbeid* compliance.

## Purpose

A searchable register of all chemicals and hazardous substances used in the organization, with their safety data sheets (SDS / *sikkerhetsdatablad*). Required by *Forskrift om utførelse av arbeid* § 1-4 and the EU CLP regulation. The data sheet must be the current version (suppliers update them; outdated sheets are a non-conformity finding).

## Schema

```sql
create table chemicals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  manufacturer text,
  product_number text,
  cas_number text,                                -- CAS chemical identifier
  ec_number text,                                 -- EC inventory number
  description text,
  usage_areas text[],                             -- where it's used in the org
  hazard_pictograms text[],                       -- ['GHS01', 'GHS02', ...] — CLP standard codes
  hazard_statements text[],                       -- H-codes from CLP
  precautionary_statements text[],                -- P-codes from CLP
  signal_word text check (signal_word in ('Danger', 'Warning', null)),
  risk_assessment_id uuid,                        -- FK to risk_assessments table (later)
  storage_location text,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz default now(),
  created_by uuid references profiles(id)
);

create table safety_data_sheets (
  id uuid primary key default gen_random_uuid(),
  chemical_id uuid not null references chemicals(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  version text,
  language text not null default 'nb',
  file_path text not null,                        -- Supabase Storage
  issued_date date,
  uploaded_at timestamptz default now(),
  uploaded_by uuid references profiles(id),
  is_current boolean not null default false       -- only one current sheet per chemical+language
);

-- Partial unique index: only one current SDS per (chemical, language)
create unique index sds_current_unique
  on safety_data_sheets (chemical_id, language)
  where is_current = true;

create table chemical_exposure_records (
  -- Optional v2 table; per AML some chemicals require exposure tracking
  id uuid primary key default gen_random_uuid(),
  chemical_id uuid not null references chemicals(id),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id),
  exposed_at timestamptz not null,
  duration_minutes int,
  context text,
  recorded_by uuid references profiles(id),
  created_at timestamptz default now()
);
```

## CLP hazard pictograms

The 9 GHS/CLP pictograms are a closed set. Bundle them as SVG assets and render by code. Don't fetch from external CDNs.

| Code | Name | Symbol |
|---|---|---|
| GHS01 | Explosive | exploding bomb |
| GHS02 | Flammable | flame |
| GHS03 | Oxidizing | flame over circle |
| GHS04 | Compressed gas | gas cylinder |
| GHS05 | Corrosive | corrosion |
| GHS06 | Acute toxicity | skull and crossbones |
| GHS07 | Harmful | exclamation mark |
| GHS08 | Health hazard | health hazard silhouette |
| GHS09 | Environmental hazard | dead tree and fish |

These render in lists and detail views; the data-grid must show them as icons (with `title` attributes for screen readers).

## SDS expiry

There's no formal expiry date on an SDS, but a sheet older than 3 years is a red flag — suppliers typically update them more often. The system surfaces sheets where `issued_date < now() - interval '3 years'` in the admin dashboard.

A workflow trigger: SDS aged > 3 years creates a task to verify with the supplier.

Real expiry comes from the supplier reissuing the sheet; uploading a new one with the same chemical_id + language marks the old one `is_current = false` and the new one `is_current = true`. The partial unique index enforces this.

## Access

The whole point of the register is that every employee can find an SDS quickly when needed (the fire/poison center may ask). So:

- All employees can **read** the register and download SDSes
- Only HMS leads can add/edit chemicals
- Only HMS leads can mark a new SDS as current

## Search

Full-text on name, manufacturer, CAS, EC, product number. Use Postgres `tsvector`:

```sql
alter table chemicals add column search_text tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(manufacturer, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(cas_number, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(product_number, '')), 'C')
  ) stored;

create index chemicals_search_idx on chemicals using gin (search_text);
```

The data grid should support filter by pictogram (multi-select) and by usage area.

## Section components

- `ChemicalGrid` — fast data grid with pictogram icons, search, filter
- `ChemicalDetail` — full chemical info, SDS download, version history
- `ChemicalEditor` — admin form for adding/editing
- `SdsUploader` — upload a new SDS, sets it as current
- `SdsExpiryReport` — for HMS lead: list of SDSes older than 3 years
- `ChemicalSearch` — embeddable search (used on the home page for quick access)

## Templates this module ships

System templates here are starter chemical lists — e.g. a "cleaning supplies" template for a small office, an "auto repair shop" template for a garage. These are example data sets the org can import. Build one:

- `chemical_starter_office_nb` — common office cleaning products with their typical hazards

## Deliverables checklist

- [ ] Migration with `chemicals`, `safety_data_sheets`, optional `chemical_exposure_records`
- [ ] Partial unique index on `(chemical_id, language) where is_current`
- [ ] `tsvector` column and GIN index
- [ ] Pictogram SVG bundle in `public/icons/ghs/`
- [ ] Storage bucket for SDS files
- [ ] Server Actions: `createChemical`, `uploadSds`, `markSdsCurrent`, `archiveChemical`
- [ ] Workflow trigger: aged SDS → task to HMS lead
- [ ] Section components registered
- [ ] Starter template seeded

## What not to do

- Don't fetch pictograms from external sources. Bundle them.
- Don't allow two current SDSes for the same chemical + language (enforced by the partial unique index — verify it works).
- Don't auto-archive a chemical just because the SDS is old. Archival is an explicit decision (the chemical may still be in inventory).
