/* ===== navigation.js — Page switching & modal helpers ===== */

function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const el = document.getElementById('page-' + page);
  if (el) el.classList.add('active');

  const titles = {
    dashboard:   'Dashboard',
    tasks:       currentUser?.role === 'admin' ? 'All Tasks' : 'My Tasks',
    users:       'Team Members',
    activity:    'Activity Log',
    performance: 'Performance Analytics',
    settings:    currentUser?.role === 'admin' ? 'Settings' : 'Change Password',
  };
  document.getElementById('page-title').textContent = titles[page] || page;

  // Highlight matching nav item
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.textContent.trim().toLowerCase().includes((titles[page]||'').split(' ')[0].toLowerCase())) {
      n.classList.add('active');
    }
  });

  if      (page === 'dashboard')   renderDashboard();
  else if (page === 'tasks')       renderTasks();
  else if (page === 'users')       renderUsers();
  else if (page === 'activity')    renderActivity();
  else if (page === 'performance') renderPerformance();
  else if (page === 'settings')    renderSettings();
}

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});
