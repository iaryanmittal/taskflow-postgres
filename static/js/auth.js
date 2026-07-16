/* ===== auth.js — Login / logout via Flask API (email-based) ===== */
'use strict';

let currentUser = null;

async function doLogin() {
  const email    = document.getElementById('login-email').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  errEl.style.display = 'none';

  if (!email || !password) {
    errEl.textContent = 'Please enter your email and password.';
    errEl.style.display = 'block';
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errEl.textContent = 'Please enter a valid email address.';
    errEl.style.display = 'block';
    return;
  }

  try {
    const user = await api('/api/login', { method: 'POST', body: { email, password } });
    currentUser = user;
    onLoginSuccess(user);
  } catch (e) {
    errEl.textContent = e.message || 'Login failed.';
    errEl.style.display = 'block';
  }
}

function onLoginSuccess(user) {
  document.getElementById('sidebar-name').textContent   = user.name;
  document.getElementById('sidebar-role').textContent   = user.role === 'admin' ? 'Administrator' : 'Team Member';
  document.getElementById('sidebar-avatar').textContent = user.initials;
  document.getElementById('sidebar-avatar').style.background = user.color || '#6366f1';

  if (user.role === 'admin') {
    document.getElementById('nav-admin').style.display = 'block';
    document.getElementById('nav-user').style.display  = 'none';
    document.getElementById('btn-assign-task').style.display = '';
  } else {
    document.getElementById('nav-admin').style.display = 'none';
    document.getElementById('nav-user').style.display  = 'block';
    document.getElementById('btn-assign-task').style.display = 'none';
  }

  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app').style.display        = 'flex';

  showPage('dashboard');
  toast(`Welcome back, ${user.name}!`, 'success');
}

async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch (_) {}
  currentUser = null;
  document.getElementById('app').style.display        = 'none';
  document.getElementById('login-page').style.display = 'flex';
  document.getElementById('login-email').value    = '';
  document.getElementById('login-password').value = '';
}

// Auto-restore session on page load
(async function checkSession() {
  try {
    const user = await api('/api/me');
    currentUser = user;
    onLoginSuccess(user);
  } catch (_) {
    // not logged in — show login page (already visible)
  }
})();
