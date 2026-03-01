import { createClient } from '@supabase/supabase-js';

// When embedded in index.html, use the same Supabase as Production Stats (timer).
// The HTML sets window.CRISTAL_SUPABASE_URL and window.CRISTAL_SUPABASE_ANON_KEY once; both timer and factory map use them.
const win = typeof window !== 'undefined' ? window as unknown as { CRISTAL_SUPABASE_URL?: string; CRISTAL_SUPABASE_ANON_KEY?: string } : undefined;
const supabaseUrl = (win?.CRISTAL_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const supabaseAnonKey = win?.CRISTAL_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
