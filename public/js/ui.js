'use strict';

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
  const el = document.createElement('div');
  el.className = `toast-item toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast').appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function showTab(name) {
  const names = ['ports', 'vlans', 'raw'];
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', names[i] === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById(`pane-${name}`).classList.add('active');
}

// ── Spinner helper ────────────────────────────────────────────────────────────
function setLoading(btnId, loading, label) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading ? '<span class="spin"></span>' : label;
}

// ── Topbar ────────────────────────────────────────────────────────────────────
function setTopbar(sw, online) {
  document.getElementById('tb-name').textContent = sw ? sw.name : 'Sélectionnez un switch';
  document.getElementById('tb-ip').textContent   = sw ? sw.ip   : '—';
  const badge = document.getElementById('tb-status');
  if (!sw) { badge.textContent = ''; badge.className = 'topbar-badge'; return; }
  const map = { true: ['● En ligne', 'badge-online'], false: ['● Hors ligne', 'badge-offline'], null: ['● …', 'badge-pending'] };
  const key = online === true ? true : online === false ? false : null;
  [badge.textContent, badge.className] = [map[key][0], `topbar-badge ${map[key][1]}`];
}

function enableToolbar(enabled) {
  ['btn-fetch', 'btn-push', 'btn-reboot', 'btn-factory-reset', 'btn-edit', 'btn-del'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
}
