-- =============================================================================
-- Jozik Capital — Investments (run after schema.sql)
-- Supabase Dashboard → SQL Editor
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.investments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_level INTEGER NOT NULL CHECK (plan_level BETWEEN 1 AND 4),
  plan_days INTEGER NOT NULL,
  daily_rate NUMERIC(6, 2) NOT NULL,
  amount_usd NUMERIC(18, 2) NOT NULL CHECK (amount_usd > 0),
  min_ngn NUMERIC(18, 2) NOT NULL,
  max_ngn NUMERIC(18, 2) NOT NULL,
  profit_usd NUMERIC(18, 2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'matured')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  matures_at TIMESTAMPTZ NOT NULL,
  matured_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investments_user_id ON public.investments(user_id);
CREATE INDEX IF NOT EXISTS idx_investments_status ON public.investments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_investments_matures ON public.investments(matures_at) WHERE status = 'active';

ALTER TABLE public.investments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own investments" ON public.investments;
CREATE POLICY "Users can view own investments"
  ON public.investments FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Create investment: deduct balance, record investment
DROP FUNCTION IF EXISTS public.create_investment(integer, integer, numeric, numeric, numeric, numeric) CASCADE;

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
  SET balance = balance - p_amount_usd, updated_at = NOW()
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

  RETURN jsonb_build_object('investment_id', v_investment_id, 'new_balance', v_new_balance);
END;
$$;

-- Process matured investments: return principal + profit to balance
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
    SET
      status = 'matured',
      profit_usd = v_profit,
      matured_at = NOW()
    WHERE id = rec.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_investment(INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_matured_investments() TO authenticated;
