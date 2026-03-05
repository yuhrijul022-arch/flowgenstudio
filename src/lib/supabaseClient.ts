import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Safe getter that handles both Vite (browser) and Node (Vercel API) environments
const getEnvVar = (viteKey: string, nodeKey: string) => {
    // If in Node.js
    if (typeof process !== 'undefined' && process.env && process.env[nodeKey]) {
        return process.env[nodeKey];
    }
    // If in Vite
    try {
        // @ts-ignore
        if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[viteKey]) {
            // @ts-ignore
            return import.meta.env[viteKey];
        }
    } catch (e) { }

    return '';
};

const SUPABASE_URL = getEnvVar('VITE_SUPABASE_URL', 'SUPABASE_URL');
// In backend, prefer SERVICE_ROLE_KEY to bypass RLS, otherwise fallback to ANON_KEY
const SUPABASE_KEY = getEnvVar('VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY') || getEnvVar('VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY');

if (!SUPABASE_URL || !SUPABASE_KEY) {
    if (typeof console !== 'undefined') console.warn("Missing Supabase env vars");
}

// Ensure a single instance across hot reloads or multiple imports
let _client: SupabaseClient<any, 'public', any>;

export const getSupabaseClient = () => {
    if (!_client) {
        _client = createClient(SUPABASE_URL as string, SUPABASE_KEY as string, {
            auth: {
                persistSession: true, // WAJIB: Simpan sesi di localStorage
                autoRefreshToken: true, // Otomatis perbarui token sebelum expired
                detectSessionInUrl: true // Dukung login via OAuth/Google
            }
        });
    }
    return _client;
};

export const supabase = getSupabaseClient();
