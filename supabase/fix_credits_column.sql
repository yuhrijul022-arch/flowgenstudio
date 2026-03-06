-- ============================================================
-- Fix: Standardize credits column in transactions table
-- Run this SQL in Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Tambahkan kolom 'credits' jika belum ada
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 0;

-- 2. Pindahkan data dari kolom lama (credits_to_add) ke kolom baru (credits)
UPDATE public.transactions 
SET credits = credits_to_add 
WHERE credits_to_add IS NOT NULL AND (credits = 0 OR credits IS NULL);

-- 3. (Opsional) Hapus kolom lama nanti jika sudah yakin semuanya lancar
-- ALTER TABLE public.transactions DROP COLUMN IF EXISTS credits_to_add;
