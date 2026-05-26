document.addEventListener('DOMContentLoaded', () => {
  const signupForm = document.getElementById('signup-form');
  const loginForm = document.getElementById('login-form');
  const resetForm = document.getElementById('reset-form');
  const resetModal = document.getElementById('reset-modal');

  if (document.body.dataset.authRedirect !== 'false') {
    redirectIfAuthed();
  }

  document.getElementById('open-reset')?.addEventListener('click', (e) => {
    e.preventDefault();
    resetModal?.classList.add('open');
  });

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.modal-overlay')?.classList.remove('open');
    });
  });

  resetModal?.addEventListener('click', (e) => {
    if (e.target === resetModal) resetModal.classList.remove('open');
  });

  signupForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = signupForm.querySelector('button[type="submit"]');
    btn.disabled = true;

    const fullName = signupForm.full_name.value.trim();
    const phone = signupForm.phone.value.trim();
    const email = signupForm.email.value.trim();
    const password = signupForm.password.value;
    const referralInput = signupForm.referral_code?.value.trim() || '';
    const terms = signupForm.terms?.checked;

    if (!terms) {
      showToast('You must accept the Terms & Conditions', 'error');
      btn.disabled = false;
      return;
    }

    if (referralInput) {
      const { data: valid } = await sb.rpc('validate_referral_code', {
        code: referralInput,
      });
      if (!valid) {
        showToast('Invalid referral code', 'error');
        btn.disabled = false;
        return;
      }
    }

    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          phone,
          referral_code_input: referralInput,
        },
      },
    });

    btn.disabled = false;

    if (error) {
      showToast(error.message, 'error');
      return;
    }

    if (data.session) {
      showToast('Welcome to Jozik Capital!', 'success');
      window.location.href = 'dashboard.html';
    } else {
      showToast('Check your email to confirm your account, then sign in.', 'success');
      window.location.href = 'login.html';
    }
  });

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = loginForm.querySelector('button[type="submit"]');
    btn.disabled = true;

    const { error } = await sb.auth.signInWithPassword({
      email: loginForm.email.value.trim(),
      password: loginForm.password.value,
    });

    btn.disabled = false;

    if (error) {
      showToast(error.message, 'error');
      return;
    }

    window.location.href = 'dashboard.html';
  });

  resetForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = resetForm.email.value.trim();
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login.html`,
    });

    if (error) {
      showToast(error.message, 'error');
      return;
    }

    showToast('Password reset link sent to your email', 'success');
    resetModal?.classList.remove('open');
  });
});
