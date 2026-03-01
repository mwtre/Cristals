# Product route system (add-on)

## Purpose
- Build **product routes**: ordered sequence of stops (QC → production → kitting → labelling → expedition).
- **Calculate total time** from:
  - **Travel time** between consecutive locations (distance from factory map areas).
  - **Dwell time** at each stop (fixed per type or custom).

## Stop types
| Type       | Default dwell | Description        |
|-----------|----------------|--------------------|
| QC        | 15 min         | Quality check      |
| Production | 45 min        | Production step   |
| Kitting   | 20 min         | Kitting            |
| Labelling | 10 min         | Labelling          |
| Expedition | 5 min         | Pack & ship        |

## Time calculation
- **Travel**: distance between two consecutive stops (from `factory_areas` x,y) × scale (e.g. 0.05 min per unit) = travel minutes.
- **Dwell**: per-step dwell (default by type or user override).
- **Total route time** = Σ (dwell at step) + Σ (travel from step i to step i+1).

## Data
- **Routes** stored in `localStorage` (key: `cristal_product_routes`). Optional later: Supabase table `product_routes`.
- Each route: `{ id, name, steps: [{ type, areaId?, areaName?, dwellMinutes }] }`.
- Areas for distance come from Supabase `factory_areas` when the Routes step is opened (same as Factory map).

## UI
- New step **Routes** (step 10) after Factory map.
- List of saved routes; add / edit / delete.
- For each route: name, ordered steps (type + optional area + dwell), **total time** displayed.
- Add step: choose type, optionally link to a factory area (for travel), set dwell minutes.
