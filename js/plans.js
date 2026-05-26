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
  { level: 1, title: 'Level 1 — Starter', desc: 'Open to everyone. Start investing immediately.' },
  {
    level: 2,
    title: 'Level 2 — Builder',
    desc: 'Refer at least 3 people using your code, with ₦100,000 team accumulation from their investments.',
  },
  {
    level: 3,
    title: 'Level 3 — Director',
    desc: '2 active Level 2 members, 5 active Level 1 members, and ₦1,000,000 team accumulation via your referral code.',
  },
  {
    level: 4,
    title: 'Level 4 — Elite',
    desc: '2 active Level 3 members, 1 active Level 2 member, 10 active Level 1 members, and ₦2,000,000 team accumulation.',
  },
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

function renderPlanCards(container, userLevel) {
  if (!container) return;
  const plans = INVESTMENT_PLANS[userLevel] || INVESTMENT_PLANS[1];
  const locked = (lvl) => lvl > userLevel;

  container.innerHTML = plans
    .map(
      (p) => `
    <article class="plan-card ${locked(userLevel) ? '' : ''}">
      <div class="plan-days">${p.days} Days</div>
      <div class="plan-rate">${p.daily}% <span>daily</span></div>
      <ul class="plan-limits">
        <li>Min: ${formatNgnWithUsd(p.minNgn)}</li>
        <li>Max: ${formatNgnWithUsd(p.maxNgn)}</li>
      </ul>
    </article>
  `,
    )
    .join('');
}

function renderAllLevelsOverview(container, userLevel) {
  if (!container) return;
  container.innerHTML = [1, 2, 3, 4]
    .map((lvl) => {
      const req = LEVEL_REQUIREMENTS.find((r) => r.level === lvl);
      const isCurrent = lvl === userLevel;
      const isLocked = lvl > userLevel;
      const plans = INVESTMENT_PLANS[lvl];
      return `
        <section class="level-block ${isCurrent ? 'level-current' : ''} ${isLocked ? 'level-locked' : ''}">
          <header>
            <h3>${req.title} ${isCurrent ? '<span class="badge">Your level</span>' : ''} ${isLocked ? '<span class="badge badge-muted">Locked</span>' : ''}</h3>
            <p>${req.desc}</p>
          </header>
          <div class="plans-grid plans-grid-sm">
            ${plans
              .map(
                (p) => `
              <div class="plan-mini">
                <strong>${p.days}d</strong> · ${p.daily}%/day<br>
                <small>${formatNgnWithUsd(p.minNgn)} – ${formatNgnWithUsd(p.maxNgn)}</small>
              </div>
            `,
              )
              .join('')}
          </div>
        </section>
      `;
    })
    .join('');
}
