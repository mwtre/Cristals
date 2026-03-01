-- Run in Supabase SQL Editor after factory_areas exists.
-- v2 map: same structure so areas can have different positions/names than main.

create table if not exists factory_areas_v2 (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  x integer not null default 0,
  y integer not null default 0,
  width integer not null default 100,
  height integer not null default 80,
  color text not null default '#94a3b8',
  status text not null default 'active' check (status in ('active', 'maintenance', 'idle')),
  area_type text not null default 'production',
  current_load integer not null default 0,
  capacity integer not null default 100,
  updated_at timestamptz not null default now()
);

alter table factory_areas_v2 enable row level security;

create policy "Allow anon read and write factory_areas_v2"
  on factory_areas_v2 for all to anon
  using (true) with check (true);

-- Optional: map-level details (e.g. title, notes) for main and v2
create table if not exists factory_map_details (
  id text primary key default 'main' check (id in ('main', 'v2')),
  title text,
  notes text,
  updated_at timestamptz not null default now()
);

alter table factory_map_details enable row level security;

create policy "Allow anon read and write factory_map_details"
  on factory_map_details for all to anon
  using (true) with check (true);

insert into factory_map_details (id, title, notes) values
  ('main', 'Main layout', null),
  ('v2', 'v2 Compare layout', null)
on conflict (id) do nothing;
