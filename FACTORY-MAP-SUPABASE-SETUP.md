# Factory map – Supabase setup

The Factory map uses the **same Supabase project** as Production Stats (timer). You already have `window.CRISTAL_SUPABASE_URL` and `window.CRISTAL_SUPABASE_ANON_KEY` set in `index.html`.

To save and load area positions/sizes, add the `factory_areas` table:

1. Open your [Supabase Dashboard](https://supabase.com/dashboard) and select the same project you use for Production Stats.
2. Go to **SQL Editor**.
3. Copy **only the SQL** from the file `supabase-factory-areas.sql` (or the block below). Do **not** copy markdown or code fences (no \`\`\`).
4. Paste into the SQL Editor and click **Run**.

After it runs, refresh the app and open the Factory map step again. The message will disappear and positions/sizes will save.

---

**SQL to run** (same as in `factory-map/supabase-factory-areas.sql`):

```sql
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
  ('Rack', 860, 540, 210, 320, '#64748b', 'storage', 100);
```

Copy from `create table` through the last `);` and paste into the SQL Editor.
