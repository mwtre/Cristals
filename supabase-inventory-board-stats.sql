CREATE TABLE IF NOT EXISTS inventory_board_stats (
  id text PRIMARY KEY DEFAULT 'global',
  updated_at timestamptz NOT NULL DEFAULT now(),
  payload_version int NOT NULL DEFAULT 1,
  location_count int NOT NULL DEFAULT 0,
  top_level_cards int NOT NULL DEFAULT 0,
  item_card_count int NOT NULL DEFAULT 0,
  box_count int NOT NULL DEFAULT 0,
  nested_item_count int NOT NULL DEFAULT 0,
  total_piece_qty int NOT NULL DEFAULT 0,
  movements_stored int NOT NULL DEFAULT 0
);

COMMENT ON TABLE inventory_board_stats IS 'Dashboard counts mirroring last inventory_movements sync; not a second source of truth.';

ALTER TABLE inventory_board_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read and write inventory_board_stats"
  ON inventory_board_stats FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);
