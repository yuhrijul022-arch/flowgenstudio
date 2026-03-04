/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string;
    readonly VITE_SUPABASE_ANON_KEY: string;
    readonly VITE_BASE_URL: string;
    readonly VITE_MIDTRANS_CLIENT_KEY: string;
    readonly VITE_MIDTRANS_IS_PROD: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
