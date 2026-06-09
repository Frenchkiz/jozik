-- =============================================================================
-- Jozik Capital — Receipts, withdrawals, balance fix
-- Run after schema.sql and investments.sql
-- =============================================================================

-- Fix: allow SECURITY DEFINER functions to update balance
CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('jozik.internal_update', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() = NEW.id AND auth.role() = 'authenticated' THEN
    IF NEW.balance IS DISTINCT FROM OLD.balance THEN
      NEW.balance := OLD.balance;
    END IF;
    IF NEW.level IS DISTINCT FROM OLD.level THEN
      NEW.level := OLD.level;
    END IF;
    IF NEW.total_invested IS DISTINCT FROM OLD.total_invested THEN
      NEW.total_invested := OLD.total_invested;
    END IF;
    IF NEW.team_accumulation IS DISTINCT FROM OLD.team_accumulation THEN
      NEW.team_accumulation := OLD.team_accumulation;
    END IF;
    IF NEW.monthly_team_accumulation IS DISTINCT FROM OLD.monthly_team_accumulation THEN
      NEW.monthly_team_accumulation := OLD.monthly_team_accumulation;
    END IF;
    IF NEW.referral_code IS DISTINCT FROM OLD.referral_code THEN
      NEW.referral_code := OLD.referral_code;
    END IF;
    IF NEW.referred_by IS DISTINCT FROM OLD.referred_by THEN
      NEW.referred_by := OLD.referred_by;
    END IF;
    IF NEW.email IS DISTINCT FROM OLD.email THEN
      NEW.email := OLD.email;
    END IF;
    IF NEW.receipt_urls IS DISTINCT FROM OLD.receipt_urls THEN
      NEW.receipt_urls := OLD.receipt_urls;
    END IF;
    IF NEW.withdrawal_requests IS DISTINCT FROM OLD.withdrawal_requests THEN
      NEW.withdrawal_requests := OLD.withdrawal_requests;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Profile columns for receipts & withdrawals (latest entry first in JSON array)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS receipt_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS withdrawal_requests JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Re-create investment function with balance fix (return type changed)
DROP FUNCTION IF EXISTS public.create_investment(INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION public.create_investment(
  p_level INTEGER,
  p_days INTEGER,
  p_daily_rate NUMERIC,
  p_amount_usd NUMERIC,
  p_min_ngn NUMERIC,
  p_max_ngn NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_balance NUMERIC;
  v_new_balance NUMERIC;
  v_min_usd NUMERIC;
  v_max_usd NUMERIC;
  v_investment_id UUID;
  v_ngn_rate NUMERIC := 1400;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_min_usd := ROUND(p_min_ngn / v_ngn_rate, 2);
  v_max_usd := ROUND(p_max_ngn / v_ngn_rate, 2);

  IF p_amount_usd < v_min_usd THEN
    RAISE EXCEPTION 'Amount below plan minimum of % USD', v_min_usd;
  END IF;

  IF p_amount_usd > v_max_usd THEN
    RAISE EXCEPTION 'Amount above plan maximum of % USD', v_max_usd;
  END IF;

  SELECT balance INTO v_balance FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF v_balance < p_amount_usd THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  PERFORM set_config('jozik.internal_update', '1', true);

  UPDATE public.profiles
  SET
    balance = balance - p_amount_usd,
    total_invested = total_invested + (p_amount_usd * v_ngn_rate),
    updated_at = NOW()
  WHERE id = v_user_id
  RETURNING balance INTO v_new_balance;

  INSERT INTO public.investments (
    user_id, plan_level, plan_days, daily_rate, amount_usd,
    min_ngn, max_ngn, matures_at
  ) VALUES (
    v_user_id, p_level, p_days, p_daily_rate, p_amount_usd,
    p_min_ngn, p_max_ngn,
    NOW() + (p_days || ' days')::INTERVAL
  )
  RETURNING id INTO v_investment_id;

  RETURN jsonb_build_object(
    'investment_id', v_investment_id,
    'new_balance', v_new_balance,
    'amount_invested', p_amount_usd
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.process_matured_investments()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_count INTEGER := 0;
  rec RECORD;
  v_profit NUMERIC;
  v_payout NUMERIC;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM set_config('jozik.internal_update', '1', true);

  FOR rec IN
    SELECT * FROM public.investments
    WHERE user_id = v_user_id
      AND status = 'active'
      AND matures_at <= NOW()
    FOR UPDATE
  LOOP
    v_profit := ROUND(rec.amount_usd * (rec.daily_rate / 100) * rec.plan_days, 2);
    v_payout := rec.amount_usd + v_profit;

    UPDATE public.profiles
    SET balance = balance + v_payout, updated_at = NOW()
    WHERE id = v_user_id;

    UPDATE public.investments
    SET status = 'matured', profit_usd = v_profit, matured_at = NOW()
    WHERE id = rec.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Add receipt URL (latest on top)
CREATE OR REPLACE FUNCTION public.add_user_receipt(p_url TEXT, p_file_name TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_entry JSONB;
  v_list JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_url IS NULL OR trim(p_url) = '' THEN
    RAISE EXCEPTION 'Receipt URL is required';
  END IF;

  v_entry := jsonb_build_object(
    'url', trim(p_url),
    'file_name', COALESCE(p_file_name, 'receipt'),
    'uploaded_at', NOW()
  );

  PERFORM set_config('jozik.internal_update', '1', true);

  UPDATE public.profiles
  SET
    receipt_urls = jsonb_build_array(v_entry) || COALESCE(receipt_urls, '[]'::jsonb),
    updated_at = NOW()
  WHERE id = v_user_id
  RETURNING receipt_urls INTO v_list;

  RETURN v_entry;
END;
$$;

-- Add withdrawal request (latest on top) and deduct balance
CREATE OR REPLACE FUNCTION public.add_withdrawal_request(p_request JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_entry JSONB;
  v_amount NUMERIC;
  v_balance NUMERIC;
  v_new_balance NUMERIC;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_amount := (p_request->>'amount')::NUMERIC;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid withdrawal amount';
  END IF;

  SELECT balance INTO v_balance
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF v_balance < v_amount THEN
    RAISE EXCEPTION 'Insufficient balance. Available: % USD', ROUND(v_balance, 2);
  END IF;

  v_entry := p_request || jsonb_build_object('submitted_at', NOW());

  PERFORM set_config('jozik.internal_update', '1', true);

  UPDATE public.profiles
  SET
    balance = balance - v_amount,
    withdrawal_requests = jsonb_build_array(v_entry) || COALESCE(withdrawal_requests, '[]'::jsonb),
    updated_at = NOW()
  WHERE id = v_user_id
  RETURNING balance INTO v_new_balance;

  RETURN v_entry || jsonb_build_object('new_balance', v_new_balance);
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_user_receipt(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_withdrawal_request(JSONB) TO authenticated;

-- Drop old return type grant if exists and re-grant
GRANT EXECUTE ON FUNCTION public.create_investment(INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO authenticated;

-- Storage bucket for receipt images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'receipts',
  'receipts',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Users upload own receipts" ON storage.objects;
CREATE POLICY "Users upload own receipts"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users read own receipts" ON storage.objects;
CREATE POLICY "Users read own receipts"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Public read receipts" ON storage.objects;
CREATE POLICY "Public read receipts"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'receipts');
