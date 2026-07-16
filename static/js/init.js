/* ===== init.js — Bootstrap ===== */

(function init() {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  const dueDateInput = document.getElementById('task-due');
  if (dueDateInput) dueDateInput.value = d.toISOString().split('T')[0];
})();
