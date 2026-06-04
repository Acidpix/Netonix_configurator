'use strict';

// ── State global ──────────────────────────────────────────────────────────────
window.App = {
  switches  : [],
  currentId : null,
  get currentSw() { return this.switches.find(s => s.id === this.currentId) || null; },
};

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function init() {
  await Promise.all([initPresets(), initModels()]);
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
          ${sw.location ? `<div class="sw-loc">${sw.location}</div>` : ''}
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

    const sw = App.currentSw;
    const pc = getPortCount(sw.model);
    if (cfg.ports) {
      for (let i = 1; i <= pc; i++) {
        const detected = detectPreset(cfg.ports[String(i)]);
        portStates[i]       = detected === null ? 'unknown' : detected;
        portDescriptions[i] = cfg.ports[String(i)]?.description || '';
      }
    }

    // Détection automatique du modèle
    if (cfg._detectedModel && cfg._detectedModel !== sw.model) {
      toast(`Modèle détecté : ${cfg._detectedModel} (configuré : ${sw.model})`, 'info');
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

    const portsPayload = {};
    Object.entries(portMap).forEach(([num, { preset: presetKey, description }]) => {
      const p = PRESETS[presetKey];
      if (!p) return;
      portsPayload[num] = {
        enabled      : p.enabled !== false,
        poe          : p.poe,
        pvid         : p.pvid,
        tagged       : p.tagged || [],
        description  : description || p.description || p.label,
        storm_control: p.storm_control || false,
        stp          : p.stp || false,
        qos          : p.qos || false,
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
  document.getElementById('modal-title').textContent   = 'Ajouter un switch';
  document.getElementById('btn-save-sw').textContent   = 'Ajouter';
  ['f-name','f-ip','f-user','f-pass','f-group','f-location','f-snmp-location'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  populateModelSelect();
  document.getElementById('f-model').value   = 'WS-12';
  document.getElementById('f-https').checked = true;
  document.getElementById('modal-sw').classList.add('open');
}

function openEditModal() {
  if (!App.currentId) return;
  _editMode = true;
  const sw = App.currentSw;
  document.getElementById('modal-title').textContent   = 'Modifier le switch';
  document.getElementById('btn-save-sw').textContent   = 'Enregistrer';
  document.getElementById('f-name').value              = sw.name;
  document.getElementById('f-ip').value                = sw.ip;
  document.getElementById('f-user').value              = sw.username;
  document.getElementById('f-pass').value              = '';
  document.getElementById('f-group').value             = sw.group;
  document.getElementById('f-location').value          = sw.location || '';
  document.getElementById('f-snmp-location').value     = sw.snmp_location || '';
  populateModelSelect();
  document.getElementById('f-model').value             = sw.model;
  document.getElementById('f-https').checked           = sw.https !== false;
  document.getElementById('modal-sw').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-sw').classList.remove('open');
}

async function saveSwitch() {
  const body = {
    name         : document.getElementById('f-name').value.trim(),
    ip           : document.getElementById('f-ip').value.trim(),
    username     : document.getElementById('f-user').value.trim(),
    password     : document.getElementById('f-pass').value,
    group        : document.getElementById('f-group').value.trim() || 'Défaut',
    model        : document.getElementById('f-model').value,
    https        : document.getElementById('f-https').checked,
    location     : document.getElementById('f-location').value.trim(),
    snmp_location: document.getElementById('f-snmp-location').value.trim(),
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

// ── Settings ──────────────────────────────────────────────────────────────────
function openSettings() {
  loadSettingsModels();
  loadSettingsPresets();
  showSettingsTab('models');
  document.getElementById('modal-settings').classList.add('open');
}

function closeSettings() {
  document.getElementById('modal-settings').classList.remove('open');
}

function showSettingsTab(tab) {
  ['models', 'presets'].forEach(t => {
    document.getElementById(`stab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`settings-${t}`).style.display = t === tab ? 'block' : 'none';
  });
}

async function loadSettingsModels() {
  const r    = await fetch('/api/models');
  const list = await r.json();
  const tbody = document.getElementById('settings-models-tbody');
  tbody.innerHTML = list.map(m => `
    <tr>
      <td style="font-family:var(--mono)">${m.key}</td>
      <td>${m.label}</td>
      <td style="text-align:center">${m.port_count}</td>
      <td style="text-align:center">
        ${m.builtin ? '<span style="color:var(--text3);font-size:10px">intégré</span>' :
        `<button class="btn btn-danger" style="font-size:10px;padding:2px 8px" onclick="deleteModel('${m.key}')">Supprimer</button>`}
      </td>
    </tr>
  `).join('');
}

async function addModel() {
  const key   = document.getElementById('nm-key').value.trim();
  const label = document.getElementById('nm-label').value.trim();
  const count = document.getElementById('nm-count').value.trim();
  if (!key || !label || !count) return toast('Remplissez tous les champs', 'err');
  try {
    const r = await fetch('/api/models', {
      method : 'POST', headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ key, label, port_count: parseInt(count) }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    ['nm-key','nm-label','nm-count'].forEach(id => { document.getElementById(id).value = ''; });
    await loadSettingsModels();
    await initModels();
    toast('Modèle ajouté', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

async function deleteModel(key) {
  if (!confirm(`Supprimer le modèle "${key}" ?`)) return;
  try {
    const r = await fetch(`/api/models/${key}`, { method: 'DELETE' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    await loadSettingsModels();
    await initModels();
    toast('Modèle supprimé', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

async function loadSettingsPresets() {
  const r    = await fetch('/api/presets');
  const list = await r.json();
  const tbody = document.getElementById('settings-presets-tbody');
  tbody.innerHTML = list.map(p => `
    <tr>
      <td>
        <span class="preset-dot" style="background:${p.color};width:8px;height:8px;border-radius:2px;display:inline-block"></span>
        ${p.label}
      </td>
      <td style="font-family:var(--mono);font-size:10px">VLAN ${p.pvid}</td>
      <td style="font-family:var(--mono);font-size:10px">${Array.isArray(p.tagged) && p.tagged.length ? p.tagged.join(',') : '—'}</td>
      <td style="font-size:10px">${p.poe && p.poe !== false ? p.poe : 'OFF'}</td>
      <td style="text-align:center;display:flex;gap:4px">
        <button class="btn btn-ghost" style="font-size:10px;padding:2px 8px" onclick="openPresetModal('${p.key}')">Modifier</button>
        <button class="btn btn-danger" style="font-size:10px;padding:2px 8px" onclick="deletePreset('${p.key}')">Supprimer</button>
      </td>
    </tr>
  `).join('');
}

// ── Preset edit modal ─────────────────────────────────────────────────────────
let _editPresetKey = null;

async function openPresetModal(key) {
  _editPresetKey = key || null;
  const isNew = !key;
  document.getElementById('preset-modal-title').textContent = isNew ? 'Nouveau preset' : 'Modifier preset';

  if (key) {
    const r = await fetch('/api/presets');
    const list = await r.json();
    const p = list.find(x => x.key === key);
    if (!p) return;
    document.getElementById('pm-key').value         = p.key;
    document.getElementById('pm-key').disabled      = true;
    document.getElementById('pm-label').value       = p.label;
    document.getElementById('pm-pvid').value        = p.pvid;
    document.getElementById('pm-tagged').value      = Array.isArray(p.tagged) ? p.tagged.join(',') : '';
    document.getElementById('pm-poe').value         = p.poe === false ? 'false' : (p.poe || 'false');
    document.getElementById('pm-sc').checked        = p.storm_control;
    document.getElementById('pm-stp').checked       = p.stp;
    document.getElementById('pm-qos').checked       = p.qos;
    document.getElementById('pm-desc').value        = p.description;
    document.getElementById('pm-color').value       = p.color;
  } else {
    document.getElementById('pm-key').value         = '';
    document.getElementById('pm-key').disabled      = false;
    document.getElementById('pm-label').value       = '';
    document.getElementById('pm-pvid').value        = '1';
    document.getElementById('pm-tagged').value      = '';
    document.getElementById('pm-poe').value         = 'false';
    document.getElementById('pm-sc').checked        = false;
    document.getElementById('pm-stp').checked       = false;
    document.getElementById('pm-qos').checked       = false;
    document.getElementById('pm-desc').value        = '';
    document.getElementById('pm-color').value       = 'var(--text2)';
  }
  document.getElementById('modal-preset').classList.add('open');
}

function closePresetModal() {
  document.getElementById('modal-preset').classList.remove('open');
  _editPresetKey = null;
}

async function savePreset() {
  const key = _editPresetKey || document.getElementById('pm-key').value.trim();
  if (!key) return toast('Clé preset requise', 'err');

  const taggedRaw = document.getElementById('pm-tagged').value.trim();
  const tagged = taggedRaw ? taggedRaw.split(',').map(v => parseInt(v.trim())).filter(n => !isNaN(n)) : [];

  const data = {
    key,
    label        : document.getElementById('pm-label').value.trim(),
    pvid         : parseInt(document.getElementById('pm-pvid').value) || 1,
    tagged,
    poe          : document.getElementById('pm-poe').value,
    storm_control: document.getElementById('pm-sc').checked,
    stp          : document.getElementById('pm-stp').checked,
    qos          : document.getElementById('pm-qos').checked,
    description  : document.getElementById('pm-desc').value.trim(),
    color        : document.getElementById('pm-color').value.trim() || 'var(--text2)',
    cls          : `p-${key}`,
    enabled      : document.getElementById('pm-poe').value !== 'disabled',
  };

  try {
    const url    = _editPresetKey ? `/api/presets/${key}` : '/api/presets';
    const method = _editPresetKey ? 'PUT' : 'POST';
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    closePresetModal();
    await initPresets();
    await loadSettingsPresets();
    toast('Preset sauvegardé', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

async function deletePreset(key) {
  if (!confirm(`Supprimer le preset "${key}" ?`)) return;
  try {
    await fetch(`/api/presets/${key}`, { method: 'DELETE' });
    await initPresets();
    await loadSettingsPresets();
    toast('Preset supprimé', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

// ── Scan réseau ───────────────────────────────────────────────────────────────
function openScan() {
  document.getElementById('scan-results').innerHTML = '';
  document.getElementById('scan-subnet').value = '';
  document.getElementById('modal-scan').classList.add('open');
}

function closeScan() {
  document.getElementById('modal-scan').classList.remove('open');
}

async function startScan() {
  const subnet = document.getElementById('scan-subnet').value.trim();
  if (!subnet) return toast('Entrez un subnet (ex: 192.168.1.0/24)', 'err');

  const btn = document.getElementById('btn-scan-start');
  btn.disabled = true;
  btn.textContent = 'Scan en cours…';
  document.getElementById('scan-results').innerHTML = '<div style="color:var(--text3);font-size:12px">Scan en cours, veuillez patienter…</div>';

  try {
    const r = await fetch('/api/scan', {
      method : 'POST', headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ subnet }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);

    const res = document.getElementById('scan-results');
    if (!d.found.length) {
      res.innerHTML = `<div style="color:var(--text3);font-size:12px">${d.scanned} hôtes scannés — aucun appareil trouvé.</div>`;
    } else {
      res.innerHTML = `<div style="font-size:11px;color:var(--text3);margin-bottom:8px">${d.found.length} appareil(s) trouvé(s) sur ${d.scanned} hôtes :</div>` +
        d.found.map(({ ip, https }) => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
            <div>
              <span style="font-family:var(--mono);font-size:12px">${ip}</span>
              <span style="font-size:10px;color:var(--text3);margin-left:8px">${https ? 'HTTPS' : 'HTTP'}</span>
            </div>
            <button class="btn btn-ghost" style="font-size:11px;padding:3px 10px"
              onclick="preFillAdd('${ip}', ${https}); closeScan();">Ajouter</button>
          </div>
        `).join('');
    }
  } catch (e) {
    toast('Erreur scan : ' + e.message, 'err');
    document.getElementById('scan-results').innerHTML = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Scanner';
  }
}

function preFillAdd(ip, https) {
  openAddModal();
  document.getElementById('f-ip').value        = ip;
  document.getElementById('f-https').checked   = https;
}

// ── Misc ──────────────────────────────────────────────────────────────────────
function copyRaw() {
  navigator.clipboard.writeText(document.getElementById('raw-config').textContent)
    .then(() => toast('Copié !', 'ok'));
}

document.getElementById('modal-sw').addEventListener('click', function (e) {
  if (e.target === this) closeModal();
});

document.getElementById('modal-settings').addEventListener('click', function (e) {
  if (e.target === this) closeSettings();
});

document.getElementById('modal-scan').addEventListener('click', function (e) {
  if (e.target === this) closeScan();
});

document.getElementById('modal-preset').addEventListener('click', function (e) {
  if (e.target === this) closePresetModal();
});

init();
