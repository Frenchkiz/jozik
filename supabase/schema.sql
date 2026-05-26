-- =============================================================================
-- Jozik Capital - Supabase Database Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor → New query
-- =============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- Profiles (extends auth.users)
-- Admin can manually edit: balance, total_invested, level, monthly_team_accumulation
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT DEFAULT '',
  referral_code TEXT UNIQUE NOT NULL,
  referred_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 4),
  balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  total_invested NUMERIC(18, 2) NOT NULL DEFAULT 0,
  team_accumulation NUMERIC(18, 2) NOT NULL DEFAULT 0,
  monthly_team_accumulation NUMERIC(18, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_referral_code ON public.profiles(referral_code);
CREATE INDEX IF NOT EXISTS idx_profiles_referred_by ON public.profiles(referred_by);
CREATE INDEX IF NOT EXISTS idx_profiles_level ON public.profiles(level);

-- -----------------------------------------------------------------------------
-- Generate unique referral code: JOZ + 6 alphanumeric chars
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  new_code TEXT;
  done BOOLEAN := FALSE;
BEGIN
  WHILE NOT done LOOP
    new_code := 'JOZ' || upper(substring(md5(random()::text || clock_timestamp()::text) FROM 1 FOR 6));
    done := NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = new_code);
  END LOOP;
  RETURN new_code;
END;
$$;

-- -----------------------------------------------------------------------------
-- Count direct referral signups
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_referral_signup_count(user_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER FROM public.profiles WHERE referred_by = user_id;
$$;

-- Active member: has invested or has balance
CREATE OR REPLACE FUNCTION public.is_active_member(p public.profiles)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT (COALESCE(p.total_invested, 0) > 0 OR COALESCE(p.balance, 0) > 0);
$$;

-- Direct referrals only (used referral code at signup)
CREATE OR REPLACE FUNCTION public.get_direct_referral_stats(user_id UUID)
RETURNS TABLE (
  total_signups INTEGER,
  active_level_1 INTEGER,
  active_level_2 INTEGER,
  active_level_3 INTEGER,
  team_accumulation_calc NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::INTEGER AS total_signups,
    COUNT(*) FILTER (WHERE p.level = 1 AND public.is_active_member(p))::INTEGER AS active_level_1,
    COUNT(*) FILTER (WHERE p.level = 2 AND public.is_active_member(p))::INTEGER AS active_level_2,
    COUNT(*) FILTER (WHERE p.level = 3 AND public.is_active_member(p))::INTEGER AS active_level_3,
    COALESCE(SUM(p.total_invested), 0) AS team_accumulation_calc
  FROM public.profiles p
  WHERE p.referred_by = user_id;
$$;

-- Compute eligible level from referral rules
CREATE OR REPLACE FUNCTION public.calculate_eligible_level(user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prof public.profiles%ROWTYPE;
  stats RECORD;
  eligible INTEGER := 1;
BEGIN
  SELECT * INTO prof FROM public.profiles WHERE id = user_id;
  IF NOT FOUND THEN
    RETURN 1;
  END IF;

  SELECT * INTO stats FROM public.get_direct_referral_stats(user_id);

  -- Use stored team_accumulation (admin may adjust) or calculated sum, whichever is higher
  IF COALESCE(prof.team_accumulation, 0) < COALESCE(stats.team_accumulation_calc, 0) THEN
    prof.team_accumulation := stats.team_accumulation_calc;
  END IF;

  -- Level 2: 3+ referrals, 100,000 NGN team accumulation
  IF stats.total_signups >= 3 AND prof.team_accumulation >= 100000 THEN
    eligible := 2;
  END IF;

  -- Level 3
  IF eligible >= 2
     AND stats.active_level_2 >= 2
     AND stats.active_level_1 >= 5
     AND prof.team_accumulation >= 1000000 THEN
    eligible := 3;
  END IF;

  -- Level 4
  IF eligible >= 3
     AND stats.active_level_3 >= 2
     AND stats.active_level_2 >= 1
     AND stats.active_level_1 >= 10
     AND prof.team_accumulation >= 2000000 THEN
    eligible := 4;
  END IF;

  RETURN eligible;
END;
$$;

-- Sync team_accumulation from referrals when a referred user is updated
CREATE OR REPLACE FUNCTION public.sync_referrer_team_accumulation()
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
    SELECT COALESCE(SUM(total_invested), 0) INTO new_sum
    FROM public.profiles
    WHERE referred_by = ref_id;

    UPDATE public.profiles
    SET team_accumulation = new_sum,
        updated_at = NOW()
    WHERE id = ref_id;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.referred_by IS DISTINCT FROM NEW.referred_by AND OLD.referred_by IS NOT NULL THEN
    SELECT COALESCE(SUM(total_invested), 0) INTO new_sum
    FROM public.profiles
    WHERE referred_by = OLD.referred_by;

    UPDATE public.profiles
    SET team_accumulation = new_sum,
        updated_at = NOW()
    WHERE id = OLD.referred_by;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_referrer_team ON public.profiles;
CREATE TRIGGER trg_sync_referrer_team
  AFTER INSERT OR UPDATE OF total_invested, referred_by ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_referrer_team_accumulation();

-- Auto-update level when investments/referrals change (never downgrade below manual admin set if needed)
-- Level is set to MAX(current manual level cap, calculated eligible) - admin can set level directly higher
CREATE OR REPLACE FUNCTION public.maybe_update_level()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  calc_level INTEGER;
BEGIN
  calc_level := public.calculate_eligible_level(NEW.id);
  IF calc_level > NEW.level THEN
    NEW.level := calc_level;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_maybe_update_level ON public.profiles;
CREATE TRIGGER trg_maybe_update_level
  BEFORE UPDATE OF total_invested, team_accumulation ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.maybe_update_level();

-- -----------------------------------------------------------------------------
-- Create profile on new auth user signup
-- metadata: full_name, phone, referral_code_input (optional)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ref_code TEXT;
  referrer_id UUID;
  v_full_name TEXT;
  v_phone TEXT;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_phone := COALESCE(NEW.raw_user_meta_data->>'phone', '');
  ref_code := NULLIF(trim(NEW.raw_user_meta_data->>'referral_code_input'), '');

  referrer_id := NULL;
  IF ref_code IS NOT NULL THEN
    SELECT id INTO referrer_id
    FROM public.profiles
    WHERE upper(referral_code) = upper(ref_code)
    LIMIT 1;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, phone, referral_code, referred_by)
  VALUES (
    NEW.id,
    NEW.email,
    v_full_name,
    v_phone,
    public.generate_referral_code(),
    referrer_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile fields" ON public.profiles;
CREATE POLICY "Users can update own profile fields"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Prevent users from changing protected columns via API (enforced in app + optional trigger)
CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
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
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_columns();

-- Referral validation at signup uses RPC only (no public table read)
CREATE OR REPLACE FUNCTION public.validate_referral_code(code TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE upper(referral_code) = upper(trim(code))
  );
$$;

GRANT EXECUTE ON FUNCTION public.validate_referral_code(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_referral_signup_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_direct_referral_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_eligible_level(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- View for dashboard stats (optional)
-- -----------------------------------------------------------------------------
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
  p.team_accumulation,
  p.monthly_team_accumulation,
  public.get_referral_signup_count(p.id) AS referral_signups,
  public.calculate_eligible_level(p.id) AS eligible_level
FROM public.profiles p
WHERE p.id = auth.uid();

GRANT SELECT ON public.my_dashboard_stats TO authenticated;

-- =============================================================================
-- ADMIN NOTES (run in Table Editor with service role / as project owner):
-- - balance: user's displayed wallet balance (manual after confirming deposit)
-- - total_invested: counts toward referrer's team_accumulation
-- - level: can set manually; auto-increases when criteria met via trigger
-- - monthly_team_accumulation: for salary tier display (manual tracking)
-- =============================================================================
