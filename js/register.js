import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from './auth.js';

const form = document.getElementById('register-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const confirmInput = document.getElementById('confirm-password');
const errorEl = document.getElementById('register-error');
const successEl = document.getElementById('register-success');
const btn = document.getElementById('btn-signup');
const btnText = btn.querySelector('.btn-text');
const btnLoader = btn.querySelector('.btn-loader');

function setLoading(loading) {
  btn.disabled = loading;
  btnText.hidden = loading;
  btnLoader.hidden = !loading;
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
  successEl.hidden = true;
}

function showSuccess(msg) {
  successEl.textContent = msg;
  successEl.hidden = false;
  errorEl.hidden = true;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.hidden = true;
  successEl.hidden = true;

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const confirm = confirmInput.value;

  if (password !== confirm) {
    showError('Passwords do not match.');
    return;
  }

  if (password.length < 6) {
    showError('Password must be at least 6 characters.');
    return;
  }

  setLoading(true);

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    showSuccess('Account created! Redirecting to login...');
    setTimeout(() => {
      window.location.href = `login.html?email=${encodeURIComponent(email)}`;
    }, 1500);
  } catch (err) {
    setLoading(false);
    showError(err.message || 'Sign up failed. Please try again.');
  }
});
