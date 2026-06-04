'use strict';

// ── State global ──────────────────────────────────────────────────────────────
window.App = {
  switches  : [],
  currentId : null,
  get currentSw() { return this.switches.find(s => s.id === this.currentId) || null; },
};

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function init() {
  await loadSwitches();
  setInterval(pingAll, 30000);
}

// ── Inventaire ────────────────────────────────────────────────────────────────
async function loadSwitches() {
  try {
    const r = await fetch('/api/switches');
    App.switches = await r.json();
    renderSidebar();
  } catch (e) {
    toast('Impossible de joindre le serveur', 'err');
  }
}

function renderSidebar() {
  const groups = {};
  App.switches.forEach(sw => {
    if (!groups[sw.group]) groups[sw.group] = [];
    groups[sw.group].push(sw);
  });

  const count = App.switches.length;
  document.getElementById('sw-count').textContent = `${count} switch${count !== 1 ? 's' : ''}`;

  const list = document.getElementById('sw-list');
  list.innerHTML = '';

  Object.entries(groups).forEach(([grp, items]) => {
    const lbl = document.createElement('div');
    lbl.className = 'sw-group-label';
    lbl.textContent = grp;
    list.appendChild(lbl);

    items.forEach(sw => {
      const item = document.createElement('div');
      item.className = 'sw-item' + (sw.id === App.currentId ? ' active' : '');
      item.id = `sw-item-${sw.id}`;
      item.onclick = () => selectSwitch(sw.id);
      item.innerHTML = `
        <div class="sw-dot ${sw._online === true ? 'online' : sw._online === false ? 'offline' : 'pending'}" id="dot-${sw.id}"></div>
        <div style="flex:1;overflow:hidden">
          <div class="sw-name">${sw.name}</div>
          <div class="sw-ip">${sw.ip}</div>
        </div>
      `;
      list.appendChild(item);
    });
  });
}

async function pingAll() {
  for (const sw of App.switches) {
    try {
      const r = await fetch(`/api/switches/${sw.id}/ping`);
      const d = await r.json();
      sw._online = d.online;
      const dot = document.getElementById(`dot-${sw.id}`);
      if (dot) dot.className = `sw-dot ${d.online ? 'online' : 'offline'}`;
      if (sw.id === App.currentId) setTopbar(sw, sw._online);
    } catch {}
  }
}

// ── Sélection d'un switch ─────────────────────────────────────────────────────
async function selectSwitch(id) {
  App.currentId = id;
  const sw = App.currentSw;
  if (!sw) return;

  document.querySelectorAll('.sw-item').forEach(el => el.classList.remove('active'));
  document.getElementById(`sw-item-${id}`)?.classList.add('active');

  setTopbar(sw, null);
  enableToolbar(true);
  document.getElementById('empty-state').style.display   = 'none';
  document.getElementById('ports-section').style.display = 'block';

  resetPortStates();
  renderPortGrid(getPortCount(sw.model));
  resetVlans();
  renderVlanTable();
  hidePortDetail();
  document.getElementById('raw-config').textContent = 'Récupérez la configuration du switch…';

  // Ping + auto-fetch
  try {
    const rp = await fetch(`/api/switches/${id}/ping`);
    const dp = await rp.json();
    sw._online = dp.online;
    setTopbar(sw, dp.online);
    if (dp.online) fetchConfig(true);
  } catch (e) {
    sw._online = false;
    setTopbar(sw, false);
  }
}

// ── Fetch config depuis le switch ─────────────────────────────────────────────
async function fetchConfig(silent = false) {
  if (!App.currentId) return;
  setLoading('btn-fetch', true, '↓ Récupérer config');
  try {
    const r = await fetch(`/api/switches/${App.currentId}/config`);
    if (!r.ok) throw new Error(await r.text());
    const cfg = await r.json();

    if (cfg.vlans) setVlans(cfg.vlans);

    // Reconstitue les états de ports
    const sw = App.currentSw;
    const pc = getPortCount(sw.model);
    if (cfg.ports) {
      for (let i = 1; i <= pc; i++) {
        portStates[i] = detectPreset(cfg.ports[String(i)]);
      }
    }
    renderPortGrid(pc);
    document.getElementById('raw-config').textContent = JSON.stringify(cfg, null, 2);
    if (!silent) toast('Configuration récupérée', 'ok');
  } catch (e) {
    toast('Erreur fetch : ' + e.message, 'err');
  } finally {
    setLoading('btn-fetch', false, '↓ Récupérer config');
  }
}

// ── Push config vers le switch ────────────────────────────────────────────────
async function pushConfig() {
  if (!App.currentId) return;
  setLoading('btn-push', true, '↑ Pousser config');
  try {
    const sw      = App.currentSw;
    const pc      = getPortCount(sw.model);
    const portMap = buildPortsPayload(pc);

    // Convertit les clés preset en configs Netonix
    const portsPayload = {};
    Object.entries(portMap).forEach(([num, presetKey]) => {
      const p = PRESETS[presetKey];
      if (!p) return;
      portsPayload[num] = {
        enabled      : p.label !== 'Désactivé',
        poe          : p.poe,
        pvid         : p.pvid,
        tagged       : p.tagged,
        description  : p.label,
        storm_control: presetKey === 'cam',
        stp          : ['cam', 'ap', 'voip'].includes(presetKey),
        qos          : presetKey === 'voip',
      };
    });

    const body = { vlans: buildVlansPayload(), ports: portsPayload };
    const r    = await fetch(`/api/switches/${App.currentId}/config`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    toast(d.message || 'Configuration appliquée !', 'ok');
  } catch (e) {
    toast('Erreur push : ' + e.message, 'err');
  } finally {
    setLoading('btn-push', false, '↑ Pousser config');
  }
}

// ── Reset propre ──────────────────────────────────────────────────────────────
function confirmReset() {
  if (!App.currentId) return;
  const sw = App.currentSw;
  if (!confirm(`Reset complet de "${sw.name}" ?\n\n• IP : ${sw.ip} → conservée\n• Nom : ${sw.name} → conservé\n• Tous les ports → remis à zéro\n\nCette action ne peut pas être annulée.`)) return;
  doReset();
}

async function doReset() {
  setLoading('btn-reset', true, '↺ Reset propre');
  try {
    const r = await fetch(`/api/switches/${App.currentId}/reset`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ vlans: buildVlansPayload() }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    toast(d.message, 'ok');
    setTimeout(() => fetchConfig(true), 3000);
  } catch (e) {
    toast('Erreur reset : ' + e.message, 'err');
  } finally {
    setLoading('btn-reset', false, '↺ Reset propre');
  }
}

// ── CRUD switches ─────────────────────────────────────────────────────────────
let _editMode = false;

function openAddModal() {
  _editMode = false;
  document.getElementById('modal-title').textContent  = 'Ajouter un switch';
  document.getElementById('btn-save-sw').textContent  = 'Ajouter';
  ['f-name','f-ip','f-user','f-pass','f-group'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('f-model').value  = 'WS-12';
  document.getElementById('f-https').checked = true;
  document.getElementById('modal-sw').classList.add('open');
}

function openEditModal() {
  if (!App.currentId) return;
  _editMode = true;
  const sw = App.currentSw;
  document.getElementById('modal-title').textContent  = 'Modifier le switch';
  document.getElementById('btn-save-sw').textContent  = 'Enregistrer';
  document.getElementById('f-name').value  = sw.name;
  document.getElementById('f-ip').value    = sw.ip;
  document.getElementById('f-user').value  = sw.username;
  document.getElementById('f-pass').value  = '';
  document.getElementById('f-group').value = sw.group;
  document.getElementById('f-model').value = sw.model;
  document.getElementById('f-https').checked = sw.https !== false;
  document.getElementById('modal-sw').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-sw').classList.remove('open');
}

async function saveSwitch() {
  const body = {
    name    : document.getElementById('f-name').value.trim(),
    ip      : document.getElementById('f-ip').value.trim(),
    username: document.getElementById('f-user').value.trim(),
    password: document.getElementById('f-pass').value,
    group   : document.getElementById('f-group').value.trim() || 'Défaut',
    model   : document.getElementById('f-model').value,
    https   : document.getElementById('f-https').checked,
  };
  if (!body.name || !body.ip || !body.username)
    return toast('Champs obligatoires manquants', 'err');
  if (!_editMode && !body.password)
    return toast('Mot de passe requis', 'err');

  try {
    const url    = _editMode ? `/api/switches/${App.currentId}` : '/api/switches';
    const method = _editMode ? 'PUT' : 'POST';
    const r  = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const sw = await r.json();
    if (!r.ok) throw new Error(sw.error);
    closeModal();
    await loadSwitches();
    toast(_editMode ? 'Switch mis à jour' : 'Switch ajouté', 'ok');
    if (!_editMode) selectSwitch(sw.id);
  } catch (e) {
    toast('Erreur : ' + e.message, 'err');
  }
}

async function deleteSwitch() {
  if (!App.currentId) return;
  const sw = App.currentSw;
  if (!confirm(`Supprimer "${sw.name}" de l'inventaire ?`)) return;
  await fetch(`/api/switches/${App.currentId}`, { method: 'DELETE' });
  App.currentId = null;
  enableToolbar(false);
  setTopbar(null, null);
  document.getElementById('empty-state').style.display   = 'flex';
  document.getElementById('ports-section').style.display = 'none';
  await loadSwitches();
  toast('Switch supprimé', 'ok');
}

// ── Misc ──────────────────────────────────────────────────────────────────────
function copyRaw() {
  navigator.clipboard.writeText(document.getElementById('raw-config').textContent)
    .then(() => toast('Copié !', 'ok'));
}

document.getElementById('modal-sw').addEventListener('click', function (e) {
  if (e.target === this) closeModal();
});

init();
