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
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s);              // date-only: spec-parsed as UTC already
  if (/[Zz]|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);            // already has an explicit offset
  return new Date(s.replace(' ', 'T') + 'Z');                         // "YYYY-MM-DD HH:MM:SS" -> UTC
}

function formatDate(d) {
  if (!d) return '—';
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(d).trim());
  const opts = { day: 'numeric', month: 'short' };
  // Date-only values (due dates) have no time-of-day to localize — format
  // them in UTC so the calendar day shown never shifts with the viewer's
  // timezone (was showing one day early for anyone west of UTC).
  if (isDateOnly) opts.timeZone = 'UTC';
  return _parseServerDate(d).toLocaleDateString('en-IN', opts);
}

function formatDateTime(d) {
  if (!d) return '—';
  const dt = _parseServerDate(d);
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(d) {
  if (!d) return '';
  const diff = Date.now() - _parseServerDate(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
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
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
