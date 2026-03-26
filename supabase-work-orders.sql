-- Normalized work orders for Table Editor, reporting, and integrations.
-- Run in Supabase SQL Editor (same project as production_data).
-- The inventory board still stores full state in production_data key inventory_movements
-- (locations, all item cards including boxes: kind, parentBoxItemId, containedItemIds, movements).
-- For sync health counts (boxes, nested lines, etc.) run supabase-inventory-board-stats.sql.
-- This table is updated in lockstep so each WO has a visible row + process stage.

create table if not exists work_orders (
  id text primary key,
  status text not null
    check (status in ('incoming', 'inProduction', 'finished', 'shipping', 'archived')),
  client text,
  location_id text,
  requirements jsonb not null default '[]'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists work_orders_status_idx on work_orders (status);
create index if not exists work_orders_updated_at_idx on work_orders (updated_at desc);

comment on table work_orders is 'Inventory board WOs; status = pipeline stage (incoming → archived).';
comment on column work_orders.status is 'incoming | inProduction | finished | shipping | archived';
comment on column work_orders.requirements is 'JSON array: [{ label, required, filled }, ...]';

alter table work_orders enable row level security;

create policy "Allow anon read and write work_orders"
  on work_orders for all
  to anon
  using (true)
  with check (true);

-- updated_at is set by the inventory board on each sync.
