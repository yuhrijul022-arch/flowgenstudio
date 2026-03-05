-- ============================================================
-- FIX SCHEMA: Run this in Supabase SQL Editor
-- This script safely ensures ALL required columns exist
-- on the users, transactions, and processed_notifications tables.
-- It is safe to run multiple times (idempotent).
-- ============================================================

-- ==============================
-- 1. FIX USERS TABLE
-- ==============================
-- Ensure 'credits' column exists
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 0;

-- Ensure 'app' column exists
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS app TEXT NOT NULL DEFAULT 'FLG';

-- Ensure 'pro_active' column exists
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS pro_active BOOLEAN NOT NULL DEFAULT false;

-- Ensure 'updated_at' column exists
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Ensure 'username' column exists
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username TEXT;

-- Ensure 'email' column exists
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email TEXT;

-- ==============================
-- 2. FIX TRANSACTIONS TABLE
-- ==============================
-- Rename billing_transactions to transactions if needed
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'billing_transactions'
    ) AND NOT EXISTS (
        SELECT FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'transactions'
    ) THEN
        ALTER TABLE public.billing_transactions RENAME TO transactions;
    END IF;
END $$;

-- Create transactions table if it doesn't exist at all
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

-- Add unified columns to transactions
ALTER TABLE public.transactions 
    ADD COLUMN IF NOT EXISTS app TEXT NOT NULL DEFAULT 'FLG',
    ADD COLUMN IF NOT EXISTS credits_to_add INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS credited BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS credited_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS raw_notification JSONB;

-- Drop old CHECK constraint on status if it exists (from billing_transactions or old schema)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT conname FROM pg_constraint 
        WHERE conrelid = 'public.transactions'::regclass 
        AND contype = 'c'
        AND conname LIKE '%status%'
    ) LOOP
        EXECUTE format('ALTER TABLE public.transactions DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

-- Clean up any rows with invalid status values from previous webhook runs
UPDATE public.transactions SET status = 'success' WHERE status = 'paid';
UPDATE public.transactions SET status = 'pending' WHERE status NOT IN ('pending', 'success', 'failed', 'expired');

-- Add updated CHECK constraint that includes 'success'
ALTER TABLE public.transactions ADD CONSTRAINT transactions_status_check
    CHECK (status IN ('pending', 'success', 'failed', 'expired'));

-- ==============================
-- 3. PROCESSED NOTIFICATIONS (Idempotency)
-- ==============================
CREATE TABLE IF NOT EXISTS public.processed_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id TEXT UNIQUE NOT NULL,
    transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload JSONB NOT NULL
);

-- ==============================
-- 4. RLS POLICIES (safe to re-run)
-- ==============================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_notifications ENABLE ROW LEVEL SECURITY;

-- Users policies
DROP POLICY IF EXISTS "Users can read own row" ON public.users;
CREATE POLICY "Users can read own row" ON public.users
    FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own row" ON public.users;
CREATE POLICY "Users can update own row" ON public.users
    FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Service role can manage all users" ON public.users;
CREATE POLICY "Service role can manage all users" ON public.users
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Authenticated users can insert own row" ON public.users;
CREATE POLICY "Authenticated users can insert own row" ON public.users
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Transactions policies
DROP POLICY IF EXISTS "Users can read own transactions" ON public.transactions;
CREATE POLICY "Users can read own transactions" ON public.transactions
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage transactions" ON public.transactions;
CREATE POLICY "Service role can manage transactions" ON public.transactions
    FOR ALL USING (auth.role() = 'service_role');

-- Processed notifications policies
DROP POLICY IF EXISTS "Service role can manage notifications" ON public.processed_notifications;
CREATE POLICY "Service role can manage notifications" ON public.processed_notifications
    FOR ALL USING (auth.role() = 'service_role');

-- ==============================
-- 5. ENABLE REALTIME
-- ==============================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND tablename = 'users'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
    END IF;
END $$;

-- Done! All columns and policies are now guaranteed to exist.
