-- =============================================================================
-- Quick fix: run this FIRST if you see "cannot change return type"
-- Then run daily_rewards.sql again (or the rest of it)
-- =============================================================================

DROP FUNCTION IF EXISTS public.create_investment(integer, integer, numeric, numeric, numeric, numeric) CASCADE;

CREATE OR REPLACE FUNCTION public.create_investment(
  p_level INTEGER, p_days INTEGER, p_daily_rate NUMERIC,
  p_amount_usd NUMERIC, p_min_ngn NUMERIC, p_max_ngn NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_balance NUMERIC;
  v_new_balance NUMERIC;
  v_min_usd NUMERIC;
  v_max_usd NUMERIC;
  v_investment_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  v_min_usd := ROUND(p_min_ngn / 1400, 2);
  v_max_usd := ROUND(p_max_ngn / 1400, 2);

  IF p_amount_usd < v_min_usd THEN RAISE EXCEPTION 'Amount below plan minimum of % USD', v_min_usd; END IF;
  IF p_amount_usd > v_max_usd THEN RAISE EXCEPTION 'Amount above plan maximum of % USD', v_max_usd; END IF;

  SELECT balance INTO v_balance FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF v_balance < p_amount_usd THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  PERFORM set_config('jozik.internal_update', '1', true);
  UPDATE public.profiles SET balance = balance - p_amount_usd, updated_at = NOW()
  WHERE id = v_user_id RETURNING balance INTO v_new_balance;

  INSERT INTO public.investments (
    user_id, plan_level, plan_days, daily_rate, amount_usd,
    min_ngn, max_ngn, matures_at, days_credited, last_profit_date
  ) VALUES (
    v_user_id, p_level, p_days, p_daily_rate, p_amount_usd,
    p_min_ngn, p_max_ngn,
    NOW() + (p_days || ' days')::INTERVAL,
    0, NULL
  ) RETURNING id INTO v_investment_id;

  RETURN jsonb_build_object('investment_id', v_investment_id, 'new_balance', v_new_balance);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_investment(integer, integer, numeric, numeric, numeric, numeric) TO authenticated;
