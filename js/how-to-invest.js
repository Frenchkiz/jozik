(function initHowToInvest() {
  if (document.getElementById('how-to-invest-modal')) return;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'how-to-invest-modal';
  modal.innerHTML = `
    <div class="modal modal-lg">
      <button type="button" class="modal-close" data-close-modal>&times;</button>
      <h2>How to invest with Jozik Capital</h2>
      <div class="how-to-body">
        <section>
          <h3>1. Create your account</h3>
          <p>Sign up with your email, full name, and phone. You start at <strong>Level 1</strong> and receive a unique referral code.</p>
        </section>
        <section>
          <h3>2. Fund your dashboard</h3>
          <p>Click <strong>Deposit</strong>, transfer to our bank or crypto details, then <strong>upload your receipt</strong>. Balance updates after confirmation (up to 30 mins, or email <a href="mailto:support@jozik.co.uk">support@jozik.co.uk</a> for faster crediting).</p>
        </section>
        <section>
          <h3>3. Choose a plan</h3>
          <p>Click <strong>Plans</strong> in the menu. All levels are open. Tap any plan card to invest. Limits are shown in Naira with USD at ₦${typeof NGN_PER_USD !== 'undefined' ? NGN_PER_USD : 1400}/$1.</p>
        </section>
        <section>
          <h3>4. Confirm & invest</h3>
          <p>Review the plan popup, click <strong>Yes, invest</strong>, enter your amount (within your balance and plan limits). Your investment amount is <strong>locked</strong> until maturity.</p>
        </section>
        <section>
          <h3>5. Daily profit (automatic)</h3>
          <p>Each day, <strong>daily profit</strong> is credited to your dashboard balance (processed when you log in after 12:01 AM). Only the invested capital stays locked until the plan ends.</p>
        </section>
        <section>
          <h3>6. Maturity</h3>
          <p>When your plan completes, your <strong>original capital</strong> returns to your balance automatically. You can withdraw or reinvest.</p>
        </section>
        <section>
          <h3>7. Referral bonuses</h3>
          <p>Earn from your team's daily profit: <strong>8%</strong> 1st generation · <strong>2%</strong> 2nd · <strong>0.5%</strong> 3rd — credited automatically.</p>
        </section>
        <section>
          <h3>8. Level upgrades</h3>
          <ul>
            <li><strong>Level 2:</strong> 3+ referrals, ₦100k team profit (≈ $71)</li>
            <li><strong>Level 3:</strong> 2 active L2 + 5 active L1, ₦1M team profit (≈ $714)</li>
            <li><strong>Level 4:</strong> 2 active L3 + 1 L2 + 10 L1, ₦2M team profit (≈ $1,429)</li>
          </ul>
        </section>
        <section>
          <h3>9. Monthly salary (Level 2+)</h3>
          <p>Automatic salary based on team monthly profit: ₦1M → ₦20,000 · ₦2M → ₦50,000 · ₦5M → ₦100,000 (shown in USD on dashboard at ₦1,400/$1).</p>
        </section>
        <section>
          <h3>10. Withdraw</h3>
          <p>Click <strong>Withdrawal</strong>, enter amount (within balance), choose bank or crypto, and send. Amount is deducted from your balance immediately.</p>
        </section>
      </div>
      <button type="button" class="btn btn-primary btn-block" data-close-modal>Got it</button>
    </div>
  `;
  document.body.appendChild(modal);

  document.querySelectorAll('[data-how-to-invest]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      modal.classList.add('open');
    });
  });

  modal.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => modal.classList.remove('open'));
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });
})();
