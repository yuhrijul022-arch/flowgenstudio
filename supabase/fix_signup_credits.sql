-- ============================================================
-- Fix: Pindahkan data credits_to_add → credits untuk transaksi yang sudah ada
-- + Buat RPC function untuk atomic credit increment (backup)
-- Run this SQL in Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Pastikan kolom credits ada
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 0;

-- 2. Pindahkan data dari credits_to_add ke credits untuk semua transaksi yang belum dipindahkan
UPDATE public.transactions 
SET credits = credits_to_add 
WHERE credits_to_add IS NOT NULL 
  AND credits_to_add > 0 
  AND (credits = 0 OR credits IS NULL);

-- 3. Buat RPC function untuk atomic credit increment (dipakai webhook)
CREATE OR REPLACE FUNCTION public.increment_user_credits(user_uuid UUID, credit_amount INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE public.users 
  SET credits = COALESCE(credits, 0) + credit_amount 
  WHERE id = user_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Buat RPC function untuk safe credit deduction (dipakai generate API)
CREATE OR REPLACE FUNCTION public.deduct_credits_safe(p_user_id UUID, p_amount INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE public.users 
  SET credits = GREATEST(0, COALESCE(credits, 0) - p_amount)
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
