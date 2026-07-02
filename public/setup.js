(async function () {
  const form = document.getElementById('setupForm');
  const errorEl = document.getElementById('errorMsg');
  let minLength = 10;

  function showError(message) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }

  try {
    const res = await fetch('/api/setup/status');
    const status = await res.json();
    minLength = status.minLength || minLength;
    if (!status.setupRequired) window.location.href = '/login.html';
  } catch (_) {
    showError('Could not reach the server.');
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    errorEl.style.display = 'none';
    const password = document.getElementById('password').value;
    const confirm = document.getElementById('confirmPassword').value;
    if (password !== confirm) return showError('Passwords do not match.');
    if (password.length < minLength) return showError(`Password must be at least ${minLength} characters.`);

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        window.location.href = '/';
        return;
      }
      showError(data.message || 'Setup failed.');
    } catch (_) {
      showError('Could not reach the server.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Finish Setup';
    }
  };
})();
