-- =============================================================================
-- Run this FIRST if daily_rewards.sql fails with "cannot change return type"
-- Then run the full daily_rewards.sql again
-- =============================================================================

DROP VIEW IF EXISTS public.my_dashboard_stats;

DROP FUNCTION IF EXISTS public.get_direct_referral_stats(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.calculate_eligible_level(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.apply_user_level(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.create_investment(integer, integer, numeric, numeric, numeric, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.process_daily_rewards() CASCADE;
DROP FUNCTION IF EXISTS public.process_matured_investments() CASCADE;
