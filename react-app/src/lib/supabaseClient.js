import { createClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from './config';
import { localDb } from './localDb';

// Fall back to a localStorage-backed mock client when Supabase env vars aren't
// configured, so the app remains fully usable offline (e.g. local testing).
export const sb = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : localDb;
