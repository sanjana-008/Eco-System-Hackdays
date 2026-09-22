import { onAuthStateChanged } from 'firebase/auth';
import { auth, sendOtpToBackend, verifyOtpWithBackend } from './auth.js';

const form = document.getElementById('otp-form');
const digits = Array.from(document.querySelectorAll('.otp-digit'));
const errorEl = document.getElementById('otp-error');
const btnVerify = document.getElementById('btn-verify');
const btnResend = document.getElementById('btn-resend');
const countdownEl = document.getElementById('countdown');
const emailDisplay = document.getElementById('email-display');

const params = new URLSearchParams(window.location.search);
const email = params.get('email');

if (!email) {
  window.location.href = 'login.html';
}

emailDisplay.textContent = email;

let currentUser = null;
let resendTimer = null;
let remainingSeconds = 300; // 5 minutes

function setLoading(btn, loading) {
  const text = btn.querySelector('.btn-text');
  const loader = btn.querySelector('.btn-loader');
  btn.disabled = loading;
  if (text) text.hidden = loading;
  if (loader) loader.hidden = !loading;
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

function hideError() {
  errorEl.hidden = true;
  errorEl.textContent = '';
}

function getCode() {
  return digits.map(d => d.value).join('');
}

function clearDigits() {
  digits.forEach(d => (d.value = ''));
  digits[0].focus();
}

function startCountdown() {
  remainingSeconds = 300;
  btnResend.disabled = true;
  updateCountdown();
  if (resendTimer) clearInterval(resendTimer);
  resendTimer = setInterval(() => {
    remainingSeconds--;
    updateCountdown();
    if (remainingSeconds <= 0) {
      clearInterval(resendTimer);
      btnResend.disabled = false;
      countdownEl.textContent = 'You can resend the code now';
    }
  }, 1000);
}

function updateCountdown() {
  const m = Math.floor(remainingSeconds / 60).toString().padStart(2, '0');
  const s = (remainingSeconds % 60).toString().padStart(2, '0');
  countdownEl.textContent = `Resend available in ${m}:${s}`;
}

// OTP input behavior
digits.forEach((input, index) => {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !input.value && index > 0) {
      digits[index - 1].focus();
    }
  });

  input.addEventListener('input', (e) => {
    hideError();
    const val = input.value.replace(/\D/g, '');
    input.value = val.slice(0, 1);
    if (val && index < digits.length - 1) {
      digits[index + 1].focus();
    }
    if (index === digits.length - 1 && val) {
      btnVerify.focus();
    }
  });

  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    text.split('').forEach((char, i) => {
      if (digits[i]) digits[i].value = char;
    });
    const next = digits[Math.min(text.length, digits.length - 1)];
    if (next) next.focus();
  });
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();
  const code = getCode();
  if (code.length !== 6 || !/^\d{6}$/.test(code)) {
    showError('Please enter the complete 6-digit code.');
    return;
  }
  setLoading(btnVerify, true);

  try {
    await verifyOtpWithBackend(email, code);
    window.location.href = 'index.html';
  } catch (err) {
    setLoading(btnVerify, false);
    showError(err.message || 'Verification failed. Please try again.');
    clearDigits();
  }
});

btnResend.addEventListener('click', async () => {
  hideError();
  if (!currentUser) {
    showError('Session expired. Please log in again.');
    setTimeout(() => (window.location.href = 'login.html'), 1200);
    return;
  }
  setLoading(btnResend, true);
  try {
    await sendOtpToBackend(currentUser);
    startCountdown();
    clearDigits();
  } catch (err) {
    showError(err.message || 'Failed to resend code.');
  } finally {
    setLoading(btnResend, false);
  }
});

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  currentUser = user;
  startCountdown();
  digits[0].focus();
});
