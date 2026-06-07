'use strict';

// ── State global ──────────────────────────────────────────────────────────────
window.App = {
  switches  : [],
  currentId : null,
  get currentSw() { return this.switches.find(s => s.id === this.currentId) || null; },
};

// ── Thème clair / sombre ──────────────────────────────────────────────────────
function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = isLight ? '☀' : '☾';
}

function applyStoredTheme() {
  if (localStorage.getItem('theme') === 'light') {
    document.documentElement.classList.add('light');
    const btn = document.getElementById('btn-theme');
    if (btn) btn.textContent = '☀';
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function init() {
  applyStoredTheme();
  await Promise.all([initPresets(), initModels(), initVlanPresets()]);
  renderVlanPresetButtons();
  await loadSwitches();
  setInterval(pingAll, 30000);
  // Auto-refresh des infos switch toutes les 60s si un switch est sélectionné
  setInterval(function() {
    if (App.currentId) fetchConfig(true).catch(function() {});
  }, 60000);
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
  document.getElementById('raw-config').textContent = 'Chargement de la configuration…';

  // Charger la config immédiatement, faire le ping en parallèle
  fetchConfig(true).catch(() => {});

  try {
    const rp = await fetch(`/api/switches/${id}/ping`);
    const dp = await rp.json();
    sw._online = dp.online;
    setTopbar(sw, dp.online);
  } catch (e) {
    sw._online = false;
    setTopbar(sw, false);
  }
}

// ── Fetch config depuis le switch ─────────────────────────────────────────────
async function fetchConfig(silent = false) {
  if (!App.currentId) return;
  setLoading('btn-fetch', true, '↓ Sync conf');
  try {
    const r = await fetch(`/api/switches/${App.currentId}/config`);
    if (!r.ok) throw new Error(await r.text());
    const cfg = await r.json();

    const sw = App.currentSw;
    const pc = getPortCount(sw.model);

    // ── Format natif Netonix ──────────────────────────────────────────────────
    // Ports  : cfg.Ports  = tableau [{ Number, Name, Enable, PoE, STP, ... }]
    // VLANs  : cfg.VLANs  = tableau [{ ID, Name, PortSettings: "TTTUU..." }]
    //   PortSettings[i] : 'U'=untagged (PVID), 'T'=tagged, autre=absent

    const portsArray = cfg.Ports  || cfg.ports  || [];
    const vlansArray = cfg.VLANs  || cfg.vlans  || [];

    // 1. VLANs : afficher le tableau (id + name)
    if (vlansArray.length) {
      setVlans(vlansArray.map(function(v) {
        return { id: parseInt(v.ID || v.id), name: v.Name || v.name || ('VLAN ' + (v.ID || v.id)), subnet: v.subnet || '', desc: v.description || v.desc || v.Name || v.name || '' };
      }));
    }

    // 2. Construire la matrice VLAN par port depuis PortSettings
    //    portVlan[portNum] = { pvid: X, tagged: [Y, Z] }
    var portVlan = {};
    for (var i = 1; i <= pc; i++) portVlan[i] = { pvid: null, tagged: [] };

    vlansArray.forEach(function(vlan) {
      var vlanId   = parseInt(vlan.ID || vlan.id) || 0;
      var settings = (vlan.PortSettings || vlan.portSettings || '').toUpperCase();
      for (var j = 0; j < settings.length; j++) {
        var portNum = j + 1;
        if (portNum > pc) break;
        if (!portVlan[portNum]) portVlan[portNum] = { pvid: null, tagged: [] };
        if (settings[j] === 'U') portVlan[portNum].pvid = vlanId;
        else if (settings[j] === 'T') portVlan[portNum].tagged.push(vlanId);
      }
    });

    // 3. Construire portRawConfigs depuis Ports + matrice VLAN
    if (Array.isArray(portsArray)) {
      portsArray.forEach(function(portObj) {
        var portNum = portObj.Number || portObj.number;
        if (!portNum || portNum > pc) return;
        var vlanInfo = portVlan[portNum] || { pvid: 1, tagged: [] };
        var nativePoe = portObj.PoE || portObj.poe || 'Off';
        var _poeUp = nativePoe.toUpperCase();
        var normalPoe = _poeUp === 'OFF' || !nativePoe ? false
          : (_poeUp === '48VH' || _poeUp === '48VHV') ? '48VH'
          : _poeUp === '48V' ? '48v'
          : _poeUp === '24V' ? '24v'
          : false;
        var raw = {
          enabled      : portObj.Enable !== false,
          poe          : normalPoe,
          pvid         : vlanInfo.pvid || 1,
          tagged       : vlanInfo.tagged,
          description  : portObj.Name || portObj.name || '',
          stp          : portObj.STP  || portObj.stp  || false,
          storm_control: false,
          qos          : false,
        };
        var detected = null;
        try { detected = detectPreset(raw); } catch (err) { }
        portStates[portNum]       = raw.enabled === false ? 'disabled' : (detected === null ? 'unknown' : detected);
        portDescriptions[portNum] = raw.description;
        portRawConfigs[portNum]   = raw;

        // Si la config inclut un statut de lien (certaines versions firmware)
        var cfgLink  = portObj.Link  || portObj.link  || portObj.Status || portObj.link_status || '';
        var cfgSpeed = portObj.Speed || portObj.speed || portObj.Link_Speed || '';
        if (cfgLink || cfgSpeed) {
          var ls = String(cfgLink).toLowerCase();
          var lu = ls === 'up' || ls === 'connected' || ls === 'active' || String(cfgSpeed) !== '';
          var ss = String(cfgSpeed).toLowerCase();
          var sp = ss.includes('1000') || ss === '1g' ? 1000 : ss.includes('100') ? 100 : ss.includes('10') ? 10 : parseInt(ss) || 0;
          portLinkStats[portNum] = { up: lu, speed: sp };
        }
      });
    }

    // Détection automatique du modèle
    if (cfg._detectedModel && cfg._detectedModel !== sw.model) {
      toast(`Modèle détecté : ${cfg._detectedModel} (configuré : ${sw.model})`, 'info');
    }

    // Mettre à jour les infos du switch depuis la config réelle
    populateSwInfo(cfg, sw);

    renderPortGrid(pc);
    document.getElementById('raw-config').textContent = JSON.stringify(cfg, null, 2);
    if (!silent) toast('Synchronisation effectuée', 'ok');

    // Chargement des stats de lien en arrière-plan (non bloquant)
    loadPortLinkStats(App.currentId, pc);
  } catch (e) {
    toast('Erreur fetch : ' + e.message, 'err');
  } finally {
    setLoading('btn-fetch', false, '↓ Sync conf');
  }
}

// ── Info card switch ──────────────────────────────────────────────────────

function populateSwInfo(cfg, sw) {
  document.getElementById('swi-name').value     = cfg.Switch_Name     || (sw && sw.name)     || '';
  document.getElementById('swi-location').value = cfg.Switch_Location || (sw && sw.location) || '';
  document.getElementById('swi-snmp').value     = cfg.SNMP_Server_Location || (sw && sw.snmp_location) || '';
  const _ip    = cfg.IPv4_Address || (sw && sw.ip) || '';
  const _proto = sw && sw.https !== false ? 'https' : 'http';
  const _ipEl  = document.getElementById('swi-ip');
  if (_ip) {
    _ipEl.innerHTML = `<a href="${_proto}://${_ip}" target="_blank" rel="noopener"
      style="display:inline-flex;align-items:center;gap:4px;background:var(--accent);color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;text-decoration:none;font-family:var(--mono)"
      >${_ip} ↗</a>`;
  } else {
    _ipEl.textContent = '—';
  }
  document.getElementById('swi-model').textContent   = (sw && sw.model) || '—';
  document.getElementById('swi-version').textContent = cfg.Config_Version ? 'v' + cfg.Config_Version : '—';
  document.getElementById('swi-save-btn').style.display = 'none';

  // Mettre à jour le switch en mémoire et la sidebar avec les vraies valeurs
  if (sw) {
    if (cfg.Switch_Name)     sw.name     = cfg.Switch_Name;
    if (cfg.Switch_Location) sw.location = cfg.Switch_Location;
    renderSidebar();
    setTopbar(sw, sw._online);
  }
}

function markSwInfoDirty() {
  document.getElementById('swi-save-btn').style.display = '';
}

async function saveSwInfo() {
  if (!App.currentId) return;
  const name     = document.getElementById('swi-name').value.trim();
  const location = document.getElementById('swi-location').value.trim();
  const snmp     = document.getElementById('swi-snmp').value.trim();

  setLoading('swi-save-btn', true, 'Sauvegarde…');
  try {
    // 1. Pousse les champs vers le switch
    const rSw = await fetch(`/api/switches/${App.currentId}/config`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ Switch_Name: name, Switch_Location: location, SNMP_Server_Location: snmp }),
    });
    const dSw = await rSw.json();
    if (!rSw.ok) throw new Error(dSw.error);

    // 2. Met à jour l'inventaire local (DB)
    await fetch(`/api/switches/${App.currentId}`, {
      method : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ name, location, snmp_location: snmp }),
    });

    // 3. Met à jour la mémoire et la sidebar
    const sw = App.currentSw;
    if (sw) { sw.name = name; sw.location = location; sw.snmp_location = snmp; }
    renderSidebar();
    setTopbar(App.currentSw, App.currentSw && App.currentSw._online);
    document.getElementById('swi-save-btn').style.display = 'none';
    toast('Informations mises à jour', 'ok');
  } catch (e) {
    toast('Erreur : ' + e.message, 'err');
  } finally {
    setLoading('swi-save-btn', false, 'Sauvegarder');
  }
}

// ── Stats de lien par port ────────────────────────────────────────────────
async function loadPortLinkStats(switchId, portCount) {
  // L'API portdetail ne retourne que des compteurs de trafic (pas le statut du lien).
  // On utilise les compteurs comme indicateur d'activité : si > 0, le port a eu du trafic.
  const BATCH = 4;
  const sw    = App.currentSw;
  for (let i = 1; i <= portCount; i += BATCH) {
    if (App.currentId !== switchId) return;
    const batch = [];
    for (let j = i; j < i + BATCH && j <= portCount; j++) batch.push(j);
    await Promise.all(batch.map(async portNum => {
      try {
        const r = await fetch(`/api/switches/${switchId}/stats/${portNum}`);
        if (!r.ok) return;
        const d = await r.json(); // déjà unwrappé de PortDetail côté backend

        // Si la réponse contient quand même des champs de lien explicites
        const linkStr = String(d.Link ?? d.link ?? d.Status ?? d.status ?? '').toLowerCase();
        if (linkStr === 'up' || linkStr === 'connected' || linkStr === 'active') {
          const sr = String(d.Speed ?? d.speed ?? '').toLowerCase();
          const speed = sr.includes('1000') || sr === '1g' ? 1000
                      : sr.includes('100')  ? 100
                      : sr.includes('10')   ? 10
                      : parseInt(sr) || 0;
          portLinkStats[portNum] = { up: true, speed };
          return;
        }
        if (linkStr === 'down' || linkStr === 'disconnected') {
          portLinkStats[portNum] = { up: false, speed: 0 };
          return;
        }

        // Pas de champ lien explicite : inférer depuis les compteurs de trafic
        const rxBytes  = (d.ifInOctets  || 0) + (d.rx_etherStatsOctets  || 0);
        const txBytes  = (d.ifOutOctets || 0) + (d.tx_etherStatsOctets || 0);
        const rxPkts   = (d.ifInUcastPkts  || 0) + (d.rx_etherStatsPkts  || 0);
        const txPkts   = (d.ifOutUcastPkts || 0) + (d.tx_etherStatsPkts || 0);
        if (rxBytes + txBytes + rxPkts + txPkts > 0) {
          portLinkStats[portNum] = { up: true, speed: 0 };
        }
        // Sinon : pas de mise à jour (badge absent = statut inconnu)
      } catch (e) {
        console.warn('[portStats] port', portNum, e.message);
      }
    }));
    if (App.currentId === switchId && sw) renderPortGrid(portCount);
  }
}

// ── Push config vers le switch ────────────────────────────────────────────────
async function pushConfig() {
  if (!App.currentId) return;
  setLoading('btn-push', true, '↑ Push conf');
  try {
    const sw   = App.currentSw;
    const pc   = getPortCount(sw.model);
    const body = { vlans: buildVlansPayload(), ports: buildPortsPayload(pc) };
    const r    = await fetch(`/api/switches/${App.currentId}/config`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    toast(d.message || 'Configuration appliquée !', d.confirmed === false ? 'err' : 'ok');
  } catch (e) {
    toast('Erreur push : ' + e.message, 'err');
  } finally {
    setLoading('btn-push', false, '↑ Push conf');
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
  setLoading('btn-factory-reset', true, '⚠ Factory reset');
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
    setLoading('btn-factory-reset', false, '⚠ Factory reset');
  }
}

function confirmReboot() {
  if (!App.currentId) return;
  const sw = App.currentSw;
  if (!confirm(`Redémarrer "${sw.name}" ?\n\nLe switch sera inaccessible pendant quelques secondes.`)) return;
  doReboot();
}

async function doReboot() {
  setLoading('btn-reboot', true, '↺ Reset device');
  try {
    const r = await fetch(`/api/switches/${App.currentId}/reboot`, { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    toast(d.message || 'Redémarrage lancé', 'ok');
  } catch (e) {
    toast('Erreur reboot : ' + e.message, 'err');
  } finally {
    setLoading('btn-reboot', false, '↺ Reset device');
  }
}

// ── CRUD switches ─────────────────────────────────────────────────────────────
let _editMode = false;

async function openAddModal() {
  _editMode = false;
  document.getElementById('modal-title').textContent = 'Ajouter un switch';
  document.getElementById('btn-save-sw').textContent = 'Ajouter';
  ['f-name','f-ip','f-group','f-location','f-snmp-location'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  populateModelSelect();
  document.getElementById('f-model').value   = 'WS-12';
  document.getElementById('f-https').checked = true;

  // Pré-remplir user/pass depuis les paramètres de scan
  try {
    const r = await fetch('/api/settings');
    if (r.ok) {
      const s = await r.json();
      document.getElementById('f-user').value = s.scan_default_username || 'admin';
      document.getElementById('f-pass').value = s.scan_default_password || '';
    }
  } catch {}

  document.getElementById('modal-sw').classList.add('open');
}

async function probeSwitchInfo() {
  const ip       = document.getElementById('f-ip').value.trim();
  const username = document.getElementById('f-user').value.trim();
  const password = document.getElementById('f-pass').value;
  const useHttps = document.getElementById('f-https').checked;

  if (!ip)       return toast('Entrez d\'abord l\'adresse IP', 'err');
  if (!username) return toast('Entrez d\'abord le nom d\'utilisateur', 'err');
  if (!password) return toast('Entrez d\'abord le mot de passe', 'err');

  const btn = document.getElementById('btn-probe-sw');
  setLoading('btn-probe-sw', true, '⟳ Connexion…');
  try {
    const r = await fetch('/api/scan/probe', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ ip, username, password, https: useHttps }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);

    if (d.hostname) document.getElementById('f-name').value = d.hostname;
    if (d.location) document.getElementById('f-location').value = d.location;
    if (d.model) {
      populateModelSelect();
      document.getElementById('f-model').value = d.model;
    }
    toast('Informations récupérées', 'ok');
  } catch (e) {
    toast('Erreur : ' + e.message, 'err');
  } finally {
    setLoading('btn-probe-sw', false, '⟳ Connexion au switch — récupérer les informations');
  }
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
    const r    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await r.text();
    let sw;
    try { sw = JSON.parse(text); } catch (_) { throw new Error('Réponse invalide du serveur : ' + text.slice(0, 200)); }
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
  loadScanSettings();
  showSettingsTab('models');
  document.getElementById('modal-settings').classList.add('open');
}

function closeSettings() {
  document.getElementById('modal-settings').classList.remove('open');
}

function showSettingsTab(tab) {
  ['models', 'presets', 'vlan-presets', 'scan'].forEach(t => {
    const btn = document.getElementById(`stab-${t}`);
    if (btn) btn.classList.toggle('active', t === tab);
    const pane = document.getElementById(`settings-${t}`);
    if (pane) pane.style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'vlan-presets') loadSettingsVlanPresets();
}

async function loadSettingsModels() {
  const r    = await fetch('/api/models');
  const list = await r.json();
  const tbody = document.getElementById('settings-models-tbody');
  const poeInput = (key, field, val) => `
    <label style="display:flex;align-items:center;gap:5px;font-size:10px">
      <span style="width:34px;color:var(--text3);text-align:right">${field === 'poe_24v_ports' ? '24V' : field === 'poe_48v_ports' ? '48V' : '48VH'}</span>
      <input type="text" value="${(val || '').replace(/"/g, '&quot;')}" placeholder="ex: 1-4,7"
        style="width:95px;font-family:var(--mono);font-size:11px;padding:2px 6px"
        onchange="saveModelPoe('${key}','${field}',this.value)" />
    </label>`;
  tbody.innerHTML = list.map(m => `
    <tr>
      <td style="font-family:var(--mono)">${m.key}</td>
      <td>${m.label}</td>
      <td style="text-align:center">${m.port_count}</td>
      <td>
        <div style="display:flex;flex-direction:column;gap:3px">
          ${poeInput(m.key, 'poe_24v_ports', m.poe_24v_ports)}
          ${poeInput(m.key, 'poe_48v_ports', m.poe_48v_ports)}
          ${poeInput(m.key, 'poe_vh_ports',  m.poe_vh_ports)}
        </div>
      </td>
      <td style="text-align:center">
        ${m.builtin ? '<span style="color:var(--text3);font-size:10px">intégré</span>' :
        `<button class="btn btn-danger" style="font-size:10px;padding:2px 8px" onclick="deleteModel('${m.key}')">Supprimer</button>`}
      </td>
    </tr>
  `).join('');
}

const _POE_FIELD_LABELS = { poe_24v_ports: '24V', poe_48v_ports: '48V', poe_vh_ports: '48VH' };

async function saveModelPoe(key, field, value) {
  try {
    const r = await fetch(`/api/models/${key}`, {
      method : 'PUT', headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ [field]: value }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    await initModels();   // recharge MODEL_POE côté ports
    toast(`Ports ${_POE_FIELD_LABELS[field]} de ${key} : ${formatRanges(parseRanges(value)) || 'aucun'}`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
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
      <td style="font-family:var(--mono);font-size:10px">${Array.isArray(p.tagged) && p.tagged.length ? formatRanges(p.tagged) : '—'}</td>
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
    document.getElementById('pm-tagged').value      = Array.isArray(p.tagged) ? formatRanges(p.tagged) : '';
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

  const tagged = parseRanges(document.getElementById('pm-tagged').value);

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

// ── Paramètres scan ───────────────────────────────────────────────────────────
async function loadScanSettings() {
  try {
    const r = await fetch('/api/settings');
    const settings = await r.json();
    document.getElementById('scan-username').value = settings.scan_default_username || 'admin';
    document.getElementById('scan-password').value = settings.scan_default_password || 'netonix';
  } catch (e) { toast('Erreur chargement settings : ' + e.message, 'err'); }
}

async function saveScanSettings() {
  const username = document.getElementById('scan-username').value.trim();
  const password = document.getElementById('scan-password').value.trim();
  if (!username || !password) return toast('Remplissez tous les champs', 'err');
  try {
    await Promise.all([
      fetch('/api/settings/scan_default_username', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: username })
      }),
      fetch('/api/settings/scan_default_password', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: password })
      })
    ]);
    toast('Paramètres de scan enregistrés', 'ok');
  } catch (e) { toast('Erreur sauvegarde : ' + e.message, 'err'); }
}

// ── VLAN Presets ──────────────────────────────────────────────────────────────
let _editVlanPresetKey = null;

function openVlanPresetsSettings() {
  openSettings();
  showSettingsTab('vlan-presets');
}

async function loadSettingsVlanPresets() {
  try {
    const r = await fetch('/api/vlan-presets');
    const list = await r.json();
    const tbody = document.getElementById('settings-vlan-presets-tbody');
    tbody.innerHTML = list.map(vp => {
      const vlanCount = Array.isArray(vp.vlans) ? vp.vlans.length : 0;
      return `
      <tr>
        <td>
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${vp.color};margin-right:6px"></span>
          ${vp.label}
        </td>
        <td style="text-align:center;font-size:11px">${vlanCount}</td>
        <td style="font-size:10px;color:var(--text3)">${vp.description}</td>
        <td style="text-align:center;display:flex;gap:4px">
          <button class="btn btn-ghost" style="font-size:10px;padding:2px 8px" onclick="openVlanPresetModal('${vp.key}')">Modifier</button>
          ${vp.builtin ? '' : `<button class="btn btn-danger" style="font-size:10px;padding:2px 8px" onclick="deleteVlanPreset('${vp.key}')">Supprimer</button>`}
        </td>
      </tr>
    `;
    }).join('');
  } catch (e) { console.error(e); }
}

let _vpmVlans = [];

function vpmRenderTable() {
  const tbody = document.getElementById('vpm-vlan-tbody');
  tbody.innerHTML = '';
  _vpmVlans.forEach((v, idx) => {
    const color = VLAN_COLORS[idx % VLAN_COLORS.length];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="display:flex;align-items:center;gap:6px">
          <div class="vlan-dot" style="background:${color}"></div>
          <input type="number" value="${v.id}" style="width:52px" onchange="_vpmVlans[${idx}].id=+this.value" />
        </div>
      </td>
      <td><input type="text" value="${v.name}"          onchange="_vpmVlans[${idx}].name=this.value" /></td>
      <td><input type="text" value="${v.subnet||''}"    placeholder="10.0.x.0/24" onchange="_vpmVlans[${idx}].subnet=this.value" /></td>
      <td><input type="text" value="${v.desc||''}"      placeholder="Description"  onchange="_vpmVlans[${idx}].desc=this.value" /></td>
      <td><button class="btn btn-danger" style="padding:3px 7px;font-size:11px" onclick="vpmRemoveVlan(${idx})">✕</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function vpmAddVlan() {
  _vpmVlans.push({ id: 100 + _vpmVlans.length, name: 'Nouveau', subnet: '', desc: '' });
  vpmRenderTable();
}

function vpmRemoveVlan(idx) {
  _vpmVlans.splice(idx, 1);
  vpmRenderTable();
}

async function openVlanPresetModal(key) {
  _editVlanPresetKey = key || null;
  const isNew = !key;
  document.getElementById('vlan-preset-modal-title').textContent = isNew ? 'Nouveau preset VLAN' : 'Modifier preset VLAN';

  if (key) {
    const r = await fetch('/api/vlan-presets');
    const list = await r.json();
    const vp = list.find(x => x.key === key);
    if (!vp) return;
    document.getElementById('vpm-key').value     = vp.key;
    document.getElementById('vpm-key').disabled  = true;
    document.getElementById('vpm-label').value   = vp.label;
    document.getElementById('vpm-desc').value    = vp.description;
    document.getElementById('vpm-color').value   = vp.color;
    _vpmVlans = JSON.parse(JSON.stringify(vp.vlans || []));
  } else {
    document.getElementById('vpm-key').value     = '';
    document.getElementById('vpm-key').disabled  = false;
    document.getElementById('vpm-label').value   = '';
    document.getElementById('vpm-desc').value    = '';
    document.getElementById('vpm-color').value   = 'var(--text2)';
    _vpmVlans = [];
  }
  vpmRenderTable();
  document.getElementById('modal-vlan-preset').classList.add('open');
}

function closeVlanPresetModal() {
  document.getElementById('modal-vlan-preset').classList.remove('open');
  _editVlanPresetKey = null;
  _vpmVlans = [];
}

async function saveVlanPreset() {
  const key = _editVlanPresetKey || document.getElementById('vpm-key').value.trim();
  if (!key) return toast('Clé preset requise', 'err');

  const data = {
    key,
    label      : document.getElementById('vpm-label').value.trim(),
    description: document.getElementById('vpm-desc').value.trim(),
    vlans      : _vpmVlans,
    color      : document.getElementById('vpm-color').value.trim() || 'var(--text2)',
  };

  try {
    const url    = _editVlanPresetKey ? `/api/vlan-presets/${key}` : '/api/vlan-presets';
    const method = _editVlanPresetKey ? 'PUT' : 'POST';
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    closeVlanPresetModal();
    await initVlanPresets();
    renderVlanPresetButtons();
    await loadSettingsVlanPresets();
    toast('Preset VLAN sauvegardé', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

async function deleteVlanPreset(key) {
  if (!confirm(`Supprimer le preset VLAN "${key}" ?`)) return;
  try {
    await fetch(`/api/vlan-presets/${key}`, { method: 'DELETE' });
    await initVlanPresets();
    renderVlanPresetButtons();
    await loadSettingsVlanPresets();
    toast('Preset VLAN supprimé', 'ok');
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
  document.getElementById('btn-scan-add').style.display = 'none';

  try {
    const r    = await fetch('/api/scan', {
      method : 'POST', headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ subnet }),
    });
    const text = await r.text();
    let d;
    try { d = JSON.parse(text); } catch (_) { throw new Error('Réponse invalide du serveur — vérifiez les logs'); }
    if (!r.ok) throw new Error(d.error);

    const existingIps = new Set((App.switches || []).map(s => s.ip));
    const newFound = d.found.filter(f => !existingIps.has(f.ip));
    const skipped  = d.found.length - newFound.length;

    const res = document.getElementById('scan-results');
    if (!newFound.length) {
      const msg = d.found.length === 0
        ? `${d.scanned} hôtes scannés — aucun appareil trouvé.`
        : `${d.scanned} hôtes scannés — tous les appareils trouvés sont déjà dans la liste.`;
      res.innerHTML = `<div style="color:var(--text3);font-size:12px">${msg}</div>`;
    } else {
      const skipNote = skipped ? `<span style="color:var(--text3)"> (${skipped} déjà présent${skipped > 1 ? 's' : ''})</span>` : '';
      res.innerHTML = `<div style="font-size:11px;color:var(--text3);margin-bottom:8px">${newFound.length} appareil(s) nouveaux sur ${d.scanned} hôtes${skipNote} :</div>` +
        newFound.map(({ ip, https, hostname, location, model }) => `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
            <input type="checkbox" class="scan-chk" data-ip="${ip}" data-https="${https}"
              data-model="${(model || '').replace(/"/g, '&quot;')}"
              data-location="${(location || '').replace(/"/g, '&quot;')}"
              style="width:auto;flex-shrink:0" checked />
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-family:var(--mono);font-size:12px">${ip}</span>
                <span style="font-size:10px;color:var(--text3)">${https ? 'HTTPS' : 'HTTP'}</span>
                ${model ? `<span style="font-size:10px;font-family:var(--mono);background:rgba(59,130,246,.15);color:var(--accent);padding:1px 6px;border-radius:4px">${model}</span>` : ''}
              </div>
              <input class="scan-name" data-ip="${ip}"
                value="${(hostname || '').replace(/"/g, '&quot;')}"
                placeholder="Nom du switch"
                style="margin-top:4px;padding:2px 6px;font-size:11px;width:100%;box-sizing:border-box" />
            </div>
          </div>
        `).join('');
      document.getElementById('btn-scan-add').style.display = '';
    }
  } catch (e) {
    toast('Erreur scan : ' + e.message, 'err');
    document.getElementById('scan-results').innerHTML = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Scanner';
  }
}

async function addScannedSwitches() {
  const checks = [...document.querySelectorAll('.scan-chk:checked')];
  if (!checks.length) return toast('Aucun switch sélectionné', 'err');

  let settings = { scan_default_username: 'admin', scan_default_password: 'netonix' };
  try {
    const sr = await fetch('/api/settings');
    if (sr.ok) settings = await sr.json();
  } catch {}

  const entries = checks.map(chk => {
    const ip        = chk.dataset.ip;
    const nameInput = document.querySelector(`.scan-name[data-ip="${ip}"]`);
    return {
      ip,
      https   : chk.dataset.https === 'true',
      location: chk.dataset.location || '',
      model   : chk.dataset.model   || '',
      name    : (nameInput && nameInput.value.trim()) || ip,
      username: settings.scan_default_username || 'admin',
      password: settings.scan_default_password || 'netonix',
    };
  });

  let added = 0, errors = 0;
  for (const e of entries) {
    try {
      const r = await fetch('/api/switches', {
        method : 'POST', headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify(e),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
      added++;
    } catch (err) {
      errors++;
      toast(`Erreur ajout ${e.ip} : ${err.message}`, 'err');
    }
  }

  if (added) {
    toast(`${added} switch${added > 1 ? 's ajoutés' : ' ajouté'}`, 'ok');
    await loadSwitches();
    closeScan();
  }
}

async function preFillAdd(ip, https, hostname = '', location = '') {
  await openAddModal();
  document.getElementById('f-ip').value        = ip;
  document.getElementById('f-https').checked   = https;
  if (hostname) document.getElementById('f-name').value = hostname;
  if (location) document.getElementById('f-location').value = location;
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

document.getElementById('modal-vlan-preset').addEventListener('click', function (e) {
  if (e.target === this) closeVlanPresetModal();
});

init();
