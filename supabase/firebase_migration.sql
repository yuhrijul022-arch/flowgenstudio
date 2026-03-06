-- ============================================================
-- Firebase → Supabase User Migration
-- Run this ENTIRE script in Supabase Dashboard → SQL Editor
-- ============================================================
-- Strategy:
--   1. Add migration columns to public.users
--   2. Create staging table firebase_migrated_users
--   3. Seed staging table with legacy Firebase user data
--   4. Update credit_ledger type constraint to include 'migration'
--   5. Create trigger function that auto-migrates credits on sign-up
--   6. Attach trigger to auth.users
-- ============================================================

-- ==============================
-- 1. ALTER public.users — Add migration columns
-- ==============================
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS firebase_uid TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'organic';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS reserved_credits INTEGER DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ;

-- Unique index on firebase_uid for fast lookups & to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid
  ON public.users (firebase_uid)
  WHERE firebase_uid IS NOT NULL;


-- ==============================
-- 2. CREATE staging table: firebase_migrated_users
-- ==============================
-- This table holds the imported Firebase user data.
-- The trigger function checks this table when a new user signs up.
CREATE TABLE IF NOT EXISTS public.firebase_migrated_users (
    id              SERIAL PRIMARY KEY,
    firebase_uid    TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    display_name    TEXT,
    photo_url       TEXT,
    credits         INTEGER DEFAULT 0,
    reserved_credits INTEGER DEFAULT 0,
    role            TEXT DEFAULT 'user',
    source          TEXT DEFAULT 'organic',
    joined_at       TIMESTAMPTZ,
    migrated        BOOLEAN DEFAULT false,
    migrated_at     TIMESTAMPTZ,
    supabase_user_id UUID
);

ALTER TABLE public.firebase_migrated_users ENABLE ROW LEVEL SECURITY;

-- Only service_role can access this table
DROP POLICY IF EXISTS "Service role can manage firebase_migrated_users"
  ON public.firebase_migrated_users;
CREATE POLICY "Service role can manage firebase_migrated_users"
  ON public.firebase_migrated_users
  FOR ALL USING (auth.role() = 'service_role');


-- ==============================
-- 3. SEED staging table with Firebase user data
-- ==============================
-- Hanifah Wijayanti
INSERT INTO public.firebase_migrated_users
  (firebase_uid, email, display_name, photo_url, credits, reserved_credits, role, source, joined_at)
VALUES
  (
    'BwQiXjbFoXgjdNj9gIzILiBCQ1B3',
    'hanifah.wijayanti123@gmail.com',
    'Hanifah Wijayanti',
    'https://lh3.googleusercontent.com/a/ACg8ocLMAXkZmsAmTQLBYoLAQKLYKEcrhSKOyf_XFWCuCsMeNFj6rWw=s96-c',
    9,
    0,
    'user',
    'organic',
    '2026-03-03T02:05:49Z'  -- March 3, 2026 at 9:05:49 AM UTC+7 → UTC
  )
ON CONFLICT (email) DO UPDATE SET
  credits = EXCLUDED.credits,
  firebase_uid = EXCLUDED.firebase_uid,
  display_name = EXCLUDED.display_name,
  photo_url = EXCLUDED.photo_url,
  joined_at = EXCLUDED.joined_at;

-- Panji Saputra
INSERT INTO public.firebase_migrated_users
  (firebase_uid, email, display_name, photo_url, credits, reserved_credits, role, source, joined_at)
VALUES
  (
    'izWOE6lZpwUpXCg40qf2EUrDmJS2',
    'pannjisaputra@gmail.com',
    'panji saputra',
    'https://lh3.googleusercontent.com/a/ACg8ocKm39__-xv-UzVqqVDbCuVnitZgx_JUi_KdFVQM2i7xYBf2fmo=s96-c',
    5,
    0,
    'user',
    'organic',
    '2026-03-04T05:26:02Z'  -- March 4, 2026 at 12:26:02 PM UTC+7 → UTC
  )
ON CONFLICT (email) DO UPDATE SET
  credits = EXCLUDED.credits,
  firebase_uid = EXCLUDED.firebase_uid,
  display_name = EXCLUDED.display_name,
  photo_url = EXCLUDED.photo_url,
  joined_at = EXCLUDED.joined_at;


-- ==============================
-- 4. CREATE credit_ledger table (if not exists) + UPDATE type constraint
-- ==============================
-- Create credit_ledger if it doesn't exist yet (with 'migration' included)
CREATE TABLE IF NOT EXISTS public.credit_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('generate', 'topup', 'refund', 'purchase', 'migration')),
    reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own ledger" ON public.credit_ledger;
CREATE POLICY "Users can read own ledger" ON public.credit_ledger
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage ledger" ON public.credit_ledger;
CREATE POLICY "Service role can manage ledger" ON public.credit_ledger
    FOR ALL USING (auth.role() = 'service_role');

-- If the table already existed with the OLD constraint (without 'migration'),
-- drop and re-add the constraint safely
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.credit_ledger'::regclass
        AND contype = 'c'
        AND conname LIKE '%type%'
    ) LOOP
        EXECUTE format('ALTER TABLE public.credit_ledger DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE public.credit_ledger
  ADD CONSTRAINT credit_ledger_type_check
  CHECK (type IN ('generate', 'topup', 'refund', 'purchase', 'migration'));


-- ==============================
-- 5. CREATE trigger function: handle_firebase_user_migration
-- ==============================
-- This function runs AFTER a new user is inserted into auth.users (Google sign-up).
-- It creates a public.users profile and, if the email matches a Firebase user,
-- automatically transfers their credits.
CREATE OR REPLACE FUNCTION public.handle_firebase_user_migration()
RETURNS TRIGGER AS $$
DECLARE
    _firebase RECORD;
    _email TEXT;
BEGIN
    -- Extract email from the new auth.users row
    _email := NEW.email;

    -- Always create a public.users profile row
    INSERT INTO public.users (id, email, username, credits, tier, created_at)
    VALUES (
        NEW.id,
        _email,
        COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', split_part(_email, '@', 1)),
        0,        -- default credits (will be overwritten if migrated)
        'FREE',
        NOW()
    )
    ON CONFLICT (id) DO NOTHING;  -- safety: don't error if row already exists

    -- Check if this email has a pending Firebase migration
    SELECT *
    INTO _firebase
    FROM public.firebase_migrated_users
    WHERE email = _email
      AND migrated = false
    LIMIT 1;

    -- If match found: transfer Firebase data to the new Supabase profile
    IF FOUND THEN
        UPDATE public.users
        SET
            credits          = _firebase.credits,
            reserved_credits = _firebase.reserved_credits,
            firebase_uid     = _firebase.firebase_uid,
            display_name     = _firebase.display_name,
            photo_url        = _firebase.photo_url,
            role             = _firebase.role,
            source           = _firebase.source,
            joined_at        = _firebase.joined_at,
            updated_at       = NOW()
        WHERE id = NEW.id;

        -- Log the migration in credit_ledger for audit trail
        INSERT INTO public.credit_ledger (user_id, amount, type, reference, created_at)
        VALUES (
            NEW.id,
            _firebase.credits,
            'migration',
            format('Firebase migration from uid=%s', _firebase.firebase_uid),
            NOW()
        );

        -- Mark the staging row as migrated
        UPDATE public.firebase_migrated_users
        SET
            migrated         = true,
            migrated_at      = NOW(),
            supabase_user_id = NEW.id
        WHERE id = _firebase.id;

        RAISE LOG '[Firebase Migration] ✅ Migrated user % (%) — % credits transferred',
            _firebase.display_name, _email, _firebase.credits;
    ELSE
        RAISE LOG '[Firebase Migration] ℹ️ New user % — no Firebase data found', _email;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ==============================
-- 6. ATTACH trigger to auth.users
-- ==============================
-- Drop existing trigger if it exists (idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created_migrate ON auth.users;

-- Create the trigger
CREATE TRIGGER on_auth_user_created_migrate
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_firebase_user_migration();


-- ==============================
-- DONE! Summary of what was created:
-- ==============================
-- ✅ public.users         → added columns: firebase_uid, display_name, photo_url, role, source, reserved_credits, joined_at
-- ✅ public.firebase_migrated_users → staging table with Hanifah & Panji data seeded
-- ✅ public.credit_ledger  → type constraint updated to include 'migration'
-- ✅ handle_firebase_user_migration() → trigger function created
-- ✅ on_auth_user_created_migrate    → trigger attached to auth.users
--
-- 🔄 Flow: User signs in via Google → auth.users INSERT → trigger fires →
--    checks firebase_migrated_users → transfers credits if match found → logs in credit_ledger
