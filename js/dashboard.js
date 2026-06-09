let currentProfile = null;
let selectedPlan = null;
let userInvestments = [];
let selectedReceiptFile = null;

document.addEventListener('DOMContentLoaded', async () => {
  const session = await requireAuth();
  if (!session) return;

  await loadDashboard();

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await sb.auth.signOut();
    window.location.href = 'index.html';
  });

  document.getElementById('deposit-btn')?.addEventListener('click', () => {
    document.getElementById('deposit-modal')?.classList.add('open');
  });

  document.getElementById('withdrawal-btn')?.addEventListener('click', () => {
    openWithdrawalModal();
  });

  document.getElementById('profile-btn')?.addEventListener('click', () => {
    openProfileModal();
  });

  document.getElementById('investment-plan-btn')?.addEventListener('click', toggleInvestmentPlans);
  document.getElementById('investment-plan-btn-desktop')?.addEventListener('click', toggleInvestmentPlans);

  document.getElementById('withdrawal-method')?.addEventListener('change', updateWithdrawalFields);

  document.getElementById('withdrawal-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    submitWithdrawal();
  });

  document.getElementById('receipt-file-input')?.addEventListener('change', onReceiptFileSelected);
  document.getElementById('upload-receipt-btn')?.addEventListener('click', uploadReceipt);

  document.getElementById('plan-confirm-yes')?.addEventListener('click', () => {
    document.getElementById('plan-confirm-modal')?.classList.remove('open');
    openInvestAmountModal();
  });

  document.getElementById('invest-amount-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await submitInvestment();
  });

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.modal-overlay')?.classList.remove('open');
    });
  });

  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      copyText(btn.dataset.copy, btn.dataset.copyLabel || 'Detail');
    });
  });

  document.getElementById('profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentProfile) return;

    const { error } = await sb
      .from('profiles')
      .update({
        full_name: document.getElementById('edit-full-name').value.trim(),
        phone: document.getElementById('edit-phone').value.trim(),
      })
      .eq('id', currentProfile.id);

    if (error) {
      showToast(error.message, 'error');
      return;
    }

    showToast('Profile updated', 'success');
    document.getElementById('profile-modal')?.classList.remove('open');
    await loadDashboard();
  });
});

async function loadDashboard() {
  const main = document.getElementById('dashboard-main');
  if (main) main.innerHTML = '<p class="loading">Loading your portfolio…</p>';

  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  const { data: maturedCount, error: matureErr } = await sb.rpc('process_matured_investments');
  if (!matureErr && maturedCount > 0) {
    showToast(`${maturedCount} investment(s) matured — balance updated!`, 'success');
  }

  const { data: profile, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error || !profile) {
    if (main) {
      main.innerHTML =
        '<p class="loading">Unable to load profile. Ensure you ran supabase/schema.sql and investments.sql.</p>';
    }
    return;
  }

  currentProfile = profile;
  profile.email = profile.email || user.email;

  const { data: investments, error: invErr } = await sb
    .from('investments')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  userInvestments = invErr ? [] : (investments || []);
  if (invErr) {
    console.warn('Investments load:', invErr.message);
  }

  const { data: referralSignups, error: countErr } = await sb.rpc(
    'get_referral_signup_count',
    { user_id: user.id },
  );

  const eligibleLevel = await fetchEligibleLevel(user.id);
  const bonus = profile.level >= 2 ? REFERRAL_BONUS.level2Plus : REFERRAL_BONUS.belowLevel2;
  const salaryNote = getSalaryTier(profile);
  const signups = countErr ? 0 : (referralSignups ?? 0);

  document.getElementById('user-greeting').textContent = profile.full_name || 'Investor';
  document.getElementById('user-level-label').textContent = `Level ${profile.level}`;
  document.getElementById('balance-display').textContent = formatUsd(profile.balance || 0);
  document.getElementById('referral-code-display').textContent = profile.referral_code;
  document.getElementById('referral-count').textContent = signups;
  document.getElementById('team-accumulation').textContent = formatNgn(profile.team_accumulation || 0);
  document.getElementById('eligible-level').textContent = eligibleLevel;

  if (main) {
    main.innerHTML = `
      <section class="my-investments-section">
        <h2 class="section-title">Your investments</h2>
        <div id="investments-list"></div>
      </section>

      <div id="investment-plans-panel" class="investment-plans-panel" hidden>
        <section>
          <h2 class="section-title">Choose a plan</h2>
          <p class="section-sub">All levels are open. Tap a plan to invest. Limits shown in Naira with USD at ₦${NGN_PER_USD}/$1.</p>
          <div id="all-levels"></div>
        </section>

        <section class="info-panel">
          <h3>Referral bonuses (% of members' daily earnings, not capital)</h3>
          <ul>
            <li>Your tier (Level ${profile.level >= 2 ? '2+' : '1'}): ${bonus.gen1}% 1st gen · ${bonus.gen2}% 2nd gen · ${bonus.gen3}% 3rd gen</li>
            <li>Level 2+: 10% / 4% / 2% · Below Level 2: 8% / 3% / 1%</li>
          </ul>
          <h3>Monthly salary (Level 2+ required)</h3>
          <p>${salaryNote}</p>
          <h3>Withdrawals &amp; fees</h3>
          <ul>
            <li>₦${WITHDRAWAL_FEE_NGN} fee for dollar withdrawals (≈ ${formatUsd(ngnToUsd(WITHDRAWAL_FEE_NGN))})</li>
            <li>Crypto withdrawal: ${CRYPTO_WITHDRAWAL_PERCENT}% charge</li>
            <li>Naira withdrawal: ${NAIRA_WITHDRAWAL_PERCENT}% charge</li>
            <li>Profit can be withdrawn · Minimum withdrawal: ${formatNgnWithUsd(MIN_WITHDRAWAL_NGN)}</li>
          </ul>
          <h3>Level progress</h3>
          <ul id="level-progress"></ul>
        </section>
      </div>
    `;

    renderAllLevelsOverview(document.getElementById('all-levels'));
    renderLevelProgress(document.getElementById('level-progress'), profile, signups);
    renderInvestmentsList();
    bindPlanSelection();
  }
}

function bindPlanSelection() {
  const panel = document.getElementById('investment-plans-panel');
  if (!panel) return;

  panel.querySelectorAll('.plan-selectable').forEach((card) => {
    card.addEventListener('click', () => handlePlanSelect(getPlanFromElement(card)));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handlePlanSelect(getPlanFromElement(card));
      }
    });
  });
}

function handlePlanSelect(plan) {
  if (!plan || !currentProfile) return;

  const balance = Number(currentProfile.balance) || 0;
  const minUsd = planMinUsd(plan);
  const maxUsd = planMaxUsd(plan);

  if (balance < minUsd) {
    showToast(
      `Insufficient balance. You need at least ${formatUsd(minUsd)} for this plan.`,
      'error',
    );
    return;
  }

  selectedPlan = plan;

  document.getElementById('plan-confirm-body').innerHTML = `
    <ul class="plan-detail-list">
      <li><strong>Level:</strong> ${plan.level}</li>
      <li><strong>Duration:</strong> ${plan.days} days</li>
      <li><strong>Daily rate:</strong> ${plan.daily}%</li>
      <li><strong>Minimum:</strong> ${formatNgnWithUsd(plan.minNgn)}</li>
      <li><strong>Maximum:</strong> ${formatNgnWithUsd(plan.maxNgn)}</li>
      <li><strong>Your balance:</strong> ${formatUsd(balance)}</li>
      <li><strong>Est. profit at max:</strong> ${formatUsd(calcExpectedProfit(Math.min(balance, maxUsd), plan.daily, plan.days))}</li>
    </ul>
    <p class="modal-hint">On maturity, principal + profit (${plan.daily}% × ${plan.days} days) returns to your balance automatically.</p>
  `;

  document.getElementById('plan-confirm-modal')?.classList.add('open');
}

function openInvestAmountModal() {
  if (!selectedPlan || !currentProfile) return;

  const balance = Number(currentProfile.balance) || 0;
  const minUsd = planMinUsd(selectedPlan);
  const maxUsd = Math.min(planMaxUsd(selectedPlan), balance);

  document.getElementById('invest-amount-hint').textContent =
    `Level ${selectedPlan.level} · ${selectedPlan.days} days · ${selectedPlan.daily}% daily`;

  const input = document.getElementById('invest-amount-input');
  input.min = minUsd.toFixed(2);
  input.max = maxUsd.toFixed(2);
  input.value = '';
  input.placeholder = `Between ${formatUsd(minUsd)} and ${formatUsd(maxUsd)}`;

  document.getElementById('invest-amount-limits').textContent =
    `Min ${formatUsd(minUsd)} · Max ${formatUsd(maxUsd)}`;
  document.getElementById('invest-balance-hint').textContent = formatUsd(balance);

  document.getElementById('invest-amount-modal')?.classList.add('open');
}

async function submitInvestment() {
  if (!selectedPlan || !currentProfile) return;

  const amount = Number(document.getElementById('invest-amount-input').value);
  const balance = Number(currentProfile.balance) || 0;
  const minUsd = planMinUsd(selectedPlan);
  const maxUsd = Math.min(planMaxUsd(selectedPlan), balance);

  if (!amount || amount < minUsd) {
    showToast(`Minimum investment is ${formatUsd(minUsd)}`, 'error');
    return;
  }
  if (amount > maxUsd) {
    showToast(`Maximum you can invest is ${formatUsd(maxUsd)}`, 'error');
    return;
  }
  if (amount > balance) {
    showToast('Amount exceeds your available balance', 'error');
    return;
  }

  const btn = document.querySelector('#invest-amount-form button[type="submit"]');
  btn.disabled = true;

  const { data, error } = await sb.rpc('create_investment', {
    p_level: selectedPlan.level,
    p_days: selectedPlan.days,
    p_daily_rate: selectedPlan.daily,
    p_amount_usd: amount,
    p_min_ngn: selectedPlan.minNgn,
    p_max_ngn: selectedPlan.maxNgn,
  });

  btn.disabled = false;

  if (error) {
    showToast(error.message, 'error');
    return;
  }

  const newBalance =
    data && typeof data === 'object' && data.new_balance != null
      ? Number(data.new_balance)
      : balance - amount;

  currentProfile.balance = newBalance;
  document.getElementById('balance-display').textContent = formatUsd(newBalance);

  document.getElementById('invest-amount-modal')?.classList.remove('open');
  selectedPlan = null;
  showToast(`Invested ${formatUsd(amount)} — new balance ${formatUsd(newBalance)}`, 'success');
  await loadDashboard();
}

function onReceiptFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Please select an image file', 'error');
    e.target.value = '';
    return;
  }

  selectedReceiptFile = file;
  document.getElementById('receipt-file-label').textContent = file.name;
  document.getElementById('upload-receipt-btn').disabled = false;

  const preview = document.getElementById('receipt-preview');
  const wrap = document.getElementById('receipt-preview-wrap');
  if (preview && wrap) {
    preview.src = URL.createObjectURL(file);
    wrap.hidden = false;
  }
}

async function uploadReceipt() {
  if (!selectedReceiptFile || !currentProfile) {
    showToast('Select a receipt image first', 'error');
    return;
  }

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;

  const btn = document.getElementById('upload-receipt-btn');
  btn.disabled = true;
  btn.textContent = 'Uploading…';

  const ext = selectedReceiptFile.name.split('.').pop() || 'jpg';
  const path = `${user.id}/${Date.now()}.${ext}`;

  const { error: uploadErr } = await sb.storage
    .from('receipts')
    .upload(path, selectedReceiptFile, { cacheControl: '3600', upsert: false });

  if (uploadErr) {
    showToast(uploadErr.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Upload receipt';
    return;
  }

  const { data: urlData } = sb.storage.from('receipts').getPublicUrl(path);

  const { error: rpcErr } = await sb.rpc('add_user_receipt', {
    p_url: urlData.publicUrl,
    p_file_name: selectedReceiptFile.name,
  });

  btn.disabled = false;
  btn.textContent = 'Upload receipt';

  if (rpcErr) {
    showToast(rpcErr.message, 'error');
    return;
  }

  selectedReceiptFile = null;
  document.getElementById('receipt-file-input').value = '';
  document.getElementById('receipt-file-label').textContent = 'Tap to select receipt image';
  document.getElementById('receipt-preview-wrap').hidden = true;
  document.getElementById('deposit-modal')?.classList.remove('open');
  document.getElementById('receipt-success-modal')?.classList.add('open');
  showToast('Receipt uploaded successfully', 'success');
}

function renderInvestmentsList() {
  const container = document.getElementById('investments-list');
  if (!container) return;

  if (!userInvestments.length) {
    container.innerHTML =
      '<p class="empty-investments">No investments yet. Click <strong>Plans</strong> in the header to start.</p>';
    return;
  }

  container.innerHTML = userInvestments
    .map((inv) => {
      const profit =
        inv.status === 'matured'
          ? Number(inv.profit_usd)
          : calcExpectedProfit(inv.amount_usd, inv.daily_rate, inv.plan_days);
      const statusLabel = inv.status === 'matured' ? 'Matured' : 'Active';
      const statusClass = inv.status === 'matured' ? 'status-matured' : 'status-active';
      return `
        <article class="investment-row">
          <div class="investment-row-info">
            <strong>Level ${inv.plan_level} · ${inv.plan_days}d · ${inv.daily_rate}%/day</strong>
            <span>${formatUsd(inv.amount_usd)} invested · Profit: ${formatUsd(profit)}</span>
            <span class="investment-status ${statusClass}">${statusLabel}</span>
          </div>
          <button type="button" class="btn btn-sm btn-outline" data-view-investment="${inv.id}">View</button>
        </article>
      `;
    })
    .join('');

  container.querySelectorAll('[data-view-investment]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const inv = userInvestments.find((i) => i.id === btn.dataset.viewInvestment);
      if (inv) openInvestmentViewModal(inv);
    });
  });
}

function openInvestmentViewModal(inv) {
  const profit =
    inv.status === 'matured'
      ? Number(inv.profit_usd)
      : calcExpectedProfit(inv.amount_usd, inv.daily_rate, inv.plan_days);
  const payout = Number(inv.amount_usd) + profit;
  const started = new Date(inv.started_at).toLocaleString();
  const matures = new Date(inv.matures_at).toLocaleString();
  const matured = inv.matured_at ? new Date(inv.matured_at).toLocaleString() : '—';

  document.getElementById('investment-view-body').innerHTML = `
    <ul class="plan-detail-list">
      <li><strong>Status:</strong> ${inv.status === 'matured' ? 'Matured ✓' : 'Active'}</li>
      <li><strong>Level:</strong> ${inv.plan_level}</li>
      <li><strong>Duration:</strong> ${inv.plan_days} days</li>
      <li><strong>Daily rate:</strong> ${inv.daily_rate}%</li>
      <li><strong>Amount invested:</strong> ${formatUsd(inv.amount_usd)}</li>
      <li><strong>Expected profit:</strong> ${formatUsd(profit)}</li>
      <li><strong>Total at maturity:</strong> ${formatUsd(payout)}</li>
      <li><strong>Started:</strong> ${started}</li>
      <li><strong>Matures:</strong> ${matures}</li>
      ${inv.status === 'matured' ? `<li><strong>Matured on:</strong> ${matured}</li>` : ''}
    </ul>
  `;
  document.getElementById('investment-view-modal')?.classList.add('open');
}

function toggleInvestmentPlans() {
  const panel = document.getElementById('investment-plans-panel');
  if (!panel) return;
  const willOpen = panel.hidden;
  panel.hidden = !willOpen;
  panel.classList.toggle('is-open', willOpen);
  document.getElementById('investment-plan-btn')?.setAttribute('aria-expanded', String(willOpen));
  document.getElementById('investment-plan-btn-desktop')?.setAttribute('aria-expanded', String(willOpen));
  document.getElementById('investment-plan-btn-desktop')?.classList.toggle('btn-active', willOpen);
}

function openWithdrawalModal() {
  if (!currentProfile) return;
  const form = document.getElementById('withdrawal-form');
  form?.reset();
  const balance = Number(currentProfile.balance) || 0;

  document.getElementById('wd-full-name').value = currentProfile.full_name || '';
  document.getElementById('wd-email').value = currentProfile.email || '';
  document.getElementById('wd-referral-code').value = currentProfile.referral_code || '';

  const amountInput = document.getElementById('wd-amount');
  if (amountInput) {
    amountInput.max = balance > 0 ? balance.toFixed(2) : '0';
    amountInput.placeholder = balance > 0 ? `Max ${formatUsd(balance)}` : 'No balance available';
    amountInput.disabled = balance <= 0;
  }

  document.getElementById('wd-balance-hint').textContent = formatUsd(balance);
  updateWithdrawalFields();
  document.getElementById('withdrawal-modal')?.classList.add('open');
}

function updateWithdrawalFields() {
  const method = document.getElementById('withdrawal-method')?.value;
  const bankFields = document.getElementById('withdrawal-bank-fields');
  const cryptoFields = document.getElementById('withdrawal-crypto-fields');
  if (!bankFields || !cryptoFields) return;
  bankFields.hidden = method !== 'bank';
  cryptoFields.hidden = method !== 'crypto';
}

async function submitWithdrawal() {
  if (!currentProfile) return;

  const amount = document.getElementById('wd-amount').value.trim();
  const method = document.getElementById('withdrawal-method').value;
  const balance = Number(currentProfile.balance) || 0;

  if (!amount || Number(amount) <= 0) {
    showToast('Enter a valid withdrawal amount', 'error');
    return;
  }

  if (Number(amount) > balance) {
    showToast(`You can only withdraw up to ${formatUsd(balance)}`, 'error');
    return;
  }

  const request = {
    full_name: currentProfile.full_name || '',
    email: currentProfile.email || '',
    referral_code: currentProfile.referral_code || '',
    amount: Number(amount),
    method: method === 'bank' ? 'Bank Account' : 'Crypto',
  };

  if (method === 'bank') {
    const bankName = document.getElementById('wd-bank-name').value.trim();
    const accountNumber = document.getElementById('wd-account-number').value.trim();
    const accountName = document.getElementById('wd-account-name').value.trim();
    if (!bankName || !accountNumber || !accountName) {
      showToast('Fill in all bank details', 'error');
      return;
    }
    request.bank_name = bankName;
    request.account_number = accountNumber;
    request.account_name = accountName;
  } else {
    const cryptoType = document.getElementById('wd-crypto-type').value;
    const wallet = document.getElementById('wd-wallet').value.trim();
    if (!wallet) {
      showToast('Enter your crypto wallet address', 'error');
      return;
    }
    request.crypto_type = cryptoType;
    request.wallet_address = wallet;
  }

  const btn = document.querySelector('#withdrawal-form button[type="submit"]');
  btn.disabled = true;

  const { data, error } = await sb.rpc('add_withdrawal_request', { p_request: request });

  btn.disabled = false;

  if (error) {
    showToast(error.message, 'error');
    return;
  }

  const newBalance =
    data && data.new_balance != null ? Number(data.new_balance) : balance - Number(amount);

  currentProfile.balance = newBalance;
  document.getElementById('balance-display').textContent = formatUsd(newBalance);

  document.getElementById('withdrawal-form')?.reset();
  document.getElementById('withdrawal-modal')?.classList.remove('open');
  document.getElementById('withdrawal-success-modal')?.classList.add('open');
  showToast(`Withdrawal sent — new balance ${formatUsd(newBalance)}`, 'success');
}

async function fetchEligibleLevel(userId) {
  const { data, error } = await sb.rpc('calculate_eligible_level', { user_id: userId });
  if (error) return '—';
  return data ?? 1;
}

function getSalaryTier(profile) {
  if (profile.level < 2) {
    return 'Reach Level 2 to qualify for monthly salary from team accumulation.';
  }
  const monthly = Number(profile.monthly_team_accumulation) || 0;
  const tier = [...MONTHLY_SALARY_TIERS].reverse().find((t) => monthly >= t.minNgn);
  if (!tier) {
    return `Current monthly team accumulation: ${formatNgn(monthly)}. Tiers: ₦1M → ₦20,000 · ₦2M → ₦50,000 · ₦5M → ₦100,000.`;
  }
  return `Monthly accumulation ${formatNgn(monthly)} — estimated salary ${formatNgn(tier.salaryNgn)}/month.`;
}

function renderLevelProgress(container, profile, signups) {
  if (!container) return;
  const team = Number(profile.team_accumulation) || 0;
  container.innerHTML = `
    <li>Referral signups: <strong>${signups}</strong></li>
    <li>Team accumulation: <strong>${formatNgn(team)}</strong></li>
    <li>Your level: <strong>Level ${profile.level}</strong></li>
    <li><em>All investment levels are open to every investor.</em></li>
  `;
}

function openProfileModal() {
  if (!currentProfile) return;
  document.getElementById('edit-full-name').value = currentProfile.full_name || '';
  document.getElementById('edit-phone').value = currentProfile.phone || '';
  document.getElementById('edit-email').value = currentProfile.email || '';
  document.getElementById('profile-modal')?.classList.add('open');
}
