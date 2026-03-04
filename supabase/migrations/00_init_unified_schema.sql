-- ============================================================
-- Unified Migration: Flowgen, Visora, StudioPocket
-- Adapts existing `billing_transactions` to a unified `transactions` table
-- and implements idempotency with `processed_notifications`.
-- ============================================================

-- 1. Rename billing_transactions to transactions
ALTER TABLE IF EXISTS public.billing_transactions RENAME TO transactions;

-- 2. Add new unified columns to transactions
ALTER TABLE public.transactions 
    ADD COLUMN IF NOT EXISTS app TEXT NOT NULL DEFAULT 'FLG',
    ADD COLUMN IF NOT EXISTS credits_to_add INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS credited BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS credited_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS raw_notification JSONB;

-- Note: 'type' in existing table is currently 'signup_pro' or 'topup'. 
-- We will migrate existing records if needed, but going forward type will be 'SIGNUP' or 'TOPUP'.

-- 3. Add new unified columns to users
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS app TEXT NOT NULL DEFAULT 'FLG',
    ADD COLUMN IF NOT EXISTS password_hash TEXT,
    ADD COLUMN IF NOT EXISTS pro_active BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Expand the composite unique key if desired (optional, for now email must be globally unique per auth.users anyway)
-- Alternatively, if relying on Supabase auth, email is strictly unique in auth.users.

-- 4. Create processed_notifications for Idempotency
CREATE TABLE IF NOT EXISTS public.processed_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id TEXT UNIQUE NOT NULL,
    transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload JSONB NOT NULL
);

-- Row Level Security (RLS) policies for processed_notifications (Service Role only)
ALTER TABLE public.processed_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage notifications" ON public.processed_notifications
    FOR ALL USING (auth.role() = 'service_role');

-- Re-apply policies for renamed transactions table if they dropped or names need updating
-- (PostgreSQL usually renames the table references in policies automatically, but let's review)
DROP POLICY IF EXISTS "Users can read own transactions" ON public.transactions;
CREATE POLICY "Users can read own transactions" ON public.transactions
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage transactions" ON public.transactions;
CREATE POLICY "Service role can manage transactions" ON public.transactions
    FOR ALL USING (auth.role() = 'service_role');
