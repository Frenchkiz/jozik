const REFERRAL_BONUS = {
  gen1: 8,
  gen2: 2,
  gen3: 0.5,
};

const LEVEL_REQUIREMENTS = [
  { level: 1, title: 'Level 1 — Starter', desc: 'Everyone starts at Level 1 when they sign up.' },
  {
    level: 2,
    title: 'Level 2 — Builder',
    desc: 'Refer 3+ people whose combined profit reaches ₦100,000 (≈ $71.43).',
  },
  {
    level: 3,
    title: 'Level 3 — Director',
    desc: '2 active Level 2 members, 5 active Level 1 members, ₦1M team profit (≈ $714.29).',
  },
  {
    level: 4,
    title: 'Level 4 — Elite',
    desc: '2 active Level 3, 1 active Level 2, 10 active Level 1, ₦2M team profit (≈ $1,428.57).',
  },
];

const MONTHLY_SALARY_TIERS = [
  { minNgn: 1000000, salaryNgn: 20000, salaryUsd: ngnToUsd(20000) },
  { minNgn: 2000000, salaryNgn: 50000, salaryUsd: ngnToUsd(50000) },
  { minNgn: 5000000, salaryNgn: 100000, salaryUsd: ngnToUsd(100000) },
];

const INVESTMENT_PLANS = {
  1: [
    { days: 8, daily: 2.0, minNgn: 5000, maxNgn: 1000000 },
    { days: 16, daily: 2.3, minNgn: 5000, maxNgn: 1000000 },
    { days: 31, daily: 2.8, minNgn: 5000, maxNgn: 1000000 },
    { days: 60, daily: 3.0, minNgn: 5000, maxNgn: 1000000 },
    { days: 90, daily: 3.2, minNgn: 5000, maxNgn: 1000000 },
  ],
  2: [
    { days: 8, daily: 2.3, minNgn: 50000, maxNgn: 3000000 },
    { days: 16, daily: 2.5, minNgn: 50000, maxNgn: 3000000 },
    { days: 31, daily: 3.0, minNgn: 50000, maxNgn: 3000000 },
    { days: 60, daily: 3.3, minNgn: 50000, maxNgn: 3000000 },
    { days: 90, daily: 3.6, minNgn: 50000, maxNgn: 3000000 },
  ],
  3: [
    { days: 8, daily: 2.5, minNgn: 100000, maxNgn: 5000000 },
    { days: 16, daily: 2.8, minNgn: 100000, maxNgn: 5000000 },
    { days: 31, daily: 3.3, minNgn: 100000, maxNgn: 5000000 },
    { days: 60, daily: 3.6, minNgn: 100000, maxNgn: 5000000 },
    { days: 90, daily: 4.0, minNgn: 100000, maxNgn: 5000000 },
  ],
  4: [
    { days: 8, daily: 3.0, minNgn: 100000, maxNgn: 20000000 },
    { days: 16, daily: 3.3, minNgn: 100000, maxNgn: 20000000 },
    { days: 31, daily: 3.7, minNgn: 100000, maxNgn: 20000000 },
    { days: 60, daily: 4.1, minNgn: 100000, maxNgn: 20000000 },
    { days: 90, daily: 4.4, minNgn: 100000, maxNgn: 20000000 },
  ],
};

function planMinUsd(plan) {
  return Number(plan.minNgn) / NGN_PER_USD;
}

function planMaxUsd(plan) {
  return Number(plan.maxNgn) / NGN_PER_USD;
}

function calcDailyProfit(amountUsd, dailyRate) {
  return Number(amountUsd) * (Number(dailyRate) / 100);
}

function calcExpectedProfit(amountUsd, dailyRate, days) {
  return calcDailyProfit(amountUsd, dailyRate) * Number(days);
}

function planCardHtml(level, plan, extraClass = '') {
  return `
    <article
      class="plan-card plan-selectable ${extraClass}"
      role="button"
      tabindex="0"
      data-level="${level}"
      data-days="${plan.days}"
      data-daily="${plan.daily}"
      data-min-ngn="${plan.minNgn}"
      data-max-ngn="${plan.maxNgn}"
    >
      <div class="plan-level-tag">Level ${level}</div>
      <div class="plan-days">${plan.days} Days</div>
      <div class="plan-rate">${plan.daily}% <span>daily</span></div>
      <ul class="plan-limits">
        <li>Min: ${formatNgnWithUsd(plan.minNgn)}</li>
        <li>Max: ${formatNgnWithUsd(plan.maxNgn)}</li>
      </ul>
      <span class="plan-tap-hint">Tap to invest</span>
    </article>
  `;
}

function renderAllLevelsOverview(container) {
  if (!container) return;
  container.innerHTML = [1, 2, 3, 4]
    .map((lvl) => {
      const req = LEVEL_REQUIREMENTS.find((r) => r.level === lvl);
      const plans = INVESTMENT_PLANS[lvl];
      return `
        <section class="level-block">
          <header>
            <h3>${req.title}</h3>
            <p>${req.desc}</p>
          </header>
          <div class="plans-grid plans-grid-sm">
            ${plans.map((p) => planCardHtml(lvl, p, 'plan-card-sm')).join('')}
          </div>
        </section>
      `;
    })
    .join('');
}

function getPlanFromElement(el) {
  if (!el) return null;
  return {
    level: Number(el.dataset.level),
    days: Number(el.dataset.days),
    daily: Number(el.dataset.daily),
    minNgn: Number(el.dataset.minNgn),
    maxNgn: Number(el.dataset.maxNgn),
  };
}

function getSalaryTierText(profile) {
  if (profile.level < 2) {
    return 'Reach Level 2 to qualify for automatic monthly salary.';
  }
  return `Level 2+ salary tiers (team monthly profit): ₦1M → ${formatNgnWithUsd(20000)} · ₦2M → ${formatNgnWithUsd(50000)} · ₦5M → ${formatNgnWithUsd(100000)}`;
}

function getReferralBonusText() {
  return `${REFERRAL_BONUS.gen1}% 1st gen · ${REFERRAL_BONUS.gen2}% 2nd gen · ${REFERRAL_BONUS.gen3}% 3rd gen (of team daily profit)`;
}
