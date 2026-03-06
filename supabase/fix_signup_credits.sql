-- ============================================================
-- Fix: Drop + Re-create RPC functions, migrasi credits
-- Run this SQL in Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Pastikan kolom credits ada di transactions
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 0;

-- 2. Migrasi data credits_to_add → credits
UPDATE public.transactions 
SET credits = credits_to_add 
WHERE credits_to_add IS NOT NULL 
  AND credits_to_add > 0 
  AND (credits = 0 OR credits IS NULL);

-- 3. Drop fungsi lama (karena return type berbeda)
DROP FUNCTION IF EXISTS increment_user_credits(uuid, integer);
DROP FUNCTION IF EXISTS deduct_credits_safe(uuid, integer);

-- 4. Buat ulang increment_user_credits
CREATE FUNCTION public.increment_user_credits(user_uuid UUID, credit_amount INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE public.users 
  SET credits = COALESCE(credits, 0) + credit_amount 
  WHERE id = user_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Buat ulang deduct_credits_safe
CREATE FUNCTION public.deduct_credits_safe(p_user_id UUID, p_amount INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE public.users 
  SET credits = GREATEST(0, COALESCE(credits, 0) - p_amount)
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
