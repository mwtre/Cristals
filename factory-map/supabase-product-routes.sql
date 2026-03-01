-- Run in Supabase SQL Editor (paste only the SQL, no markdown).
-- Stores routes for Main and v2 so they sync across devices like the map areas.

create table if not exists product_routes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  points jsonb not null default '[]',
  map_variant text not null default 'main' check (map_variant in ('main', 'v2')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table product_routes enable row level security;

create policy "Allow anon read and write product_routes"
  on product_routes for all to anon
  using (true) with check (true);

create index if not exists product_routes_map_variant_idx on product_routes (map_variant);
