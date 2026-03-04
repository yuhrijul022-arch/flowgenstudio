-- ============================================================
-- Flowgen Studio — Supabase Database Schema
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. Users table
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    username TEXT,
    credits INTEGER NOT NULL DEFAULT 0,
    tier TEXT NOT NULL DEFAULT 'FREE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own row" ON public.users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own row" ON public.users
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Service role can manage all users" ON public.users
    FOR ALL USING (auth.role() = 'service_role');

-- Allow inserts from authenticated users (for self-registration)
CREATE POLICY "Authenticated users can insert own row" ON public.users
    FOR INSERT WITH CHECK (auth.uid() = id);


-- 2. Credit Ledger (append-only audit log)
CREATE TABLE IF NOT EXISTS public.credit_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('generate', 'topup', 'refund', 'purchase')),
    reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own ledger" ON public.credit_ledger
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage ledger" ON public.credit_ledger
    FOR ALL USING (auth.role() = 'service_role');


-- 3. Billing Transactions
CREATE TABLE IF NOT EXISTS public.billing_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    order_id TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    credits INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'expired')),
    snap_token TEXT,
    payment_type TEXT,
    email TEXT,
    username TEXT,
    password TEXT,
    midtrans_response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.billing_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own transactions" ON public.billing_transactions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage transactions" ON public.billing_transactions
    FOR ALL USING (auth.role() = 'service_role');


-- 4. Generations
CREATE TABLE IF NOT EXISTS public.generations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    prompt TEXT,
    image_urls TEXT[] DEFAULT '{}',
    credits_used INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own generations" ON public.generations
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage generations" ON public.generations
    FOR ALL USING (auth.role() = 'service_role');


-- Enable Realtime for credits updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
