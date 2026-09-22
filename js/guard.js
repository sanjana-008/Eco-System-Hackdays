(async () => {
  try {
    const res = await fetch('/api/auth/session', { method: 'POST', credentials: 'same-origin' });
    if (!res.ok) {
      window.location.replace('login.html');
    }
  } catch {
    window.location.replace('login.html');
  }
})();
