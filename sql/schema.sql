-- Rack Planner: the two lists the app shares between people.
-- Run this once in the Supabase SQL editor of whichever project you point
-- config.js at. Everything is prefixed rack_ so it can sit beside the tables
-- of another system without getting in their way.

create table if not exists rack_racks (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  length_cm   numeric not null check (length_cm > 0),
  width_cm    numeric not null check (width_cm > 0),
  height_cm   numeric not null check (height_cm > 0),
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

comment on table rack_racks is
  'Shelf sizes people can pick from. The usable opening, not the outside of the frame.';

create table if not exists rack_box_presets (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  length_cm   numeric not null check (length_cm > 0),
  width_cm    numeric not null check (width_cm > 0),
  height_cm   numeric not null check (height_cm > 0),
  notes       text,
  created_at  timestamptz not null default now()
);

comment on table rack_box_presets is
  'Carton sizes worth keeping, so nobody retypes them.';

-- The rack everybody starts from.
insert into rack_racks (name, length_cm, width_cm, height_cm, is_default)
values ('Standard Rack', 240, 120, 85, true)
on conflict (name) do nothing;

-- Access. The app has no sign-in of its own, so it reaches these tables with
-- the publishable key as the anonymous role. That means anyone who can open
-- the page can add or remove a rack or a preset. These two lists hold nothing
-- but measurements, which is why that trade is acceptable here -- if the app
-- ever gains a login, replace `anon` below with `authenticated`.
alter table rack_racks enable row level security;
alter table rack_box_presets enable row level security;

drop policy if exists rack_racks_all on rack_racks;
create policy rack_racks_all on rack_racks
  for all to anon, authenticated using (true) with check (true);

drop policy if exists rack_box_presets_all on rack_box_presets;
create policy rack_box_presets_all on rack_box_presets
  for all to anon, authenticated using (true) with check (true);

-- Imported SKU sheets. The newest import is what the racks dashboard lays
-- out; where each SKU lands is worked out in the browser from these rows and
-- the import's rules, never stored, so changing a rule is instant and every
-- PC agrees.

create table if not exists rack_imports (
  id           uuid primary key default gen_random_uuid(),
  file_name    text not null,
  row_count    integer not null default 0,
  rules        jsonb not null default '{}'::jsonb,
  imported_at  timestamptz not null default now()
);

create table if not exists rack_skus (
  id              bigint generated always as identity primary key,
  import_id       uuid not null references rack_imports(id) on delete cascade,
  line_no         integer not null,
  tier            text,
  category        text,
  sku             text not null,
  sold_per_day    numeric,
  quantity        numeric,
  length_cm       numeric,
  width_cm        numeric,
  height_cm       numeric,
  needed_qty_15d  numeric,   -- no longer read or written: sold per day x days
  qty_per_box     numeric,
  total_boxes     numeric    -- no longer read or written: needed qty / qty per box
);

create index if not exists rack_skus_import_line on rack_skus (import_id, line_no);
create index if not exists rack_imports_newest on rack_imports (imported_at desc);

alter table rack_imports enable row level security;
alter table rack_skus enable row level security;

drop policy if exists rack_imports_all on rack_imports;
create policy rack_imports_all on rack_imports
  for all to anon, authenticated using (true) with check (true);

drop policy if exists rack_skus_all on rack_skus;
create policy rack_skus_all on rack_skus
  for all to anon, authenticated using (true) with check (true);

-- Which SKUs sit on which 4KB shelf, chosen by hand. One row per SKU on a
-- shelf; several SKUs may share one.
create table if not exists rack_shelves (
  import_id    uuid not null references rack_imports(id) on delete cascade,
  label        text not null,
  sku_id       bigint not null references rack_skus(id) on delete cascade,
  qty          numeric check (qty is null or qty > 0), -- units moved there; null: as many as fit
  assigned_at  timestamptz not null default now(),
  primary key (import_id, label, sku_id)
);

create index if not exists rack_shelves_sku on rack_shelves (sku_id);

alter table rack_shelves enable row level security;

drop policy if exists rack_shelves_all on rack_shelves;
create policy rack_shelves_all on rack_shelves
  for all to anon, authenticated using (true) with check (true);

-- What an outside feed last did: one row per feed, rewritten each run.
-- "jsterp-4kb" is the 4KB Qty from JSTERP (extension/), every 30 seconds.
create table if not exists rack_sync (
  name       text primary key,
  synced_at  timestamptz,
  ok         boolean not null default true,
  message    text,
  info       jsonb not null default '{}'::jsonb
);

alter table rack_sync enable row level security;

drop policy if exists rack_sync_all on rack_sync;
create policy rack_sync_all on rack_sync
  for all to anon, authenticated using (true) with check (true);

-- Live changes: every open page hears about these at once.
-- alter publication supabase_realtime add table rack_imports, rack_skus, rack_shelves, rack_sync;

-- ---------------------------------------------------------------------------
-- Accounts, sign-in and the sync laptops (migrations
-- rack_accounts_and_sync_laptops and rack_sync_standby_window, 2026-11-05).
-- In short:
--   rack_accounts      user_id -> role (admin | editor | viewer), disabled.
--                      Written only by the rack-accounts edge function.
--   rack_settings      require_sign_in (jsonb true / false).
--   rack_sync_devices  one row per Chrome with the extension; secret_hash is
--                      readable by nobody.
--   rack_role(), rack_open(), rack_can_read(), rack_can_edit(),
--   rack_has_admin()   what every table's policies ask. While
--                      require_sign_in is false, rack_open() is true and
--                      everything stays as open as it was.
--   jst_checkin(), jst_sync()  the extension's only way in, callable without
--                      signing in; they check the laptop's secret.
-- The migrations hold the full definitions.
