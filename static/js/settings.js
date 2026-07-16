/* ===== settings.js — Password management ===== */

async function renderSettings() {
  // Show/hide admin sections
  const isAdmin = currentUser?.role === 'admin';
  document.getElementById('admin-pw-section').style.display = isAdmin ? '' : 'none';
  document.getElementById('admin-team-section').style.display = isAdmin ? '' : 'none';

  // Clear own-password fields
  ['pw-current','pw-new','pw-confirm'].forEach(id => document.getElementById(id).value = '');

  if (isAdmin) {
    await renderAdminPwTable();
    await renderAdminTeamTable();
  }
}

// ── Change own password ────────────────────────────────────────────────────

async function changeMyPassword() {
  const current = document.getElementById('pw-current').value;
  const newPw   = document.getElementById('pw-new').value;
  const confirm = document.getElementById('pw-confirm').value;

  if (!current)        { toast('Enter your current password', 'error'); return; }
  if (newPw.length < 6){ toast('New password must be at least 6 characters', 'error'); return; }
  if (newPw !== confirm){ toast('New passwords do not match', 'error'); return; }

  try {
    await api('/api/change-password', {
      method: 'POST',
      body: { currentPassword: current, newPassword: newPw }
    });
    toast('Password updated successfully ✅', 'success');
    ['pw-current','pw-new','pw-confirm'].forEach(id => document.getElementById(id).value = '');
  } catch (e) {
    toast(e.message || 'Failed to update password', 'error');
  }
}

// ── Admin: render all users' password reset rows ───────────────────────────

async function renderAdminPwTable() {
  try {
    if (!USERS.length) USERS = await api('/api/users');
    const tbody = document.getElementById('admin-pw-tbody');
    tbody.innerHTML = USERS.map(u => `
      <tr>
        <td>
          <span class="avatar-sm" style="background:${u.color}">${escapeHtml(u.initials)}</span>
          <strong>${escapeHtml(u.name)}</strong>
        </td>
        <td style="color:var(--text3);font-family:monospace">${escapeHtml(u.email || u.id)}</td>
        <td><span class="role-pill ${u.role}">${u.role === 'admin' ? 'Admin' : 'Employee'}</span></td>
        <td><input type="password" id="admin-pw-${u.id}" placeholder="New password…"></td>
        <td>
          <button class="btn btn-primary btn-sm" onclick="adminResetPassword('${u.id}', ${_jsStr(u.name)})">
            <i class="ti ti-refresh"></i> Reset
          </button>
        </td>
      </tr>`).join('');
  } catch (e) {
    toast('Failed to load users', 'error');
  }
}

// ── Admin: reset a specific user's password ────────────────────────────────

async function adminResetPassword(userId, userName) {
  const input = document.getElementById(`admin-pw-${userId}`);
  const newPw = input.value.trim();

  if (!newPw)          { toast(`Enter a new password for ${userName}`, 'error'); return; }
  if (newPw.length < 6){ toast('Password must be at least 6 characters', 'error'); return; }

  if (!confirm(`Reset password for ${userName}?`)) return;

  try {
    await api(`/api/admin/reset-password/${userId}`, {
      method: 'POST',
      body: { newPassword: newPw }
    });
    input.value = '';
    toast(`Password for ${userName} updated ✅`, 'success');
  } catch (e) {
    toast(e.message || 'Failed to reset password', 'error');
  }
}

// ── Admin: manage team (add / remove / restore members) ────────────────────

function _jsStr(s) {
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

function _teamRow(u, actionHtml) {
  return `
    <tr>
      <td>
        <span class="avatar" style="background:${u.color};width:26px;height:26px;font-size:10px;display:inline-flex;vertical-align:-8px;margin-right:8px">${escapeHtml(u.initials)}</span>
        <strong>${escapeHtml(u.name)}</strong>
      </td>
      <td style="color:var(--text3);font-family:monospace">${escapeHtml(u.email)}</td>
      <td><span class="badge" style="background:${u.role==='admin'?'rgba(139,92,246,0.15)':'rgba(79,142,247,0.15)'};color:${u.role==='admin'?'#a78bfa':'#4f8ef7'}">${u.role === 'admin' ? 'Admin' : 'Employee'}</span></td>
      <td>${actionHtml}</td>
    </tr>`;
}

async function renderAdminTeamTable() {
  try {
    const team    = await api('/api/admin/team');
    const active  = team.filter(u => u.isActive);
    const removed = team.filter(u => !u.isActive);

    document.getElementById('admin-team-tbody').innerHTML = active.map(u => _teamRow(u, `
      <button class="btn btn-danger btn-sm" onclick="removeTeamMember('${u.id}', ${_jsStr(u.name)})">
        <i class="ti ti-user-minus"></i> Remove
      </button>`)).join('') || '<tr><td colspan="4" style="color:var(--text3)">No team members</td></tr>';

    const wrap = document.getElementById('admin-team-removed-wrap');
    if (removed.length) {
      wrap.style.display = '';
      document.getElementById('admin-team-removed-tbody').innerHTML = removed.map(u => _teamRow(u, `
        <button class="btn btn-primary btn-sm" onclick="restoreTeamMember('${u.id}', ${_jsStr(u.name)})">
          <i class="ti ti-user-check"></i> Restore
        </button>`)).join('');
    } else {
      wrap.style.display = 'none';
    }
  } catch (e) {
    toast('Failed to load team', 'error');
  }
}

async function addTeamMember() {
  const name  = document.getElementById('new-member-name').value.trim();
  const email = document.getElementById('new-member-email').value.trim();
  const role  = document.getElementById('new-member-role').value;
  const pw    = document.getElementById('new-member-password').value.trim();

  if (!name)  { toast("Enter the new member's name", 'error'); return; }
  if (!email) { toast("Enter the new member's email", 'error'); return; }

  try {
    const created = await api('/api/admin/users', {
      method: 'POST',
      body: { name, email, role, password: pw }
    });

    document.getElementById('new-member-name').value = '';
    document.getElementById('new-member-email').value = '';
    document.getElementById('new-member-password').value = '';
    document.getElementById('new-member-role').value = 'employee';

    toast(`${created.name} added to the team ✅ Temp password: ${created.tempPassword}`, 'success');

    USERS = []; // invalidate the shared cache so Team page / assignee dropdown pick up the new member
    await renderAdminTeamTable();
  } catch (e) {
    toast(e.message || 'Failed to add team member', 'error');
  }
}

async function removeTeamMember(userId, userName) {
  if (!confirm(`Remove ${userName} from the team? They will lose access immediately and won't be able to log in.`)) return;
  try {
    await api(`/api/admin/users/${userId}`, { method: 'DELETE' });
    toast(`${userName} removed from the team`, 'success');
    USERS = [];
    await renderAdminTeamTable();
    await renderAdminPwTable();
  } catch (e) {
    toast(e.message || 'Failed to remove team member', 'error');
  }
}

async function restoreTeamMember(userId, userName) {
  try {
    await api(`/api/admin/users/${userId}/restore`, { method: 'POST' });
    toast(`${userName} restored to the team`, 'success');
    USERS = [];
    await renderAdminTeamTable();
    await renderAdminPwTable();
  } catch (e) {
    toast(e.message || 'Failed to restore team member', 'error');
  }
}
