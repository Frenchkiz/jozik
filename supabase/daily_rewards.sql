-- =============================================================================
-- Jozik Capital — Daily profit, referrals, levels, monthly salary
-- Run after investments.sql, receipts_withdrawals.sql
-- Exchange rate: ₦1,400 = $1 USD
-- =============================================================================

-- Drop functions/views whose signatures changed (CREATE OR REPLACE cannot change return types)
DROP VIEW IF EXISTS public.my_dashboard_stats;
DROP FUNCTION IF EXISTS public.get_direct_referral_stats(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.calculate_eligible_level(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.apply_user_level(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.create_investment(integer, integer, numeric, numeric, numeric, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.process_daily_rewards() CASCADE;
DROP FUNCTION IF EXISTS public.process_matured_investments() CASCADE;

ALTER TABLE public.investments
  ADD COLUMN IF NOT EXISTS days_credited INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_profit_date DATE,
  ADD COLUMN IF NOT EXISTS total_profit_credited NUMERIC(18, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS total_profit_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS team_profit_accumulation_ngn NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_salary_month TEXT;

CREATE TABLE IF NOT EXISTS public.profit_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  amount_usd NUMERIC(18, 4) NOT NULL,
  amount_ngn NUMERIC(18, 2) NOT NULL,
  credit_type TEXT NOT NULL,
  investment_id UUID REFERENCES public.investments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profit_credits_user ON public.profit_credits(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_profit_credits_month ON public.profit_credits(user_id, credit_type, created_at);

ALTER TABLE public.profit_credits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own profit credits" ON public.profit_credits;
CREATE POLICY "Users view own profit credits"
  ON public.profit_credits FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Constants helper (NGN per USD)
CREATE OR REPLACE FUNCTION public.usd_to_ngn(p_usd NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$ SELECT ROUND(p_usd * 1400, 2); $$;

CREATE OR REPLACE FUNCTION public.ngn_to_usd(p_ngn NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$ SELECT ROUND(p_ngn / 1400, 2); $$;

-- Active = earned profit or has active investment
CREATE OR REPLACE FUNCTION public.is_active_member(p public.profiles)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT (
    COALESCE(p.total_profit_usd, 0) > 0
    OR EXISTS (
      SELECT 1 FROM public.investments i
      WHERE i.user_id = p.id AND i.status = 'active'
    )
  );
$$;

-- Sync referrer team profit from direct referrals
CREATE OR REPLACE FUNCTION public.sync_referrer_team_profit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ref_id UUID;
  new_sum NUMERIC;
BEGIN
  IF NEW.referred_by IS NOT NULL THEN
    ref_id := NEW.referred_by;
    SELECT COALESCE(SUM(public.usd_to_ngn(total_profit_usd)), 0) INTO new_sum
    FROM public.profiles WHERE referred_by = ref_id;

    PERFORM set_config('jozik.internal_update', '1', true);
    UPDATE public.profiles
    SET team_profit_accumulation_ngn = new_sum, updated_at = NOW()
    WHERE id = ref_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_referrer_team_profit ON public.profiles;
CREATE TRIGGER trg_sync_referrer_team_profit
  AFTER UPDATE OF total_profit_usd ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_referrer_team_profit();

-- Credit balance helper
CREATE OR REPLACE FUNCTION public.credit_user_balance(
  p_user_id UUID,
  p_amount_usd NUMERIC,
  p_source_user_id UUID,
  p_credit_type TEXT,
  p_investment_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ngn NUMERIC;
BEGIN
  IF p_amount_usd <= 0 THEN RETURN; END IF;
  v_ngn := public.usd_to_ngn(p_amount_usd);

  PERFORM set_config('jozik.internal_update', '1', true);

  UPDATE public.profiles
  SET
    balance = balance + p_amount_usd,
    total_profit_usd = total_profit_usd + CASE
      WHEN p_credit_type IN ('daily_profit', 'referral_gen1', 'referral_gen2', 'referral_gen3', 'monthly_salary')
      THEN p_amount_usd ELSE 0 END,
    updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO public.profit_credits (user_id, source_user_id, amount_usd, amount_ngn, credit_type, investment_id)
  VALUES (p_user_id, p_source_user_id, p_amount_usd, v_ngn, p_credit_type, p_investment_id);
END;
$$;

-- Referral bonuses: 8% gen1, 2% gen2, 0.5% gen3 of daily profit
CREATE OR REPLACE FUNCTION public.credit_referral_bonuses(
  p_earner_id UUID,
  p_daily_profit_usd NUMERIC,
  p_investment_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gen1 UUID;
  gen2 UUID;
  gen3 UUID;
BEGIN
  SELECT referred_by INTO gen1 FROM public.profiles WHERE id = p_earner_id;
  IF gen1 IS NULL THEN RETURN; END IF;

  PERFORM public.credit_user_balance(gen1, ROUND(p_daily_profit_usd * 0.08, 4), p_earner_id, 'referral_gen1', p_investment_id);

  SELECT referred_by INTO gen2 FROM public.profiles WHERE id = gen1;
  IF gen2 IS NOT NULL THEN
    PERFORM public.credit_user_balance(gen2, ROUND(p_daily_profit_usd * 0.02, 4), p_earner_id, 'referral_gen2', p_investment_id);
    SELECT referred_by INTO gen3 FROM public.profiles WHERE id = gen2;
    IF gen3 IS NOT NULL THEN
      PERFORM public.credit_user_balance(gen3, ROUND(p_daily_profit_usd * 0.005, 4), p_earner_id, 'referral_gen3', p_investment_id);
    END IF;
  END IF;
END;
$$;

-- Level calculation from team PROFIT accumulation (NGN)
DROP FUNCTION IF EXISTS public.get_direct_referral_stats(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.get_direct_referral_stats(user_id UUID)
RETURNS TABLE (
  total_signups INTEGER,
  active_level_1 INTEGER,
  active_level_2 INTEGER,
  active_level_3 INTEGER,
  team_profit_ngn NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE p.level = 1 AND public.is_active_member(p))::INTEGER,
    COUNT(*) FILTER (WHERE p.level = 2 AND public.is_active_member(p))::INTEGER,
    COUNT(*) FILTER (WHERE p.level = 3 AND public.is_active_member(p))::INTEGER,
    COALESCE(SUM(public.usd_to_ngn(p.total_profit_usd)), 0)
  FROM public.profiles p WHERE p.referred_by = user_id;
$$;

CREATE OR REPLACE FUNCTION public.calculate_eligible_level(user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  prof public.profiles%ROWTYPE;
  stats RECORD;
  eligible INTEGER := 1;
  team_profit NUMERIC;
BEGIN
  SELECT * INTO prof FROM public.profiles WHERE id = user_id;
  IF NOT FOUND THEN RETURN 1; END IF;

  SELECT * INTO stats FROM public.get_direct_referral_stats(user_id);
  team_profit := GREATEST(COALESCE(prof.team_profit_accumulation_ngn, 0), COALESCE(stats.team_profit_ngn, 0));

  -- Level 2: 3+ referrals, ₦100,000 team profit
  IF stats.total_signups >= 3 AND team_profit >= 100000 THEN eligible := 2; END IF;

  -- Level 3: 2 active L2, 5 active L1, ₦1M team profit
  IF eligible >= 2 AND stats.active_level_2 >= 2 AND stats.active_level_1 >= 5 AND team_profit >= 1000000 THEN
    eligible := 3;
  END IF;

  -- Level 4: 2 active L3, 1 active L2, 10 active L1, ₦2M team profit
  IF eligible >= 3 AND stats.active_level_3 >= 2 AND stats.active_level_2 >= 1
     AND stats.active_level_1 >= 10 AND team_profit >= 2000000 THEN
    eligible := 4;
  END IF;

  RETURN eligible;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_user_level(user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  calc INTEGER;
BEGIN
  calc := public.calculate_eligible_level(user_id);
  PERFORM set_config('jozik.internal_update', '1', true);
  UPDATE public.profiles SET level = GREATEST(level, calc), updated_at = NOW()
  WHERE id = user_id AND level < calc;
  RETURN calc;
END;
$$;

-- Monthly salary (Level 2+, team monthly profit in NGN)
CREATE OR REPLACE FUNCTION public.process_monthly_salary(p_user_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  prof public.profiles%ROWTYPE;
  month_key TEXT;
  team_monthly_ngn NUMERIC;
  salary_ngn NUMERIC := 0;
  salary_usd NUMERIC;
BEGIN
  SELECT * INTO prof FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND OR prof.level < 2 THEN RETURN 0; END IF;

  month_key := to_char(NOW(), 'YYYY-MM');
  IF prof.last_salary_month = month_key THEN RETURN 0; END IF;

  SELECT COALESCE(SUM(pc.amount_ngn), 0) INTO team_monthly_ngn
  FROM public.profit_credits pc
  WHERE pc.credit_type = 'daily_profit'
    AND pc.created_at >= date_trunc('month', NOW())
    AND (
      pc.user_id = p_user_id
      OR pc.user_id IN (SELECT id FROM public.profiles WHERE referred_by = p_user_id)
    );

  IF team_monthly_ngn >= 5000000 THEN salary_ngn := 100000;
  ELSIF team_monthly_ngn >= 2000000 THEN salary_ngn := 50000;
  ELSIF team_monthly_ngn >= 1000000 THEN salary_ngn := 20000;
  ELSE RETURN 0;
  END IF;

  salary_usd := public.ngn_to_usd(salary_ngn);
  PERFORM public.credit_user_balance(p_user_id, salary_usd, p_user_id, 'monthly_salary', NULL);

  PERFORM set_config('jozik.internal_update', '1', true);
  UPDATE public.profiles SET last_salary_month = month_key, updated_at = NOW() WHERE id = p_user_id;

  RETURN salary_usd;
END;
$$;

-- Process one investment day of profit
CREATE OR REPLACE FUNCTION public.process_investment_daily(rec public.investments)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  daily_profit NUMERIC;
BEGIN
  IF rec.days_credited >= rec.plan_days THEN RETURN; END IF;

  daily_profit := ROUND(rec.amount_usd * (rec.daily_rate / 100), 4);

  PERFORM public.credit_user_balance(rec.user_id, daily_profit, rec.user_id, 'daily_profit', rec.id);
  PERFORM public.credit_referral_bonuses(rec.user_id, daily_profit, rec.id);

  UPDATE public.investments
  SET
    days_credited = days_credited + 1,
    last_profit_date = CURRENT_DATE,
    total_profit_credited = total_profit_credited + daily_profit,
    profit_usd = total_profit_credited + daily_profit
  WHERE id = rec.id;

  -- Mature: return principal
  IF (SELECT days_credited FROM public.investments WHERE id = rec.id) >= rec.plan_days THEN
    PERFORM public.credit_user_balance(rec.user_id, rec.amount_usd, rec.user_id, 'principal_return', rec.id);
    UPDATE public.investments SET status = 'matured', matured_at = NOW() WHERE id = rec.id;
  END IF;
END;
$$;

-- Main: process all pending daily credits for current user
CREATE OR REPLACE FUNCTION public.process_daily_rewards()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  rec RECORD;
  days_to_credit INTEGER;
  d INTEGER;
  daily_count INTEGER := 0;
  matured_count INTEGER := 0;
  salary_usd NUMERIC;
  new_level INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RETURN '{}'::jsonb; END IF;

  PERFORM set_config('jozik.internal_update', '1', true);

  FOR rec IN
    SELECT * FROM public.investments
    WHERE user_id = v_user_id AND status = 'active'
    FOR UPDATE
  LOOP
    days_to_credit := rec.plan_days - rec.days_credited;
    IF days_to_credit <= 0 THEN CONTINUE; END IF;

    -- Credit missed days (user offline catch-up), max one day if same-day already credited
    IF rec.last_profit_date = CURRENT_DATE THEN
      days_to_credit := 0;
    ELSIF rec.last_profit_date IS NOT NULL THEN
      days_to_credit := LEAST(
        days_to_credit,
        GREATEST(0, (CURRENT_DATE - rec.last_profit_date)::INTEGER)
      );
    ELSE
      days_to_credit := LEAST(days_to_credit, GREATEST(1, (CURRENT_DATE - rec.started_at::date)::INTEGER));
    END IF;

    FOR d IN 1..days_to_credit LOOP
      SELECT * INTO rec FROM public.investments WHERE id = rec.id;
      EXIT WHEN rec.status != 'active' OR rec.days_credited >= rec.plan_days;
      PERFORM public.process_investment_daily(rec);
      daily_count := daily_count + 1;
      IF (SELECT status FROM public.investments WHERE id = rec.id) = 'matured' THEN
        matured_count := matured_count + 1;
      END IF;
    END LOOP;
  END LOOP;

  new_level := public.apply_user_level(v_user_id);
  salary_usd := public.process_monthly_salary(v_user_id);

  RETURN jsonb_build_object(
    'daily_credits', daily_count,
    'matured', matured_count,
    'salary_usd', salary_usd,
    'level', new_level
  );
END;
$$;

-- Replace create_investment: lock capital only, daily profit handled separately
DROP FUNCTION IF EXISTS public.create_investment(integer, integer, numeric, numeric, numeric, numeric) CASCADE;

CREATE FUNCTION public.create_investment(
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

  v_min_usd := public.ngn_to_usd(p_min_ngn);
  v_max_usd := public.ngn_to_usd(p_max_ngn);

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
    p_min_ngn, p_max_ngn, NOW() + (p_days || ' days')::INTERVAL, 0, NULL
  ) RETURNING id INTO v_investment_id;

  RETURN jsonb_build_object('investment_id', v_investment_id, 'new_balance', v_new_balance);
END;
$$;

-- Disable old bulk maturity function (replaced by daily)
CREATE OR REPLACE FUNCTION public.process_matured_investments()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN RETURN 0; END; $$;

GRANT EXECUTE ON FUNCTION public.process_daily_rewards() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_investment(integer, integer, numeric, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_eligible_level(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_user_level(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_direct_referral_stats(uuid) TO authenticated;

-- Recreate dashboard view (depends on calculate_eligible_level)
CREATE OR REPLACE VIEW public.my_dashboard_stats AS
SELECT
  p.id,
  p.full_name,
  p.email,
  p.phone,
  p.referral_code,
  p.level,
  p.balance,
  p.total_invested,
  COALESCE(p.team_profit_accumulation_ngn, p.team_accumulation, 0) AS team_profit_ngn,
  p.monthly_team_accumulation,
  public.get_referral_signup_count(p.id) AS referral_signups,
  public.calculate_eligible_level(p.id) AS eligible_level
FROM public.profiles p
WHERE p.id = auth.uid();

GRANT SELECT ON public.my_dashboard_stats TO authenticated;
