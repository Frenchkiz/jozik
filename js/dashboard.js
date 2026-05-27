let currentProfile = null;

const WHATSAPP_WA = '447365596265';

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
    sendWithdrawalToWhatsApp();
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

  const { data: profile, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error || !profile) {
    if (main) {
      main.innerHTML =
        '<p class="loading">Unable to load profile. Ensure you ran supabase/schema.sql.</p>';
    }
    return;
  }

  currentProfile = profile;
  profile.email = profile.email || user.email;

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
      <div id="investment-plans-panel" class="investment-plans-panel" hidden>
        <section>
          <h2 class="section-title">Your active plans — Level ${profile.level}</h2>
          <p class="section-sub">Rates shown are daily returns on profit. Deposit limits include USD at ₦${NGN_PER_USD}/$1.</p>
          <div id="active-plans" class="plans-grid"></div>
        </section>

        <section class="section">
          <h2 class="section-title">All investment levels</h2>
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

    renderPlanCards(document.getElementById('active-plans'), profile.level);
    renderAllLevelsOverview(document.getElementById('all-levels'), profile.level);
    renderLevelProgress(document.getElementById('level-progress'), profile, signups);
  }
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
  document.getElementById('wd-full-name').value = currentProfile.full_name || '';
  document.getElementById('wd-email').value = currentProfile.email || '';
  document.getElementById('wd-referral-code').value = currentProfile.referral_code || '';
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

function sendWithdrawalToWhatsApp() {
  if (!currentProfile) return;

  const amount = document.getElementById('wd-amount').value.trim();
  const method = document.getElementById('withdrawal-method').value;

  if (!amount || Number(amount) <= 0) {
    showToast('Enter a valid withdrawal amount', 'error');
    return;
  }

  let payoutDetails = '';
  if (method === 'bank') {
    const bankName = document.getElementById('wd-bank-name').value.trim();
    const accountNumber = document.getElementById('wd-account-number').value.trim();
    const accountName = document.getElementById('wd-account-name').value.trim();
    if (!bankName || !accountNumber || !accountName) {
      showToast('Fill in all bank details', 'error');
      return;
    }
    payoutDetails = `Bank: ${bankName}\nAccount Number: ${accountNumber}\nAccount Name: ${accountName}`;
  } else {
    const cryptoType = document.getElementById('wd-crypto-type').value;
    const wallet = document.getElementById('wd-wallet').value.trim();
    if (!wallet) {
      showToast('Enter your crypto wallet address', 'error');
      return;
    }
    payoutDetails = `Crypto: ${cryptoType}\nWallet Address: ${wallet}`;
  }

  const message = [
    '*JOZIK CAPITAL — WITHDRAWAL REQUEST*',
    '',
    `Full Name: ${currentProfile.full_name || ''}`,
    `Email: ${currentProfile.email || ''}`,
    `Referral Code: ${currentProfile.referral_code || ''}`,
    `Amount: ${amount}`,
    `Method: ${method === 'bank' ? 'Bank Account' : 'Crypto'}`,
    '',
    payoutDetails,
    '',
    `Sent from dashboard at ${new Date().toLocaleString()}`,
  ].join('\n');

  const url = `https://wa.me/${WHATSAPP_WA}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
  document.getElementById('withdrawal-modal')?.classList.remove('open');
  showToast('Opening WhatsApp with your withdrawal request…', 'success');
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
    <li>Referral signups: <strong>${signups}</strong> (need 3+ for Level 2)</li>
    <li>Team accumulation: <strong>${formatNgn(team)}</strong></li>
    <li>Eligible level from activity: <strong>Level ${document.getElementById('eligible-level')?.textContent || '—'}</strong></li>
    <li>Your assigned level: <strong>Level ${profile.level}</strong></li>
  `;
}

function openProfileModal() {
  if (!currentProfile) return;
  document.getElementById('edit-full-name').value = currentProfile.full_name || '';
  document.getElementById('edit-phone').value = currentProfile.phone || '';
  document.getElementById('edit-email').value = currentProfile.email || '';
  document.getElementById('profile-modal')?.classList.add('open');
}
