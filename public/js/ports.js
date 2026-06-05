'use strict';

let MODEL_PORTS = {};   // { key: portCount } — chargé depuis /api/models

let portStates       = {};  // { portNum: presetKey | 'unknown' | null }
let portDescriptions = {};  // { portNum: string }
let portRawConfigs   = {};  // { portNum: rawPortCfg } — config brute du switch
let portLinkStats    = {};  // { portNum: { speed: '1000'|'100'|'10'|null, up: bool } }
let selectedPorts    = new Set();

function poeBadgeHtml(poe) {
  if (!poe || poe === false || poe === 'false' || poe === 'Off' || poe === 'off') return '';
  const label = String(poe).toUpperCase().replace('V', 'V').replace('FALSE', '');
  const cls   = (poe === '48vHV' || poe === '48VH' || String(poe).toUpperCase() === '48VHV' || String(poe).toUpperCase() === '48VH')
    ? 'badge-poe-red' : 'badge-poe-green';
  return `<span class="port-badge ${cls}" title="PoE ${label}">${label}</span>`;
}

function linkBadgeHtml(portNum) {
  const s = portLinkStats[portNum];
  if (!s) return '';
  if (!s.up) return `<span class="port-badge badge-link-down" title="Lien inactif">↓</span>`;
  if (s.speed >= 1000) return `<span class="port-badge badge-link-1g"   title="1 Gb/s">1G</span>`;
  if (s.speed >= 100)  return `<span class="port-badge badge-link-100m" title="100 Mb/s">100M</span>`;
  if (s.speed > 0)     return `<span class="port-badge badge-link-10m"  title="10 Mb/s">10M</span>`;
  return `<span class="port-badge badge-link-down" title="Lien inactif">↓</span>`;
}

let _pendingPresetKey = null; // stocke la clé en attente de confirmation

async function initModels() {
  const r    = await fetch('/api/models');
  const list = await r.json();
  MODEL_PORTS = {};
  list.forEach(m => { MODEL_PORTS[m.key] = m.port_count; });
  // Met à jour le <select> modèle dans le modal switch si déjà ouvert
  populateModelSelect();
}

function populateModelSelect() {
  const sel = document.getElementById('f-model');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '';
  Object.entries(MODEL_PORTS).forEach(([key, count]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = key + (count ? ` (${count} ports)` : '');
    sel.appendChild(opt);
  });
  if (cur && MODEL_PORTS[cur]) sel.value = cur;
}

function getPortCount(model) {
  return MODEL_PORTS[model] || 12;
}

// ── Rendu grille ──────────────────────────────────────────────────────────────

function renderPortGrid(count) {
  const grid = document.getElementById('port-grid');
  const cols  = count <= 8 ? 4 : count <= 12 ? 6 : 8;
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.innerHTML = '';

  for (let i = 1; i <= count; i++) {
    const key  = portStates[i];
    const p    = key && key !== 'unknown' ? PRESETS[key] : null;
    const raw  = portRawConfigs[i] || null;
    const desc = portDescriptions[i] || '';

    // Couleur et label : preset > config brute > Libre
    let dotColor, cellLabel, poeSrc;
    if (p) {
      dotColor  = p.color;
      cellLabel = desc || p.label;
      poeSrc    = p.poe;
    } else if (raw) {
      dotColor  = 'var(--border)';
      cellLabel = desc || ('VLAN ' + (raw.pvid !== undefined ? raw.pvid : 1));
      poeSrc    = raw.poe;
    } else {
      dotColor  = 'var(--border2)';
      cellLabel = desc || 'Libre';
      poeSrc    = null;
    }

    const cell = document.createElement('div');
    cell.id        = `port-${i}`;
    cell.className = 'port-cell' + (p ? ' ' + p.cls : '') + (selectedPorts.has(i) ? ' selected' : '');
    cell.onclick   = () => togglePort(i);
    cell.oncontextmenu = e => { e.preventDefault(); clearPortSelection(); };
    cell.onmouseenter  = e => showPortTooltip(e, i);
    cell.onmouseleave  = () => hidePortTooltip();
    cell.innerHTML = `
      <div class="port-color-dot" style="background:${dotColor}"></div>
      <div class="port-num">${i}</div>
      <div class="port-label">${cellLabel}</div>
      <div class="port-badges">${poeBadgeHtml(poeSrc)}${linkBadgeHtml(i)}</div>
    `;
    grid.appendChild(cell);
  }
  renderPortLegend();
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function showPortTooltip(e, i) {
  const key    = portStates[i];
  const preset = key && key !== 'unknown' ? PRESETS[key] : null;
  const raw    = portRawConfigs[i] || null;
  const desc   = portDescriptions[i] || '';
  const tt     = document.getElementById('port-tooltip');

  let title;
  if (preset)    title = 'Port ' + i + ' — ' + preset.label;
  else if (raw)  title = 'Port ' + i + ' — VLAN ' + (raw.pvid !== undefined ? raw.pvid : 1);
  else           title = 'Port ' + i + ' — Libre';

  const titleColor = preset ? preset.color : (raw ? 'var(--text)' : 'var(--text3)');
  let html = `<div class="tt-title" style="color:${titleColor}">${title}</div>`;

  const cfg = preset || raw;
  if (cfg) {
    const pvid   = preset ? preset.pvid   : (raw.pvid !== undefined ? raw.pvid : 1);
    const tagged = preset ? (preset.tagged || []) : (Array.isArray(raw.tagged) ? raw.tagged : []);
    const poe    = preset ? preset.poe    : raw.poe;
    html += `<div class="tt-row"><span>VLAN natif</span><b>VLAN ${pvid}</b></div>`;
    html += `<div class="tt-row"><span>Taggés</span><b>${tagged.length ? tagged.join(', ') : '—'}</b></div>`;
    html += `<div class="tt-row"><span>PoE</span><b>${poe && poe !== false ? poe : 'OFF'}</b></div>`;
    const sc  = preset ? preset.storm_control : (raw && raw.storm_control);
    const stp = preset ? preset.stp           : (raw && raw.stp);
    const qos = preset ? preset.qos           : (raw && raw.qos);
    if (sc)  html += `<div class="tt-row"><span>Storm-control</span><b>ON</b></div>`;
    if (stp) html += `<div class="tt-row"><span>STP portfast</span><b>ON</b></div>`;
    if (qos) html += `<div class="tt-row"><span>QoS DSCP</span><b>ON</b></div>`;
  }
  if (desc) html += `<div class="tt-desc">${desc}</div>`;
  tt.innerHTML = html;

  const rect = e.currentTarget.getBoundingClientRect();
  const left  = rect.right + 8;
  const top   = Math.min(rect.top, window.innerHeight - 160);
  tt.style.left    = left + 'px';
  tt.style.top     = top  + 'px';
  tt.style.display = 'block';
}

function hidePortTooltip() {
  document.getElementById('port-tooltip').style.display = 'none';
}

// ── Sélection ─────────────────────────────────────────────────────────────────

function togglePort(i) {
  if (selectedPorts.has(i)) selectedPorts.delete(i);
  else selectedPorts.add(i);

  document.querySelectorAll('.port-cell').forEach((el, idx) => {
    el.classList.toggle('selected', selectedPorts.has(idx + 1));
  });

  if (selectedPorts.size === 1) {
    const portNum = [...selectedPorts][0];
    showPortDetail(portStates[portNum], [portNum]);
  } else if (selectedPorts.size > 1) {
    showMultiPortDetail([...selectedPorts]);
  } else {
    hidePortDetail();
  }
}

function clearPortSelection() {
  selectedPorts.clear();
  document.querySelectorAll('.port-cell').forEach(el => el.classList.remove('selected'));
  hidePortDetail();
}

// ── Application de preset ─────────────────────────────────────────────────────

function applyPreset(key) {
  if (!selectedPorts.size) {
    toast('Sélectionnez d\'abord un ou plusieurs ports', 'info');
    return;
  }
  // Vérifie si des ports ont déjà une config
  const hasCurrent = [...selectedPorts].some(p => portStates[p] !== null);
  if (hasCurrent) {
    _pendingPresetKey = key;
    showPresetConfirmModal(key);
    return;
  }
  doApplyPreset(key);
}

function doApplyPreset(key) {
  const count = selectedPorts.size;
  selectedPorts.forEach(p => { portStates[p] = key; });
  const currentSw = window.App?.currentSw;
  renderPortGrid(getPortCount(currentSw?.model));
  clearPortSelection();
  toast(`"${PRESETS[key].label}" appliqué sur ${count} port${count > 1 ? 's' : ''}`, 'ok');
}

function showPresetConfirmModal(key) {
  const p    = PRESETS[key];
  const ports = [...selectedPorts];
  const content = document.getElementById('confirm-preset-content');

  const rows = ports.map(num => {
    const curKey = portStates[num];
    const cur    = curKey === 'unknown' ? PRESET_UNKNOWN : (curKey ? PRESETS[curKey] : null);
    return `<tr>
      <td style="font-family:var(--mono);font-weight:700">Port ${num}</td>
      <td>
        <span class="preset-dot" style="background:${cur ? cur.color : 'var(--border2)'}"></span>
        ${cur ? cur.label : 'Libre'}
      </td>
      <td style="color:var(--text3)">→</td>
      <td>
        <span class="preset-dot" style="background:${p.color}"></span>
        ${p.label}
      </td>
    </tr>`;
  }).join('');

  content.innerHTML = `
    <p style="font-size:12px;color:var(--text2);margin-bottom:10px">
      Ces ports ont déjà une configuration. Confirmer le remplacement ?
    </p>
    <table style="width:100%;font-size:12px;border-collapse:collapse">
      <thead>
        <tr style="color:var(--text3);font-size:10px;text-transform:uppercase">
          <th style="text-align:left;padding:4px 8px">Port</th>
          <th style="text-align:left;padding:4px 8px">Actuel</th>
          <th style="padding:4px 4px"></th>
          <th style="text-align:left;padding:4px 8px">Nouveau</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  document.getElementById('modal-confirm-preset').classList.add('open');
}

function confirmPresetApply() {
  document.getElementById('modal-confirm-preset').classList.remove('open');
  if (_pendingPresetKey) {
    doApplyPreset(_pendingPresetKey);
    _pendingPresetKey = null;
  }
}

function cancelPresetApply() {
  document.getElementById('modal-confirm-preset').classList.remove('open');
  _pendingPresetKey = null;
}

// ── Panneaux de détail ────────────────────────────────────────────────────────

function _inputStyle() {
  return 'background:var(--bg4);border:1px solid var(--border);border-radius:4px;padding:3px 6px;font-size:11px;color:var(--text)';
}

function showPortDetail(key, ports) {
  const panel = document.getElementById('detail-panel');
  panel.style.display = 'block';

  // Multi-sélection : pas d'édition individuelle
  if (ports.length > 1) return showMultiPortDetail(ports);

  const portNum = ports[0];
  const preset  = key && key !== 'unknown' ? PRESETS[key] : null;
  const raw     = portRawConfigs[portNum] || null;
  const link    = portLinkStats[portNum]  || null;

  // Config effective (preset ou raw) pour pré-remplir les champs
  const cfg = preset || raw || {};
  const pvid      = cfg.pvid   !== undefined ? cfg.pvid   : 1;
  const tagged    = Array.isArray(cfg.tagged) ? cfg.tagged : [];
  const poe       = cfg.poe    !== undefined ? cfg.poe    : false;
  const enabled   = cfg.enabled !== false;
  const sc        = !!cfg.storm_control;
  const stp       = !!cfg.stp;
  const qos       = !!cfg.qos;
  const desc      = portDescriptions[portNum] || cfg.description || '';
  const color     = preset ? preset.color : (raw ? 'var(--border)' : 'var(--border2)');
  const label     = preset ? preset.label : (raw ? 'VLAN ' + pvid : 'Libre');
  const poeVal    = poe === false ? 'false' : String(poe);
  const taggedStr = tagged.join(', ');

  // Badge lien
  let linkHtml = '<span style="color:var(--text3);font-size:10px">—</span>';
  if (link) {
    if (!link.up) linkHtml = '<span style="color:var(--text3);font-size:11px">↓ Déconnecté</span>';
    else if (link.speed >= 1000) linkHtml = '<span style="color:var(--green);font-size:11px">↑ 1 Gb/s</span>';
    else if (link.speed >= 100)  linkHtml = '<span style="color:var(--amber);font-size:11px">↑ 100 Mb/s</span>';
    else                         linkHtml = '<span style="color:var(--red);font-size:11px">↑ 10 Mb/s</span>';
  }

  const s = _inputStyle();
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <span class="preset-dot" style="background:${color};width:10px;height:10px;border-radius:2px;display:inline-block;flex-shrink:0"></span>
      <span style="font-weight:600;font-size:13px">${label} — Port ${portNum}</span>
      <span style="margin-left:auto">${linkHtml}</span>
    </div>

    <div class="detail-row" style="align-items:center">
      <span class="dl">État</span>
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:11px">
        <input type="checkbox" style="width:auto" ${enabled ? 'checked' : ''}
          onchange="updatePortField(${portNum},'enabled',this.checked)" />
        <span style="color:${enabled ? 'var(--green)' : 'var(--text3)'}">${enabled ? 'Activé' : 'Désactivé'}</span>
      </label>
    </div>

    <div class="detail-row">
      <span class="dl">PoE</span>
      <select style="${s}" onchange="updatePortField(${portNum},'poe',this.value==='false'?false:this.value)">
        <option value="false" ${poeVal==='false'?'selected':''}>OFF</option>
        <option value="24v"   ${poeVal==='24v'?'selected':''}>24V</option>
        <option value="48v"   ${poeVal==='48v'?'selected':''}>48V</option>
        <option value="48vHV" ${poeVal==='48vHV'||poeVal==='48VH'?'selected':''}>48VH</option>
      </select>
    </div>

    <div class="detail-row">
      <span class="dl">VLAN natif (PVID)</span>
      <input type="number" value="${pvid}" min="1" max="4094" style="${s};width:70px"
        onchange="updatePortField(${portNum},'pvid',+this.value)" />
    </div>

    <div class="detail-row">
      <span class="dl">VLANs taggés</span>
      <input type="text" value="${taggedStr}" placeholder="10,20,30" style="${s};width:120px"
        onchange="updatePortField(${portNum},'tagged',this.value.split(',').map(function(v){return parseInt(v.trim());}).filter(function(n){return n>0;}))" />
    </div>

    <div class="detail-row" style="border:none">
      <span class="dl">Description</span>
      <input value="${desc}" placeholder="(optionnel)" style="${s};width:130px"
        oninput="updatePortField(${portNum},'description',this.value)" />
    </div>

    <div style="display:flex;gap:10px;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;cursor:pointer">
        <input type="checkbox" style="width:auto" ${sc?'checked':''}
          onchange="updatePortField(${portNum},'storm_control',this.checked)" /> Storm-ctrl
      </label>
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;cursor:pointer">
        <input type="checkbox" style="width:auto" ${stp?'checked':''}
          onchange="updatePortField(${portNum},'stp',this.checked)" /> STP
      </label>
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;cursor:pointer">
        <input type="checkbox" style="width:auto" ${qos?'checked':''}
          onchange="updatePortField(${portNum},'qos',this.checked)" /> QoS
      </label>
    </div>

    ${preset ? `<div style="margin-top:10px">
      <button class="btn btn-ghost" onclick="clearPreset([${portNum}])" style="font-size:11px">Effacer preset</button>
    </div>` : ''}
  `;
}

function showMultiPortDetail(ports) {
  const panel = document.getElementById('detail-panel');
  panel.style.display = 'block';
  panel.innerHTML = `
    <div style="font-weight:600;font-size:13px;margin-bottom:8px">${ports.length} ports sélectionnés : ${ports.join(', ')}</div>
    <div style="font-size:11px;color:var(--text3);margin-bottom:10px">Choisissez un preset pour les configurer tous simultanément.</div>
    <button class="btn btn-ghost" onclick="clearPortSelection()" style="font-size:11px">Désélectionner</button>
  `;
}

function hidePortDetail() {
  const panel = document.getElementById('detail-panel');
  panel.style.display = 'none';
}

// ── Effacement preset ─────────────────────────────────────────────────────────

function clearPreset(ports) {
  ports.forEach(function(p) {
    // Garde la config brute mais efface le preset — le port devient 'unknown'
    portStates[p] = portRawConfigs[p] ? 'unknown' : null;
  });
  const sw = window.App && window.App.currentSw;
  renderPortGrid(getPortCount(sw ? sw.model : null));
  hidePortDetail();
  clearPortSelection();
}

// ── Légende ───────────────────────────────────────────────────────────────────

function renderPortLegend() {
  const used = new Set(Object.values(portStates).filter(Boolean));
  const el   = document.getElementById('port-legend');
  if (!used.size) {
    el.innerHTML = '<span style="color:var(--text3);font-size:11px">Aucun preset appliqué</span>';
    return;
  }
  el.innerHTML = '';
  used.forEach(key => {
    const p     = key === 'unknown' ? PRESET_UNKNOWN : PRESETS[key];
    if (!p) return;
    const count = Object.values(portStates).filter(v => v === key).length;
    const item  = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:11px';
    item.innerHTML = `
      <span class="preset-dot" style="background:${p.color};width:8px;height:8px;border-radius:2px;display:inline-block;flex-shrink:0"></span>
      <span style="color:var(--text2)">${p.label}</span>
      <span style="color:var(--text3);margin-left:auto">${count} port${count > 1 ? 's' : ''}</span>
    `;
    el.appendChild(item);
  });
}

// ── Reset / payload ───────────────────────────────────────────────────────────

function resetPortStates() {
  portStates       = {};
  portDescriptions = {};
  portRawConfigs   = {};
  portLinkStats    = {};
  selectedPorts.clear();
}

// Met à jour un champ de la config brute d'un port et recalcule son état
function updatePortField(portNum, field, value) {
  if (!portRawConfigs[portNum]) {
    portRawConfigs[portNum] = { enabled: true, poe: false, pvid: 1, tagged: [], stp: false, storm_control: false, qos: false, description: '' };
  }
  portRawConfigs[portNum][field] = value;
  if (field === 'description') portDescriptions[portNum] = value;

  let detected = null;
  try { detected = detectPreset(portRawConfigs[portNum]); } catch (e) {}
  portStates[portNum] = portRawConfigs[portNum].enabled === false
    ? 'disabled'
    : (detected === null ? 'unknown' : detected);

  const sw = window.App && window.App.currentSw;
  renderPortGrid(getPortCount(sw ? sw.model : null));
}

// buildPortsPayload utilise portRawConfigs directement (plus de lookup de preset)
function buildPortsPayload(count) {
  const payload = {};
  for (let i = 1; i <= count; i++) {
    const raw = portRawConfigs[i];
    if (!raw) continue;
    payload[String(i)] = {
      enabled      : raw.enabled !== false,
      poe          : raw.poe || false,
      pvid         : raw.pvid || 1,
      tagged       : raw.tagged || [],
      description  : portDescriptions[i] || raw.description || '',
      storm_control: raw.storm_control || false,
      stp          : raw.stp || false,
      qos          : raw.qos || false,
    };
  }
  return payload;
}
