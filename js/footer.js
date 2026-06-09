(function initSiteFooter() {
  if (document.querySelector('.site-footer')) return;

  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `
    <p>&copy; <span class="footer-year"></span> Jozik Capital. All rights reserved.</p>
    <p class="footer-contact">Contact: <a href="mailto:support@jozik.co.uk">support@jozik.co.uk</a></p>
  `;
  document.body.appendChild(footer);

  const yearEl = footer.querySelector('.footer-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
})();
