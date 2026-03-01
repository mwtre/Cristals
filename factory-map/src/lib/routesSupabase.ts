import type { ProductRoute } from '../types/routes';
import { supabase } from './supabase';

const TABLE = 'product_routes';

export async function fetchRoutesFromSupabase(variant: 'main' | 'v2'): Promise<ProductRoute[]> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('id, name, points')
      .eq('map_variant', variant)
      .order('created_at', { ascending: true });
    if (error) throw error;
    const list = (data ?? []).map((row: { id: string; name: string; points: unknown }) => ({
      id: String(row.id),
      name: row.name ?? '',
      points: Array.isArray(row.points) ? row.points : [],
    })) as ProductRoute[];
    return list.filter((r) => Array.isArray(r.points));
  } catch {
    return [];
  }
}

export async function saveRoutesToSupabase(variant: 'main' | 'v2', routes: ProductRoute[]): Promise<boolean> {
  try {
    const { error: deleteErr } = await supabase.from(TABLE).delete().eq('map_variant', variant);
    if (deleteErr) throw deleteErr;
    if (routes.length === 0) return true;
    const rows = routes.map((r) => ({
      name: r.name || 'Route',
      points: r.points ?? [],
      map_variant: variant,
      updated_at: new Date().toISOString(),
    }));
    const { error: insertErr } = await supabase.from(TABLE).insert(rows);
    if (insertErr) throw insertErr;
    return true;
  } catch (e) {
    console.error('saveRoutesToSupabase:', e);
    return false;
  }
}
