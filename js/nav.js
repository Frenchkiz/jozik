(function initMobileNav() {
  function setup() {
    const toggle = document.querySelector('.nav-toggle');
    const nav = document.querySelector('.site-nav');
    const overlay = document.querySelector('.nav-overlay');
    if (!toggle || !nav) return;

    function setOpen(open) {
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
      overlay?.classList.toggle('is-open', open);
      document.body.classList.toggle('nav-open', open);
      if (overlay) overlay.hidden = !open;
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }

    toggle.addEventListener('click', () => {
      setOpen(!nav.classList.contains('is-open'));
    });

    overlay?.addEventListener('click', () => setOpen(false));

    nav.querySelectorAll('a[href]').forEach((link) => {
      link.addEventListener('click', () => setOpen(false));
    });

    document.querySelectorAll('[data-nav-trigger]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById(el.getAttribute('data-nav-trigger'))?.click();
        setOpen(false);
      });
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 900) setOpen(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setOpen(false);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
