-- ============================================================
-- Flowgen Studio: generations table + RLS
-- Run this SQL in your Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Buat Tabel Generations (sesuai dengan yang dipakai backend api/generate.ts)
CREATE TABLE IF NOT EXISTS public.generations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  prompt text,
  image_urls text[] NOT NULL DEFAULT '{}',
  credits_used integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- 2. Aktifkan Row Level Security (RLS)
ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;

-- 3. Policy: User hanya bisa melihat gambar milik mereka sendiri
CREATE POLICY "Users can view own generations"
  ON public.generations FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 4. Policy: Backend/User bisa memasukkan data (Insert)
CREATE POLICY "Service role can insert generations"
  ON public.generations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);