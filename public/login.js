(async function checkSetup() {
  try {
    const res = await fetch('/api/setup/status');
    const status = await res.json();
    if (status.setupRequired) window.location.href = '/setup.html';
  } catch (_) {}
})();

document.getElementById('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('errorMsg');
  const password = document.getElementById('password').value;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      window.location.href = '/';
      return;
    }
    if (data.setupRequired) {
      window.location.href = '/setup.html';
      return;
    }
    errorEl.textContent = data.message || 'Invalid password';
    errorEl.style.display = 'block';
    document.getElementById('password').value = '';
  } catch (err) {
    errorEl.textContent = 'Could not reach the server.';
    errorEl.style.display = 'block';
  }
};
