/* ===== render.js — Page rendering (fetches from Flask API) ===== */

let TASKS    = [];
let USERS    = [];
let ACTIVITY = [];
let STATS    = {};

// ── Dashboard ──────────────────────────────────────────────────────────────

async function renderDashboard() {
  await Promise.all([loadTasks(), loadStats(), loadActivity()]);

  const s = STATS;
  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card">
      <div class="stat-top">
        <div class="stat-icon" style="background:rgba(79,142,247,0.15);color:var(--accent)"><i class="ti ti-checklist"></i></div>
        <span class="stat-trend trend-neutral">Total</span>
      </div>
      <div class="stat-value">${s.total || 0}</div>
      <div class="stat-label">Total Tasks</div>
    </div>
    <div class="stat-card">
      <div class="stat-top">
        <div class="stat-icon" style="background:rgba(245,158,11,0.15);color:var(--amber)"><i class="ti ti-clock"></i></div>
        <span class="stat-trend trend-neutral">${s.pending || 0} pending</span>
      </div>
      <div class="stat-value">${s.active || 0}</div>
      <div class="stat-label">In Progress</div>
    </div>
    <div class="stat-card">
      <div class="stat-top">
        <div class="stat-icon" style="background:rgba(34,197,94,0.15);color:var(--green)"><i class="ti ti-circle-check"></i></div>
        <span class="stat-trend trend-up">Done</span>
      </div>
      <div class="stat-value">${s.done || 0}</div>
      <div class="stat-label">Completed</div>
    </div>
    <div class="stat-card">
      <div class="stat-top">
        <div class="stat-icon" style="background:rgba(239,68,68,0.15);color:var(--red)"><i class="ti ti-alert-triangle"></i></div>
        <span class="stat-trend" style="background:rgba(239,68,68,0.15);color:var(--red)">${s.overdue || 0}</span>
      </div>
      <div class="stat-value">${s.overdue || 0}</div>
      <div class="stat-label">Overdue</div>
    </div>`;

  // Pending badge
  document.getElementById('pending-badge').textContent = s.pending || 0;

  // Recent tasks
  // Recent tasks
const recent = globalSearchQuery
  ? TASKS.filter(t =>
      (t.title || '').toLowerCase().includes(globalSearchQuery) ||
      (t.description || '').toLowerCase().includes(globalSearchQuery) ||
      (t.id || '').toLowerCase().includes(globalSearchQuery) ||
      (t.assignedTo || '').toLowerCase().includes(globalSearchQuery)
    ).slice(0, 5)
  : TASKS.slice(0, 5);

document.getElementById('dash-task-tbody').innerHTML = recent.length
  ? recent.map(t => `
    <tr onclick="openDetail('${t.id}')" style="cursor:pointer">
      <td>
        <div style="font-weight:500;font-size:13px">${escapeHtml(t.title)}</div>
        <div style="font-size:11px;color:var(--text3)">${t.id}</div>
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="avatar" style="width:26px;height:26px;font-size:10px;background:${t.assigneeColor}">
            ${escapeHtml(t.assigneeInitials)}
          </span>
          ${escapeHtml(t.assignedTo)}
        </div>
      </td>
      <td>${priorityDot(t.priority)}</td>
      <td>${statusBadge(t.status)}</td>
      <td style="color:var(--text3)">${formatDate(t.dueDate)}</td>
    </tr>
  `).join('')
  : '<tr><td colspan="5" class="empty-state"><i class="ti ti-search-off"></i>No matching tasks</td></tr>';

  // Activity
  document.getElementById('dash-activity').innerHTML = ACTIVITY.slice(0, 5).map(a => `
    <div class="activity-item">
      <div class="activity-icon" style="background:${a.color};color:${a.iconColor}"><i class="ti ${a.icon}"></i></div>
      <div class="activity-body">
        <div class="activity-text">${a.text}</div>
        <div class="activity-meta">
          ${a.viaWa
            ? `<i class="ti ti-brand-whatsapp" style="color:var(--wa)"></i>via WhatsApp`
            : `<i class="ti ti-globe"></i>via Dashboard`}
          <span>·</span>${timeAgo(a.time)}
        </div>
      </div>
    </div>`).join('') || '<div style="color:var(--text3);font-size:13px;padding:10px">No activity yet</div>';
}

// ── Tasks ──────────────────────────────────────────────────────────────────

let currentFilter = 'all';

function getFilteredTasks() {
  const today = new Date().toISOString().split('T')[0];
  let list = TASKS;
  switch (currentFilter) {
    case 'pending':     return list.filter(t => t.status === 'pending');
    case 'in_progress': return list.filter(t => t.status === 'in_progress');
    case 'completed':   return list.filter(t => t.status === 'completed');
    case 'overdue':     return list.filter(t => t.status !== 'completed' && t.dueDate && t.dueDate < today);
    case 'high':        return list.filter(t => t.priority === 'high');
    default:            return list;
  }
}

async function renderTasks() {
  await loadTasks();
  const list = getFilteredTasks();
  const isAdmin = currentUser?.role === 'admin';
  document.getElementById('actions-th').textContent = isAdmin ? 'Actions' : 'Update';

  document.getElementById('tasks-tbody').innerHTML = list.length
    ? list.map(t => `
      <tr>
        <td style="font-size:11px;color:var(--text3);font-family:monospace">${t.id}</td>
        <td>
          <div style="font-weight:500">${escapeHtml(t.title)}</div>
          <div style="font-size:11px;color:var(--text3)">${escapeHtml((t.description||'').slice(0, 48))}…</div>
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="avatar" style="width:28px;height:28px;font-size:11px;background:${t.assigneeColor}">${escapeHtml(t.assigneeInitials)}</span>
            ${escapeHtml(t.assignedTo)}
          </div>
        </td>
        <td>${priorityDot(t.priority)}</td>
        <td>${statusBadge(t.status)}</td>
        <td style="color:var(--text3)">${formatDate(t.dueDate)}</td>
        <td>
          <div class="task-actions">
            <button class="btn btn-ghost btn-sm" onclick="openDetail('${t.id}')"><i class="ti ti-eye"></i></button>
            ${isAdmin
              ? `<button class="btn btn-ghost btn-sm" onclick="openUpdateModal('${t.id}')"><i class="ti ti-edit"></i></button>
                 <button class="btn btn-danger btn-sm" onclick="deleteTask('${t.id}')"><i class="ti ti-trash"></i></button>`
              : t.status !== 'completed'
                ? `<button class="btn btn-primary btn-sm" onclick="openUpdateModal('${t.id}')">Update</button>`
                : `<span style="color:var(--green);font-size:12px">✓ Done</span>`}
          </div>
        </td>
      </tr>`).join('')
    : '<tr><td colspan="7"><div class="empty-state"><i class="ti ti-inbox"></i><div>No tasks found</div></div></td></tr>';
}

// ── Users ──────────────────────────────────────────────────────────────────

async function renderUsers() {
  try {
    USERS = await api('/api/users');
  } catch (e) {
    toast('Failed to load users', 'error');
    return;
  }

  const users = globalSearchQuery
    ? USERS.filter(u =>
        (u.name || '').toLowerCase().includes(globalSearchQuery) ||
        (u.role || '').toLowerCase().includes(globalSearchQuery) ||
        (u.wa || '').toLowerCase().includes(globalSearchQuery)
      )
    : USERS;

  document.getElementById('users-grid').innerHTML = users.length
    ? users.map(u => `
      <div class="user-card-el">
        <div class="user-card-header">
          <div class="user-avatar-lg" style="background:${u.color}">
            ${escapeHtml(u.initials)}
          </div>

          <div>
            <div class="user-card-name">${escapeHtml(u.name)}</div>
            <div class="user-card-role">
              ${u.role === 'admin' ? 'Administrator' : 'Team Member'}
            </div>
            <div class="wa-num">
              <i class="ti ti-phone" style="color:var(--text3)"></i>
              ${escapeHtml(u.wa) || '—'}
            </div>
          </div>
        </div>

        <div class="progress-bar" style="margin-bottom:12px">
          <div class="progress-fill" style="width:${u.pct}%;background:${u.color}"></div>
        </div>

        <div class="user-card-stats">
          <div class="ustat">
            <div class="ustat-val">${u.taskCount}</div>
            <div class="ustat-lbl">Tasks</div>
          </div>

          <div class="ustat">
            <div class="ustat-val" style="color:var(--accent)">
              ${u.activeCount}
            </div>
            <div class="ustat-lbl">Active</div>
          </div>

          <div class="ustat">
            <div class="ustat-val" style="color:var(--green)">
              ${u.doneCount}
            </div>
            <div class="ustat-lbl">Done</div>
          </div>
        </div>
      </div>
    `).join('')
    : `
      <div class="empty-state">
        <i class="ti ti-search-off"></i>
        <div>No matching users found</div>
      </div>
    `;
}

// ── Activity ───────────────────────────────────────────────────────────────

async function renderActivity() {
  await loadActivity();

  const activity = globalSearchQuery
    ? ACTIVITY.filter(a =>
        (a.text || '').toLowerCase().includes(globalSearchQuery)
      )
    : ACTIVITY;

  document.getElementById('full-activity-list').innerHTML = activity.length
    ? activity.map(a => `
      <div class="activity-item">
        <div class="activity-icon" style="background:${a.color};color:${a.iconColor}">
          <i class="ti ${a.icon}"></i>
        </div>

        <div class="activity-body">
          <div class="activity-text">${a.text}</div>

          <div class="activity-meta">
            ${
              a.viaWa
                ? `<i class="ti ti-brand-whatsapp" style="color:var(--wa)"></i>via WhatsApp`
                : `<i class="ti ti-globe"></i>via Dashboard`
            }
          </div>
        </div>

        <div class="activity-time">${timeAgo(a.time)}</div>
      </div>
    `).join('')
    : '<div style="color:var(--text3);font-size:13px;padding:20px">No matching activity found</div>';
}
// ── Loaders ────────────────────────────────────────────────────────────────

async function loadTasks() {
  try { TASKS = await api('/api/tasks'); } catch (e) { toast('Failed to load tasks', 'error'); }
}

async function loadStats() {
  try { STATS = await api('/api/stats'); } catch (e) {}
}

async function loadActivity() {
  try { ACTIVITY = await api('/api/activity'); } catch (e) {}
}
