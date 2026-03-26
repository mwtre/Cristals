import type { LocationState, Movement, RemotePayload } from '../types';

const LS_KEY = 'cristal_inventory_board_v1';
const REMOTE_KEY = 'inventory_movements';

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadLocal(): RemotePayload | null {
  const v = safeJsonParse<RemotePayload>(localStorage.getItem(LS_KEY));
  if (!v || typeof v !== 'object') return null;
  if (v.v !== 1) return null;
  return v;
}

export function saveLocal(payload: RemotePayload) {
  localStorage.setItem(LS_KEY, JSON.stringify(payload));
}

type SupabaseEnv = { url: string; anonKey: string } | null;

export function getSupabaseEnv(): SupabaseEnv {
  const w = window as any;
  const winUrl = typeof w?.CRISTAL_SUPABASE_URL === 'string' ? w.CRISTAL_SUPABASE_URL.trim() : '';
  const winKey = typeof w?.CRISTAL_SUPABASE_ANON_KEY === 'string' ? w.CRISTAL_SUPABASE_ANON_KEY.trim() : '';
  const viteUrl = typeof import.meta.env?.VITE_SUPABASE_URL === 'string' ? import.meta.env.VITE_SUPABASE_URL.trim() : '';
  const viteKey =
    typeof import.meta.env?.VITE_SUPABASE_ANON_KEY === 'string' ? import.meta.env.VITE_SUPABASE_ANON_KEY.trim() : '';
  const url = (winUrl || viteUrl).replace(/\/$/, '');
  const anonKey = winKey || viteKey;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function hasSupabaseEnv(): boolean {
  return !!getSupabaseEnv();
}

async function supabaseFetch(
  path: string,
  options?: { method?: string; body?: any; preferMergeDuplicates?: boolean },
) {
  const env = getSupabaseEnv();
  if (!env) throw new Error('No Supabase env');
  const headers: Record<string, string> = {
    apikey: env.anonKey,
    Authorization: `Bearer ${env.anonKey}`,
    'Content-Type': 'application/json',
  };
  const merge = options?.preferMergeDuplicates !== false && options?.body !== undefined;
  if (merge) headers.Prefer = 'resolution=merge-duplicates';
  const res = await fetch(`${env.url}/rest/v1${path}`, {
    method: options?.method ?? 'GET',
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  return res;
}

export async function loadRemote(): Promise<RemotePayload | null> {
  try {
    const res = await supabaseFetch(`/production_data?key=eq.${encodeURIComponent(REMOTE_KEY)}`);
    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    const value = rows?.[0]?.value;
    if (!value || typeof value !== 'object') return null;

    // Backward-compatible: if old schema exists, ignore and start fresh.
    if (value.v !== 1) return null;
    return value as RemotePayload;
  } catch {
    return null;
  }
}

export async function saveRemote(payload: RemotePayload): Promise<void> {
  const keyEq = `/production_data?key=eq.${encodeURIComponent(REMOTE_KEY)}`;
  const probe = await supabaseFetch(`${keyEq}&select=key`);
  if (!probe.ok) {
    const detail = await probe.text().catch(() => '');
    throw new Error(`Supabase read failed (${probe.status}): ${detail || probe.statusText}`);
  }
  const existing = (await probe.json()) as unknown[];
  const hasRow = Array.isArray(existing) && existing.length > 0;

  let res: Response;
  if (hasRow) {
    res = await supabaseFetch(keyEq, {
      method: 'PATCH',
      body: { value: payload },
      preferMergeDuplicates: false,
    });
  } else {
    res = await supabaseFetch('/production_data', {
      method: 'POST',
      body: [{ key: REMOTE_KEY, value: payload }],
    });
    if (res.status === 409) {
      res = await supabaseFetch(keyEq, {
        method: 'PATCH',
        body: { value: payload },
        preferMergeDuplicates: false,
      });
    }
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase save failed (${res.status}): ${detail || res.statusText}`);
  }
}

type WoRow = NonNullable<LocationState['woById']>[string];

/** Mirror `state.woById` into Supabase `work_orders` for Table Editor / reporting. */
export async function syncWorkOrdersToSupabase(woById: LocationState['woById'] | undefined): Promise<void> {
  if (!hasSupabaseEnv()) return;

  const map = woById ?? {};
  const rows = Object.values(map).map((wo: WoRow) => ({
    id: wo.id,
    status: wo.status,
    client: wo.client ?? null,
    location_id: wo.locationId ?? null,
    requirements: wo.requirements ?? [],
    created_at: wo.createdAt,
    updated_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    const up = await supabaseFetch('/work_orders?on_conflict=id', {
      method: 'POST',
      body: rows,
    });
    if (!up.ok) {
      const detail = await up.text().catch(() => '');
      throw new Error(`work_orders upsert failed (${up.status}): ${detail || up.statusText}`);
    }
  }

  const listRes = await supabaseFetch('/work_orders?select=id');
  if (!listRes.ok) {
    const detail = await listRes.text().catch(() => '');
    throw new Error(`work_orders list failed (${listRes.status}): ${detail || listRes.statusText}`);
  }
  const existing = (await listRes.json()) as { id: string }[];
  const keep = new Set(rows.map((r) => r.id));
  const orphans = existing.filter((e) => !keep.has(e.id));

  await Promise.all(
    orphans.map((e) =>
      supabaseFetch(`/work_orders?id=eq.${encodeURIComponent(e.id)}`, {
        method: 'DELETE',
        preferMergeDuplicates: false,
      }).then((r) => {
        if (!r.ok) {
          throw new Error(`work_orders delete ${e.id} failed (${r.status})`);
        }
      }),
    ),
  );
}

const INVENTORY_STATS_ID = 'global';

function computeInventoryBoardStatsRow(state: LocationState, movementsStored: number) {
  const items = Object.values(state.itemsById ?? {});
  let boxCount = 0;
  let nestedCount = 0;
  let totalQty = 0;
  for (const it of items) {
    if (!it) continue;
    totalQty += it.qty ?? 0;
    if (it.kind === 'box') boxCount += 1;
    if (it.parentBoxItemId) nestedCount += 1;
  }
  let topLevelCards = 0;
  for (const loc of state.locations) {
    topLevelCards += (state.locationItemIds[loc.id] ?? []).length;
  }
  return {
    id: INVENTORY_STATS_ID,
    updated_at: new Date().toISOString(),
    payload_version: 1,
    location_count: state.locations.length,
    top_level_cards: topLevelCards,
    item_card_count: items.length,
    box_count: boxCount,
    nested_item_count: nestedCount,
    total_piece_qty: totalQty,
    movements_stored: movementsStored,
  };
}

/** Upsert dashboard row so Supabase Table Editor reflects last sync (incl. boxes). */
export async function syncInventoryBoardStats(state: LocationState, movementsStored: number): Promise<void> {
  if (!hasSupabaseEnv()) return;

  const row = computeInventoryBoardStatsRow(state, movementsStored);
  const keyEq = `/inventory_board_stats?id=eq.${encodeURIComponent(INVENTORY_STATS_ID)}`;
  const probe = await supabaseFetch(`${keyEq}&select=id`);
  if (!probe.ok) {
    const detail = await probe.text().catch(() => '');
    throw new Error(`inventory_board_stats read failed (${probe.status}): ${detail || probe.statusText}`);
  }
  const existing = (await probe.json()) as unknown[];
  const hasRow = Array.isArray(existing) && existing.length > 0;

  let res: Response;
  if (hasRow) {
    res = await supabaseFetch(keyEq, {
      method: 'PATCH',
      body: row,
      preferMergeDuplicates: false,
    });
  } else {
    res = await supabaseFetch('/inventory_board_stats', {
      method: 'POST',
      body: [row],
    });
    if (res.status === 409) {
      res = await supabaseFetch(keyEq, {
        method: 'PATCH',
        body: row,
        preferMergeDuplicates: false,
      });
    }
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`inventory_board_stats save failed (${res.status}): ${detail || res.statusText}`);
  }
}

export function newEmptyState(): { state: LocationState; movements: Movement[] } {
  return {
    state: { locations: [], locationItemIds: {}, itemsById: {} },
    movements: [],
  };
}

