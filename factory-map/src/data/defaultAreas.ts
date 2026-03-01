import type { FactoryArea } from '../types/database';

/** Demo areas when Supabase is unavailable or table is empty. Matches supabase-factory-areas.sql seed. */
export const DEFAULT_AREAS: Omit<FactoryArea, 'id' | 'updated_at'>[] = [
  { name: 'Expedition', x: 100, y: 120, width: 450, height: 200, color: '#c084fc', status: 'active', area_type: 'production', current_load: 0, capacity: 100 },
  { name: 'Receiving', x: 600, y: 120, width: 450, height: 200, color: '#34d399', status: 'active', area_type: 'production', current_load: 0, capacity: 100 },
  { name: 'Inventory', x: 600, y: 340, width: 450, height: 380, color: '#60a5fa', status: 'active', area_type: 'storage', current_load: 0, capacity: 100 },
  { name: 'Digital printer 1', x: 100, y: 540, width: 220, height: 320, color: '#fbbf24', status: 'active', area_type: 'production', current_load: 0, capacity: 100 },
  { name: 'Digital printer 2', x: 340, y: 540, width: 220, height: 320, color: '#fbbf24', status: 'active', area_type: 'production', current_load: 0, capacity: 100 },
  { name: 'Sandblasting', x: 600, y: 540, width: 240, height: 320, color: '#f97316', status: 'active', area_type: 'production', current_load: 0, capacity: 100 },
  { name: 'Rack', x: 860, y: 540, width: 210, height: 320, color: '#64748b', status: 'active', area_type: 'storage', current_load: 0, capacity: 100 },
  { name: 'Table 1', x: 100, y: 340, width: 120, height: 80, color: '#a78bfa', status: 'active', area_type: 'production', current_load: 0, capacity: 100 },
  { name: 'Table 2', x: 240, y: 340, width: 120, height: 80, color: '#a78bfa', status: 'active', area_type: 'production', current_load: 0, capacity: 100 },
  { name: 'Table 3', x: 380, y: 340, width: 120, height: 80, color: '#a78bfa', status: 'active', area_type: 'production', current_load: 0, capacity: 100 },
  { name: 'Table 4', x: 100, y: 440, width: 120, height: 80, color: '#a78bfa', status: 'active', area_type: 'production', current_load: 0, capacity: 100 },
  { name: 'Table 5', x: 240, y: 440, width: 120, height: 80, color: '#a78bfa', status: 'active', area_type: 'production', current_load: 0, capacity: 100 },
  { name: 'PC station 1', x: 520, y: 340, width: 100, height: 80, color: '#22d3ee', status: 'active', area_type: 'production', current_load: 0, capacity: 100 },
  { name: 'PC station 2', x: 640, y: 340, width: 100, height: 80, color: '#22d3ee', status: 'active', area_type: 'production', current_load: 0, capacity: 100 },
  { name: 'Pallet 1', x: 600, y: 760, width: 100, height: 100, color: '#92400e', status: 'active', area_type: 'storage', current_load: 0, capacity: 100 },
  { name: 'Pallet 2', x: 720, y: 760, width: 100, height: 100, color: '#92400e', status: 'active', area_type: 'storage', current_load: 0, capacity: 100 },
  { name: 'Pallet 3', x: 840, y: 760, width: 100, height: 100, color: '#92400e', status: 'active', area_type: 'storage', current_load: 0, capacity: 100 },
  { name: 'Trash zone', x: 960, y: 760, width: 100, height: 100, color: '#6b7280', status: 'active', area_type: 'storage', current_load: 0, capacity: 100 },
];

export function toFactoryAreas(rows: Omit<FactoryArea, 'id' | 'updated_at'>[]): FactoryArea[] {
  const now = new Date().toISOString();
  return rows.map((row, i) => ({
    ...row,
    id: `demo-${i}`,
    updated_at: now,
  }));
}
