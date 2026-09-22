import { loginWithEmail, sendOtpToBackend } from './auth.js';

const form = document.getElementById('login-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const errorEl = document.getElementById('login-error');
const successEl = document.getElementById('login-success');
const btn = document.getElementById('btn-continue');
const btnText = btn.querySelector('.btn-text');
const btnLoader = btn.querySelector('.btn-loader');

const params = new URLSearchParams(window.location.search);
const prefilledEmail = params.get('email');
if (prefilledEmail) {
  emailInput.value = prefilledEmail;
  passwordInput.focus();
} else {
  emailInput.focus();
}

function setLoading(loading) {
  btn.disabled = loading;
  btnText.hidden = loading;
  btnLoader.hidden = !loading;
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

function hideError() {
  errorEl.hidden = true;
  errorEl.textContent = '';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();
  setLoading(true);

  try {
    const user = await loginWithEmail(emailInput.value.trim(), passwordInput.value);
    await sendOtpToBackend(user);
    window.location.href = `otp.html?email=${encodeURIComponent(user.email)}`;
  } catch (err) {
    setLoading(false);
    showError(err.message || 'Login failed. Please check your credentials and try again.');
  }
});
