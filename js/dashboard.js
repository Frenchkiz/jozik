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

  document.getElementById('withdrawal-btn')?.addEventListener('click', openWithdrawalModal);
  document.getElementById('profile-btn')?.addEventListener('click', openProfileModal);

  document.getElementById('investment-plan-btn')?.addEventListener('click', openPlansModal);
  document.getElementById('investment-plan-btn-desktop')?.addEventListener('click', openPlansModal);

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

  const { data: rewards, error: rewardsErr } = await sb.rpc('process_daily_rewards');
  if (!rewardsErr && rewards) {
    const parts = [];
    if (rewards.daily_credits > 0) parts.push(`${rewards.daily_credits} daily profit credit(s)`);
    if (rewards.matured > 0) parts.push(`${rewards.matured} investment(s) matured`);
    if (rewards.salary_usd > 0) parts.push(`monthly salary ${formatUsd(rewards.salary_usd)}`);
    if (parts.length) showToast(parts.join(' · '), 'success');
  }

  const { data: profile, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error || !profile) {
    if (main) {
      main.innerHTML =
        '<p class="loading">Unable to load profile. Run supabase/schema.sql, investments.sql, and daily_rewards.sql.</p>';
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

  const { data: referralSignups, error: countErr } = await sb.rpc(
    'get_referral_signup_count',
    { user_id: user.id },
  );

  const eligibleLevel = await fetchEligibleLevel(user.id);
  const signups = countErr ? 0 : (referralSignups ?? 0);
  const teamProfitNgn = profile.team_profit_accumulation_ngn ?? profile.team_accumulation ?? 0;

  document.getElementById('user-greeting').textContent = profile.full_name || 'Investor';
  document.getElementById('user-level-label').textContent = `Level ${profile.level}`;
  document.getElementById('balance-display').textContent = formatUsd(profile.balance || 0);
  document.getElementById('referral-code-display').textContent = profile.referral_code;
  document.getElementById('referral-count').textContent = signups;
  document.getElementById('team-accumulation').textContent = formatNgn(teamProfitNgn);
  document.getElementById('eligible-level').textContent = eligibleLevel;

  if (main) {
    main.innerHTML = `
      <section class="my-investments-section">
        <h2 class="section-title">Your investments</h2>
        <p class="section-sub">Capital is locked until maturity. Daily profit credits to your balance automatically.</p>
        <div id="investments-list"></div>
      </section>
    `;
    renderInvestmentsList();
  }

  renderPlansModalContent(profile, signups);
}

function renderPlansModalContent(profile, signups = 0) {
  const levelsEl = document.getElementById('plans-modal-levels');
  const infoEl = document.getElementById('plans-modal-info');
  if (!levelsEl) return;

  renderAllLevelsOverview(levelsEl);

  if (infoEl) {
    infoEl.innerHTML = `
      <h3>Referral bonuses (of team daily profit)</h3>
      <p>${getReferralBonusText()}</p>
      <h3>Monthly salary (Level 2+)</h3>
      <p>${getSalaryTierText(profile)}</p>
      <h3>Level progress</h3>
      <ul id="level-progress"></ul>
    `;
    renderLevelProgress(document.getElementById('level-progress'), profile, signups);
  }

  bindPlanSelection(levelsEl);
}

function openPlansModal() {
  if (currentProfile) {
    const signups = document.getElementById('referral-count')?.textContent || 0;
    renderPlansModalContent(currentProfile, Number(signups) || 0);
  }
  document.getElementById('plans-modal')?.classList.add('open');
}

function bindPlanSelection(root) {
  if (!root) return;
  root.querySelectorAll('.plan-selectable').forEach((card) => {
    card.replaceWith(card.cloneNode(true));
  });
  root.querySelectorAll('.plan-selectable').forEach((card) => {
    card.addEventListener('click', () => {
      document.getElementById('plans-modal')?.classList.remove('open');
      handlePlanSelect(getPlanFromElement(card));
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        document.getElementById('plans-modal')?.classList.remove('open');
        handlePlanSelect(getPlanFromElement(card));
      }
    });
  });
}

function handlePlanSelect(plan) {
  if (!plan || !currentProfile) return;

  const balance = Number(currentProfile.balance) || 0;
  const minUsd = planMinUsd(plan);

  if (balance < minUsd) {
    showToast(`Insufficient balance. You need at least ${formatUsd(minUsd)} for this plan.`, 'error');
    return;
  }

  selectedPlan = plan;
  const maxInvest = Math.min(planMaxUsd(plan), balance);
  const dailyProfit = calcDailyProfit(maxInvest, plan.daily);

  document.getElementById('plan-confirm-body').innerHTML = `
    <ul class="plan-detail-list">
      <li><strong>Level:</strong> ${plan.level}</li>
      <li><strong>Duration:</strong> ${plan.days} days</li>
      <li><strong>Daily rate:</strong> ${plan.daily}% of locked capital</li>
      <li><strong>Minimum:</strong> ${formatNgnWithUsd(plan.minNgn)}</li>
      <li><strong>Maximum:</strong> ${formatNgnWithUsd(plan.maxNgn)}</li>
      <li><strong>Your balance:</strong> ${formatUsd(balance)}</li>
      <li><strong>Daily profit (at max):</strong> ${formatUsd(dailyProfit)}/day</li>
      <li><strong>Total profit (${plan.days} days):</strong> ${formatUsd(calcExpectedProfit(maxInvest, plan.daily, plan.days))}</li>
    </ul>
    <p class="modal-hint">Only your investment amount is locked. Daily profit is credited to your balance each day. At maturity, your capital returns automatically.</p>
  `;

  document.getElementById('plan-confirm-modal')?.classList.add('open');
}

function openInvestAmountModal() {
  if (!selectedPlan || !currentProfile) return;

  const balance = Number(currentProfile.balance) || 0;
  const minUsd = planMinUsd(selectedPlan);
  const maxUsd = Math.min(planMaxUsd(selectedPlan), balance);

  document.getElementById('invest-amount-hint').textContent =
    `Level ${selectedPlan.level} · ${selectedPlan.days} days · ${selectedPlan.daily}% daily on locked capital`;

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

  const newBalance = data?.new_balance != null ? Number(data.new_balance) : balance - amount;
  currentProfile.balance = newBalance;
  document.getElementById('balance-display').textContent = formatUsd(newBalance);

  document.getElementById('invest-amount-modal')?.classList.remove('open');
  selectedPlan = null;
  showToast(`Invested ${formatUsd(amount)} — ${formatUsd(amount)} locked until maturity`, 'success');
  await loadDashboard();
}

function renderInvestmentsList() {
  const container = document.getElementById('investments-list');
  if (!container) return;

  if (!userInvestments.length) {
    container.innerHTML =
      '<p class="empty-investments">No investments yet. Click <strong>Plans</strong> to start.</p>';
    return;
  }

  container.innerHTML = userInvestments
    .map((inv) => {
      const daily = calcDailyProfit(inv.amount_usd, inv.daily_rate);
      const earned = Number(inv.total_profit_credited) || 0;
      const totalExpected = calcExpectedProfit(inv.amount_usd, inv.daily_rate, inv.plan_days);
      const statusLabel = inv.status === 'matured' ? 'Matured' : 'Active';
      const statusClass = inv.status === 'matured' ? 'status-matured' : 'status-active';
      const progress = `${inv.days_credited || 0}/${inv.plan_days} days`;

      return `
        <article class="investment-row">
          <div class="investment-row-info">
            <strong>Level ${inv.plan_level} · ${inv.plan_days}d · ${inv.daily_rate}%/day</strong>
            <span>${formatUsd(inv.amount_usd)} locked · ${formatUsd(daily)}/day · Earned ${formatUsd(earned)} / ${formatUsd(totalExpected)}</span>
            <span>${progress} · <span class="investment-status ${statusClass}">${statusLabel}</span></span>
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
  const daily = calcDailyProfit(inv.amount_usd, inv.daily_rate);
  const earned = Number(inv.total_profit_credited) || 0;
  const totalExpected = calcExpectedProfit(inv.amount_usd, inv.daily_rate, inv.plan_days);
  const started = new Date(inv.started_at).toLocaleString();
  const matures = new Date(inv.matures_at).toLocaleString();

  document.getElementById('investment-view-body').innerHTML = `
    <ul class="plan-detail-list">
      <li><strong>Status:</strong> ${inv.status === 'matured' ? 'Matured ✓' : 'Active'}</li>
      <li><strong>Capital locked:</strong> ${formatUsd(inv.amount_usd)}</li>
      <li><strong>Daily profit:</strong> ${formatUsd(daily)}</li>
      <li><strong>Profit earned:</strong> ${formatUsd(earned)}</li>
      <li><strong>Total expected profit:</strong> ${formatUsd(totalExpected)}</li>
      <li><strong>Days credited:</strong> ${inv.days_credited || 0} / ${inv.plan_days}</li>
      <li><strong>Started:</strong> ${started}</li>
      <li><strong>Matures:</strong> ${matures}</li>
      ${inv.status === 'matured' ? `<li><strong>Capital returned:</strong> ${formatUsd(inv.amount_usd)}</li>` : ''}
    </ul>
  `;
  document.getElementById('investment-view-modal')?.classList.add('open');
}

function openWithdrawalModal() {
  if (!currentProfile) return;
  document.getElementById('withdrawal-form')?.reset();
  const balance = Number(currentProfile.balance) || 0;

  document.getElementById('wd-full-name').value = currentProfile.full_name || '';
  document.getElementById('wd-email').value = currentProfile.email || '';
  document.getElementById('wd-referral-code').value = currentProfile.referral_code || '';

  const amountInput = document.getElementById('wd-amount');
  if (amountInput) {
    amountInput.max = balance > 0 ? balance.toFixed(2) : '0';
    amountInput.placeholder = balance > 0 ? `Max ${formatUsd(balance)}` : 'No balance';
    amountInput.disabled = balance <= 0;
  }

  document.getElementById('wd-balance-hint').textContent = formatUsd(balance);
  updateWithdrawalFields();
  document.getElementById('withdrawal-modal')?.classList.add('open');
}

function updateWithdrawalFields() {
  const method = document.getElementById('withdrawal-method')?.value;
  document.getElementById('withdrawal-bank-fields').hidden = method !== 'bank';
  document.getElementById('withdrawal-crypto-fields').hidden = method !== 'crypto';
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
    request.bank_name = document.getElementById('wd-bank-name').value.trim();
    request.account_number = document.getElementById('wd-account-number').value.trim();
    request.account_name = document.getElementById('wd-account-name').value.trim();
    if (!request.bank_name || !request.account_number || !request.account_name) {
      showToast('Fill in all bank details', 'error');
      return;
    }
  } else {
    request.crypto_type = document.getElementById('wd-crypto-type').value;
    request.wallet_address = document.getElementById('wd-wallet').value.trim();
    if (!request.wallet_address) {
      showToast('Enter your crypto wallet address', 'error');
      return;
    }
  }

  const btn = document.querySelector('#withdrawal-form button[type="submit"]');
  btn.disabled = true;

  const { data, error } = await sb.rpc('add_withdrawal_request', { p_request: request });

  btn.disabled = false;

  if (error) {
    showToast(error.message, 'error');
    return;
  }

  const newBalance = data?.new_balance != null ? Number(data.new_balance) : balance - Number(amount);
  currentProfile.balance = newBalance;
  document.getElementById('balance-display').textContent = formatUsd(newBalance);

  document.getElementById('withdrawal-modal')?.classList.remove('open');
  document.getElementById('withdrawal-success-modal')?.classList.add('open');
  showToast(`Withdrawal sent — new balance ${formatUsd(newBalance)}`, 'success');
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

  const { error: uploadErr } = await sb.storage.from('receipts').upload(path, selectedReceiptFile);

  btn.disabled = false;
  btn.textContent = 'Upload receipt';

  if (uploadErr) {
    showToast(uploadErr.message, 'error');
    return;
  }

  const { data: urlData } = sb.storage.from('receipts').getPublicUrl(path);
  const { error: rpcErr } = await sb.rpc('add_user_receipt', {
    p_url: urlData.publicUrl,
    p_file_name: selectedReceiptFile.name,
  });

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
}

async function fetchEligibleLevel(userId) {
  const { data, error } = await sb.rpc('calculate_eligible_level', { user_id: userId });
  return error ? '—' : (data ?? 1);
}

function renderLevelProgress(container, profile, signups) {
  if (!container) return;
  const team = Number(profile.team_profit_accumulation_ngn ?? profile.team_accumulation) || 0;
  container.innerHTML = `
    <li>Referral signups: <strong>${signups}</strong> (need 3+ for Level 2)</li>
    <li>Team profit: <strong>${formatNgn(team)}</strong> (≈ ${formatUsd(ngnToUsd(team))})</li>
    <li>Your level: <strong>Level ${profile.level}</strong></li>
    <li>Eligible level: <strong>Level ${document.getElementById('eligible-level')?.textContent || profile.level}</strong></li>
  `;
}

function openProfileModal() {
  if (!currentProfile) return;
  document.getElementById('edit-full-name').value = currentProfile.full_name || '';
  document.getElementById('edit-phone').value = currentProfile.phone || '';
  document.getElementById('edit-email').value = currentProfile.email || '';
  document.getElementById('profile-modal')?.classList.add('open');
}
