(function addGoldSpinner() {
  if (document.querySelector('.gold-spin-wrap')) return;
  const wrap = document.createElement('div');
  wrap.className = 'gold-spin-wrap';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = `
    <div class="gold-coin">
      <div class="gold-coin-face gold-coin-front">
        <span class="gold-coin-symbol">$</span>
      </div>
      <div class="gold-coin-face gold-coin-back">
        <span class="gold-coin-symbol">$</span>
      </div>
    </div>
  `;
  document.body.insertBefore(wrap, document.body.firstChild);
})();
