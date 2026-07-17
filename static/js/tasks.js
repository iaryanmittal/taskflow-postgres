/* ===== tasks.js — Task CRUD & modal interactions ===== */

let selectedTaskId = null;

// ── Filter chips ──────────────────────────────────────────────────────────

function filterTasks(f, el) {
  currentFilter = f;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderTasks();
}

// ── Search ────────────────────────────────────────────────────────────────

function searchTasks(q) {
  if (!q) { renderTasks(); return; }
  const list = TASKS.filter(t =>
    t.title.toLowerCase().includes(q.toLowerCase()) ||
    t.id.toLowerCase().includes(q.toLowerCase()) ||
    t.assignedTo.toLowerCase().includes(q.toLowerCase())
  );
  const isAdmin = currentUser?.role === 'admin';
  document.getElementById('tasks-tbody').innerHTML = list.length
    ? list.map(t => `
      <tr>
        <td style="font-size:11px;color:var(--text3);font-family:monospace">${t.id}</td>
        <td><div style="font-weight:500">${escapeHtml(t.title)}</div></td>
        <td>${escapeHtml(t.assignedTo)}</td>
        <td>${priorityDot(t.priority)}</td>
        <td>${statusBadge(t.status)}</td>
        <td style="color:var(--text3)">${formatDate(t.dueDate)}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="openDetail('${t.id}')"><i class="ti ti-eye"></i></button>
          ${isAdmin ? `<button class="btn btn-danger btn-sm" onclick="deleteTask('${t.id}')"><i class="ti ti-trash"></i></button>` : ''}
        </td>
      </tr>`).join('')
    : '<tr><td colspan="7" class="empty-state">No results</td></tr>';
}

// ── Assign Task ───────────────────────────────────────────────────────────

async function openAssignModal() {
  if (currentUser?.role !== 'admin') { toast('Only admins can assign tasks', 'error'); return; }

  // Populate assignee dropdown with every team member except the acting admin.
  // Admins are tracked in performance too, so they're valid assignees.
  try {
    if (!USERS.length) USERS = await api('/api/users');
    const assignees = USERS.filter(u => u.id !== currentUser?.id);
    document.getElementById('task-assignee').innerHTML = assignees.map(u =>
      `<option value="${u.id}">${escapeHtml(u.name)}${u.role === 'admin' ? ' (Admin)' : ''}</option>`
    ).join('');
  } catch (e) { toast('Failed to load users', 'error'); return; }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 3);
  document.getElementById('task-due').value   = tomorrow.toISOString().split('T')[0];
  document.getElementById('task-title').value = '';
  document.getElementById('task-desc').value  = '';
  openModal('assign-modal');
}

console.log("assignTask called");
async function assignTask() {
  const title    = document.getElementById('task-title').value.trim();
  const desc     = document.getElementById('task-desc').value.trim();
  const assignee = document.getElementById('task-assignee').value;
  const priority = document.getElementById('task-priority').value;
  const due      = document.getElementById('task-due').value;
  const category = document.getElementById('task-category').value;

  if (!title) {
    toast('Please enter a task title', 'error');
    return;
  }

  const assignBtn = document.getElementById('assign-task-btn');

  // Prevent double click
  assignBtn.disabled = true;
  const originalHTML = assignBtn.innerHTML;
  assignBtn.innerHTML = '<i class="ti ti-loader-2"></i> Assigning...';

  try {
    const newTask = await api('/api/tasks', {
      method: 'POST',
      body: {
        title,
        description: desc,
        assignedTo: assignee,
        priority,
        dueDate: due,
        category
      }
    });

    TASKS.unshift(newTask);

    closeModal('assign-modal');

    toast(`Task assigned to ${newTask.assignedTo}! ✅`, 'success');

    document.getElementById('pending-badge').textContent =
      TASKS.filter(t => t.status === 'pending').length;

    if (document.getElementById('page-dashboard').classList.contains('active'))
      renderDashboard();

    if (document.getElementById('page-tasks').classList.contains('active'))
      renderTasks();

  } catch (e) {
    // Only re-enable if request failed
    assignBtn.disabled = false;
    assignBtn.innerHTML = originalHTML;

    toast(e.message || 'Failed to assign task', 'error');
  }
}// ── Delete Task ───────────────────────────────────────────────────────────

async function deleteTask(id) {
  if (currentUser?.role !== 'admin') { toast('Only admins can delete tasks', 'error'); return; }
  if (!confirm(`Delete ${id}? This cannot be undone.`)) return;

  try {
    await api(`/api/tasks/${id}`, { method: 'DELETE' });
    TASKS = TASKS.filter(t => t.id !== id);
    toast(`Task ${id} deleted`, 'info');
    renderTasks();
  } catch (e) {
    toast(e.message || 'Failed to delete task', 'error');
  }
}

// ── Update Task ───────────────────────────────────────────────────────────

function openUpdateModal(id) {
  selectedTaskId = id;
  const t = TASKS.find(x => x.id === id);
  if (!t) return;
  document.getElementById('update-modal-sub').textContent = `${t.id}: ${t.title}`;
  document.getElementById('update-status').value          = t.status;
  document.getElementById('update-message').value         = '';
  openModal('update-modal');
}

async function submitUpdate() {
  const status  = document.getElementById('update-status').value;
  const message = document.getElementById('update-message').value.trim();

  if (!message) { toast('Please add an update message', 'error'); return; }

  try {
    const result = await api(`/api/tasks/${selectedTaskId}/update`, {
      method: 'POST',
      body: { status, message }
    });

    // Update local cache
    const t = TASKS.find(x => x.id === selectedTaskId);
    if (t) {
      t.status = result.newStatus;
      t.updates.unshift({ by: currentUser.name, msg: message, time: new Date().toISOString() });
    }

    closeModal('update-modal');
    toast('Update submitted! ✅', 'success');
    renderTasks();
    if (document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();
  } catch (e) {
    toast(e.message || 'Failed to submit update', 'error');
  }
}

// ── Task Detail ───────────────────────────────────────────────────────────

function openDetail(id) {
  const t = TASKS.find(x => x.id === id);
  if (!t) return;

  document.getElementById('detail-content').innerHTML = `
    <div style="margin-bottom:20px">
      <div style="font-size:11px;color:var(--text3);font-family:monospace;margin-bottom:4px">${t.id} · ${escapeHtml(t.category || '')}</div>
      <div style="font-family:var(--font-head);font-size:22px;font-weight:700;margin-bottom:6px">${escapeHtml(t.title)}</div>
      <div style="color:var(--text2);font-size:13px">${escapeHtml(t.description || 'No description.')}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;font-size:13px">
      <div style="background:var(--bg3);border-radius:8px;padding:12px">
        <div style="color:var(--text3);font-size:11px;margin-bottom:4px">ASSIGNED TO</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="avatar" style="width:26px;height:26px;font-size:10px;background:${t.assigneeColor}">${escapeHtml(t.assigneeInitials)}</span>
          ${escapeHtml(t.assignedTo)}
        </div>
      </div>
      <div style="background:var(--bg3);border-radius:8px;padding:12px">
        <div style="color:var(--text3);font-size:11px;margin-bottom:4px">ASSIGNED BY</div>
        <div style="font-weight:500">${escapeHtml(t.assignedBy)}</div>
      </div>
      <div style="background:var(--bg3);border-radius:8px;padding:12px">
        <div style="color:var(--text3);font-size:11px;margin-bottom:4px">STATUS</div>
        ${statusBadge(t.status)}
      </div>
      <div style="background:var(--bg3);border-radius:8px;padding:12px">
        <div style="color:var(--text3);font-size:11px;margin-bottom:4px">PRIORITY</div>
        ${priorityDot(t.priority)}
      </div>
      <div style="background:var(--bg3);border-radius:8px;padding:12px">
        <div style="color:var(--text3);font-size:11px;margin-bottom:4px">DUE DATE</div>
        ${formatDate(t.dueDate)}
      </div>
      <div style="background:var(--bg3);border-radius:8px;padding:12px">
        <div style="color:var(--text3);font-size:11px;margin-bottom:4px">CREATED</div>
        ${formatDate(t.createdAt)}
      </div>
    </div>
    <div>
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:var(--text2)">
        Update History (${t.updates.length})
      </div>
      ${t.updates.length
        ? t.updates.map(upd => `
          <div style="background:var(--bg3);border-radius:8px;padding:12px;margin-bottom:8px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
              <span style="font-size:12px;font-weight:600">${escapeHtml(upd.by)}</span>
              <span style="font-size:11px;color:var(--text3)">${timeAgo(upd.time)}</span>
            </div>
            ${upd.newStatus ? `<div style="margin-bottom:4px">${statusBadge(upd.newStatus)}</div>` : ''}
            <div style="font-size:13px;color:var(--text2)">${escapeHtml(upd.msg)}</div>
          </div>`).join('')
        : '<div style="color:var(--text3);font-size:13px">No updates yet</div>'}
    </div>`;

  openModal('detail-modal');
}
