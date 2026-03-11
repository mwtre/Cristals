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
  const url: string | undefined = typeof w?.CRISTAL_SUPABASE_URL === 'string' ? w.CRISTAL_SUPABASE_URL : undefined;
  const anonKey: string | undefined =
    typeof w?.CRISTAL_SUPABASE_ANON_KEY === 'string' ? w.CRISTAL_SUPABASE_ANON_KEY : undefined;
  if (!url || !anonKey) return null;
  return { url: url.replace(/\/$/, ''), anonKey };
}

export function hasSupabaseEnv(): boolean {
  return !!getSupabaseEnv();
}

async function supabaseFetch(path: string, options?: { method?: string; body?: any }) {
  const env = getSupabaseEnv();
  if (!env) throw new Error('No Supabase env');
  const headers: Record<string, string> = {
    apikey: env.anonKey,
    Authorization: `Bearer ${env.anonKey}`,
    'Content-Type': 'application/json',
  };
  if (options?.body !== undefined) headers.Prefer = 'resolution=merge-duplicates';
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
  await supabaseFetch('/production_data', { method: 'POST', body: [{ key: REMOTE_KEY, value: payload }] });
}

export function newEmptyState(): { state: LocationState; movements: Movement[] } {
  return {
    state: { locations: [], locationItemIds: {}, itemsById: {} },
    movements: [],
  };
}

