-- ============================================================
-- Fix: RLS Policy untuk tabel users
-- Run this SQL in Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Aktifkan RLS untuk tabel users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 2. Hapus policy lama jika sudah ada (hindari duplikasi)
DROP POLICY IF EXISTS "Users can view their own profile" ON public.users;
DROP POLICY IF EXISTS "Users can view own profile" ON public.users;

-- 3. Buat policy: user hanya bisa melihat data mereka sendiri
CREATE POLICY "Users can view their own profile"
  ON public.users FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- 4. Policy: user bisa update profil mereka sendiri
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
