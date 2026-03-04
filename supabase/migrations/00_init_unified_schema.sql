-- ============================================================
-- Unified Migration: Flowgen, Visora, StudioPocket
-- Adapts existing `billing_transactions` to a unified `transactions` table
-- and implements idempotency with `processed_notifications`.
-- ============================================================

-- 1. Safely rename billing_transactions to transactions if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'billing_transactions'
    ) THEN
        ALTER TABLE public.billing_transactions RENAME TO transactions;
    END IF;
END $$;

-- 2. Create the transactions table if it doesn't exist at all (e.g. fresh project)
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    order_id TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    snap_token TEXT,
    payment_type TEXT,
    email TEXT,
    username TEXT,
    password TEXT,
    midtrans_response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Add new unified columns to transactions safely
ALTER TABLE public.transactions 
    ADD COLUMN IF NOT EXISTS app TEXT NOT NULL DEFAULT 'FLG',
    ADD COLUMN IF NOT EXISTS credits_to_add INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS credited BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS credited_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS raw_notification JSONB;

-- 4. Add new unified columns to users
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS app TEXT NOT NULL DEFAULT 'FLG',
    ADD COLUMN IF NOT EXISTS password_hash TEXT,
    ADD COLUMN IF NOT EXISTS pro_active BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 5. Create processed_notifications for Idempotency
CREATE TABLE IF NOT EXISTS public.processed_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id TEXT UNIQUE NOT NULL,
    transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload JSONB NOT NULL
);

-- Row Level Security (RLS) policies for processed_notifications (Service Role only)
ALTER TABLE public.processed_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage notifications" ON public.processed_notifications;
CREATE POLICY "Service role can manage notifications" ON public.processed_notifications
    FOR ALL USING (auth.role() = 'service_role');

-- Re-apply policies for the transactions table
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own transactions" ON public.transactions;
CREATE POLICY "Users can read own transactions" ON public.transactions
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage transactions" ON public.transactions;
CREATE POLICY "Service role can manage transactions" ON public.transactions
    FOR ALL USING (auth.role() = 'service_role');
