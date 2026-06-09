-- =============================================================================
-- Withdrawal deducts balance automatically — run after receipts_withdrawals.sql
-- =============================================================================

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

GRANT EXECUTE ON FUNCTION public.add_withdrawal_request(JSONB) TO authenticated;
