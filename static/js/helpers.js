/* ===== helpers.js — Utility functions ===== */

// Escapes user-controlled text (task titles/descriptions, update messages,
// member names/emails, etc.) before it's interpolated into innerHTML.
// Without this, any employee could type e.g. an update message containing
// "<img src=x onerror=...>" and have it execute in every viewer's browser
// (Dashboard, Activity, Tasks, Team pages all render server data via innerHTML).
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function toast(msg, type = 'info') {
  const icons  = { success: 'ti-check-circle', error: 'ti-alert-circle', info: 'ti-info-circle' };
  const colors = { success: '#22c55e',          error: '#ef4444',          info: '#4f8ef7' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="ti ${icons[type]}" style="color:${colors[type]};font-size:18px"></i><span>${escapeHtml(msg)}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.style.animation = 'slideOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

function getInitials(name) {
  return (name || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// SQLite's CURRENT_TIMESTAMP produces "YYYY-MM-DD HH:MM:SS" in UTC but with
// no timezone marker. Browsers parse that space-separated form as *local*
// time (not UTC), which silently shifts every timestamp by the viewer's UTC
// offset — e.g. in IST (+5:30) a task assigned seconds ago shows as "5h ago".
// Normalize to a proper ISO-8601 UTC string before handing it to Date().
function _parseServerDate(d) {
  if (!d) return null;

  if (d instanceof Date) return d;

  const s = String(d).trim();

  // First try native parsing (works for RFC2822 and ISO8601)
  let dt = new Date(s);
  if (!isNaN(dt.getTime())) return dt;

  // Fallback only for old SQLite timestamps:
  // YYYY-MM-DD HH:MM:SS
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    dt = new Date(s.replace(" ", "T") + "Z");
    if (!isNaN(dt.getTime())) return dt;
  }

  return null;
}
function formatDate(d) {
  const dt = _parseServerDate(d);
  if (!dt) return "Invalid Date";

  return dt.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

function formatDateTime(d) {
  const dt = _parseServerDate(d);
  if (!dt) return '—';

  return dt.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function timeAgo(d) {
  const dt = _parseServerDate(d);
  if (!dt) return "";

  const diff = Date.now() - dt.getTime();

  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;

  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;

  return `${Math.floor(hrs / 24)}d ago`;
}

function statusBadge(s) {
  const map    = { pending: 'badge-pending', in_progress: 'badge-active', completed: 'badge-done', overdue: 'badge-overdue' };
  const labels = { pending: 'Pending',       in_progress: 'In Progress',  completed: 'Completed',  overdue: 'Overdue' };
  return `<span class="badge ${map[s] || 'badge-pending'}">${labels[s] || s}</span>`;
}

function priorityDot(p) {
  return `<span class="priority-dot p-${p}"></span>${p.charAt(0).toUpperCase() + p.slice(1)}`;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  let data = {};
  try {
    data = await res.json();
  } catch (_) {}

  // User session expired / password changed / account removed
  if (res.status === 401) {
    currentUser = null;

    document.getElementById('app').style.display = 'none';
    document.getElementById('login-page').style.display = 'flex';

    document.getElementById('login-password').value = '';

    toast(data.error || 'Your session has expired. Please log in again.', 'error');

    throw new Error(data.error || 'Unauthorized');
  }

  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}
