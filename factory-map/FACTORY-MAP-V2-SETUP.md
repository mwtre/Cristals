# Factory map v2 and map details (Supabase)

## Tables

1. **factory_areas** — Main map layout (existing). Areas with name, position (x, y), size (width, height), color, status, etc.

2. **factory_areas_v2** — v2 Compare layout. Same structure as `factory_areas`. When you switch to "v2 Compare", the map uses this table so you can have different positions and names for areas and compare performance (e.g. routes) between the two layouts.

3. **factory_map_details** (optional) — Map-level metadata: `id` ('main' | 'v2'), `title`, `notes`. For future use.

4. **product_routes** — Routes for Main and v2. Run **supabase-product-routes.sql** so routes sync across devices (like map areas).

## Setup

1. Run **supabase-factory-areas.sql** first (creates `factory_areas` and seeds it).
2. Run **supabase-factory-areas-v2.sql** (creates `factory_areas_v2` and optional `factory_map_details`). Paste only the SQL.
3. Run **supabase-product-routes.sql** (creates `product_routes` for saving routes to Supabase). Paste only the SQL.

## Usage

- **Main**: Areas come from `factory_areas`. Edit name, position, size in the side panel; drag/resize on the map. Saves to `factory_areas`.
- **v2 Compare**: Areas come from `factory_areas_v2`. If v2 is empty, click **Copy main layout to v2** to clone the current main areas into v2, then move/rename squares independently. Saves go to `factory_areas_v2`.
