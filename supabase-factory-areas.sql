create table factory_areas (
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

alter table factory_areas enable row level security;

create policy "Allow anon read and write factory_areas"
  on factory_areas for all to anon
  using (true) with check (true);

insert into factory_areas (name, x, y, width, height, color, area_type, capacity) values
  ('Expedition', 100, 120, 450, 200, '#c084fc', 'production', 100),
  ('Receiving', 600, 120, 450, 200, '#34d399', 'production', 100),
  ('Inventory', 600, 340, 450, 380, '#60a5fa', 'storage', 100),
  ('Digital printer 1', 100, 540, 220, 320, '#fbbf24', 'production', 100),
  ('Digital printer 2', 340, 540, 220, 320, '#fbbf24', 'production', 100),
  ('Sandblasting', 600, 540, 240, 320, '#f97316', 'production', 100),
  ('Rack', 860, 540, 210, 320, '#64748b', 'storage', 100),
  ('Table 1', 100, 340, 120, 80, '#a78bfa', 'production', 100),
  ('Table 2', 240, 340, 120, 80, '#a78bfa', 'production', 100),
  ('Table 3', 380, 340, 120, 80, '#a78bfa', 'production', 100),
  ('Table 4', 100, 440, 120, 80, '#a78bfa', 'production', 100),
  ('Table 5', 240, 440, 120, 80, '#a78bfa', 'production', 100),
  ('PC station 1', 520, 340, 100, 80, '#22d3ee', 'production', 100),
  ('PC station 2', 640, 340, 100, 80, '#22d3ee', 'production', 100),
  ('Pallet 1', 600, 760, 100, 100, '#92400e', 'storage', 100),
  ('Pallet 2', 720, 760, 100, 100, '#92400e', 'storage', 100),
  ('Pallet 3', 840, 760, 100, 100, '#92400e', 'storage', 100),
  ('Trash zone', 960, 760, 100, 100, '#6b7280', 'storage', 100);
