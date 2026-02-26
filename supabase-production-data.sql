create table production_data (
  key text primary key,
  value jsonb
);

alter table production_data enable row level security;

create policy "Allow anon read and write"
  on production_data for all
  to anon
  using (true)
  with check (true);
