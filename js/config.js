const SUPABASE_URL = 'https://vtvxcqugigtznzkfoevm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ITiisSNtUG-IXletP-Fl_Q_7lkgkrcV';
const NGN_PER_USD = 1400;
const WHATSAPP_RECEIPT = '+447365596265';
const WITHDRAWAL_FEE_NGN = 1250;
const CRYPTO_WITHDRAWAL_PERCENT = 10;
const NAIRA_WITHDRAWAL_PERCENT = 5;
const MIN_WITHDRAWAL_NGN = 5000;

// CDN exposes global `supabase` (the library). Client instance uses a different name.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function ngnToUsd(ngn) {
  return (Number(ngn) / NGN_PER_USD).toFixed(2);
}

function formatNgn(amount) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatUsd(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

function formatNgnWithUsd(ngn) {
  return `${formatNgn(ngn)} (≈ ${formatUsd(ngnToUsd(ngn))})`;
}

async function requireAuth(redirectTo = 'login.html') {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = redirectTo;
    return null;
  }
  return session;
}

async function redirectIfAuthed(target = 'dashboard.html') {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    window.location.href = target;
  }
}

function showToast(message, type = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `toast toast-${type} show`;
  setTimeout(() => el.classList.remove('show'), 3500);
}

async function copyText(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${label} copied to clipboard`, 'success');
  } catch {
    showToast('Copy failed — select and copy manually', 'error');
  }
}
