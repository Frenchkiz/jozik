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

const LEVEL_REQUIREMENTS = [
  { level: 1, title: 'Level 1 — Starter', desc: 'Open to everyone.' },
  { level: 2, title: 'Level 2 — Builder', desc: 'Higher daily rates — open to all investors.' },
  { level: 3, title: 'Level 3 — Director', desc: 'Premium plans — open to all investors.' },
  { level: 4, title: 'Level 4 — Elite', desc: 'Highest returns — open to all investors.' },
];

const MONTHLY_SALARY_TIERS = [
  { minNgn: 1000000, salaryNgn: 20000 },
  { minNgn: 2000000, salaryNgn: 50000 },
  { minNgn: 5000000, salaryNgn: 100000 },
];

const REFERRAL_BONUS = {
  belowLevel2: { gen1: 8, gen2: 3, gen3: 1 },
  level2Plus: { gen1: 10, gen2: 4, gen3: 2 },
};

function planMinUsd(plan) {
  return Number(plan.minNgn) / NGN_PER_USD;
}

function planMaxUsd(plan) {
  return Number(plan.maxNgn) / NGN_PER_USD;
}

function calcExpectedProfit(amountUsd, dailyRate, days) {
  return Number(amountUsd) * (Number(dailyRate) / 100) * Number(days);
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
      aria-label="Level ${level} — ${plan.days} day plan at ${plan.daily}% daily"
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

function renderPlanCards(container, userLevel) {
  if (!container) return;
  const plans = INVESTMENT_PLANS[userLevel] || INVESTMENT_PLANS[1];
  container.innerHTML = plans.map((p) => planCardHtml(userLevel, p)).join('');
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
