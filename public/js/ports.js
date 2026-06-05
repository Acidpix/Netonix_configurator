'use strict';

let MODEL_PORTS = {};
let portStates       = {};
let portDescriptions = {};
let portRawConfigs   = {};
let portLinkStats    = {};
let selectedPorts    = new Set();

// ── Couleur des ports ─────────────────────────────────────────────────────────
let _portColorMode = 'preset'; // 'preset' | 'poe'

const _COLOR_MODE_LABELS = { preset: 'Mode: Preset', poe: 'Mode: PoE' };

function togglePortColorMode() {
  _portColorMode = _portColorMode === 'preset' ? 'poe' : 'preset';
  const btn = document.getElementById('btn-color-mode');
  if (btn) btn.textContent = _COLOR_MODE_LABELS[_portColorMode];
  const sw = window.App && window.App.currentSw;
  renderPortGrid(getPortCount(sw ? sw.model : null));
}

function _poeModeStyle(poe) {
  if (!poe || poe === false || poe === 'Off' || poe === 'false') {
    return { border: 'var(--border)', bg: 'var(--bg3)' };
  }
  const up = String(poe).toUpperCase();
  if (up === '48VH' || up === '48VHV') return { border: 'var(--red)',    bg: 'rgba(239,68,68,.08)' };
  if (up === '48V')                    return { border: 'var(--accent)',  bg: 'rgba(59,130,246,.08)' };
  if (up === '24V')                    return { border: 'var(--green)',   bg: 'rgba(34,197,94,.08)' };
  return { border: 'var(--amber)', bg: 'rgba(245,158,11,.08)' };
}

// ── Drag-sélection ────────────────────────────────────────────────────────────
let _dragSelecting = false;
let _dragStart     = null;
let _dragMoved     = false;

document.addEventListener('mouseup', function() {
  if (!_dragSelecting) return;
  _dragSelecting = false;
  if (!_dragMoved) {
    togglePort(_dragStart);
  } else {
    const arr = [...selectedPorts].sort((a, b) => a - b);
    if (arr.length === 1)    showPortDetail(portStates[arr[0]], arr);
    else if (arr.length > 1) showMultiPortDetail(arr);
  }
});

// ── Badges ────────────────────────────────────────────────────────────────────

function poeBadgeHtml(poe) {
  if (!poe || poe === false || poe === 'false' || poe === 'Off') return '';
  var label, cls;
  var up = String(poe).toUpperCase();
  if (up === '48VH' || up === '48VHV') { label = '48VH'; cls = 'badge-poe-red'; }
  else if (up === '48V')               { label = '48V';  cls = 'badge-poe-green'; }
  else if (up === '24V')               { label = '24V';  cls = 'badge-poe-green'; }
  else                                 { label = up;     cls = 'badge-poe-gray'; }
  return `<span class="port-badge ${cls}" title="PoE ${label}">${label}</span>`;
}

function linkBadgeHtml(portNum) {
  const s = portLinkStats[portNum];
  if (!s || !s.up) return '';
  if (s.speed >= 1000) return `<span class="port-badge badge-link-1g"   title="1 Gb/s">1G</span>`;
  if (s.speed >= 100)  return `<span class="port-badge badge-link-100m" title="100 Mb/s">100M</span>`;
  if (s.speed >= 10)   return `<span class="port-badge badge-link-10m"  title="10 Mb/s">10M</span>`;
  return `<span class="port-badge badge-link-1g" title="Lien actif">↑</span>`;
}

// ── Modèles ───────────────────────────────────────────────────────────────────

async function initModels() {
  const r    = await fetch('/api/models');
  const list = await r.json();
  MODEL_PORTS = {};
  list.forEach(m => { MODEL_PORTS[m.key] = m.port_count; });
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

    let cellLabel, poeSrc;
    if (p) {
      cellLabel = desc || p.label;
      poeSrc    = p.poe;
    } else if (raw) {
      cellLabel = desc || ('VLAN ' + (raw.pvid !== undefined ? raw.pvid : 1));
      poeSrc    = raw.poe;
    } else {
      cellLabel = desc || 'Libre';
      poeSrc    = null;
    }

    const isLinkUp = portLinkStats[i] && portLinkStats[i].up;

    const cell = document.createElement('div');
    cell.id = `port-${i}`;

    if (_portColorMode === 'poe') {
      const pStyle = _poeModeStyle(poeSrc);
      cell.className = 'port-cell' + (selectedPorts.has(i) ? ' selected' : '') + (isLinkUp ? ' link-up' : '');
      cell.style.borderColor = pStyle.border;
      cell.style.background  = pStyle.bg;
    } else {
      // Mode preset (défaut)
      cell.className = 'port-cell' + (p ? ' ' + p.cls : '') + (selectedPorts.has(i) ? ' selected' : '') + (isLinkUp ? ' link-up' : '');
      cell.style.borderColor = '';
      cell.style.background  = '';
    }
    cell.oncontextmenu = e => { e.preventDefault(); clearPortSelection(); };
    cell.onmouseenter  = e => showPortTooltip(e, i);
    cell.onmouseleave  = () => hidePortTooltip();

    // Drag-select
    const portNum = i;
    cell.onmousedown = function(e) {
      e.preventDefault();
      _dragSelecting = true;
      _dragStart     = portNum;
      _dragMoved     = false;
    };
    cell.addEventListener('mouseenter', function() {
      if (!_dragSelecting || portNum === _dragStart) return;
      _dragMoved = true;
      const a = Math.min(_dragStart, portNum);
      const b = Math.max(_dragStart, portNum);
      selectedPorts.clear();
      for (let n = a; n <= b; n++) selectedPorts.add(n);
      document.querySelectorAll('.port-cell').forEach(function(el, idx) {
        el.classList.toggle('selected', selectedPorts.has(idx + 1));
      });
    });

    // Drag & drop preset → port
    cell.ondragover = function(e) {
      if (!e.dataTransfer.types.includes('preset-key')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      this.classList.add('drag-over');
    };
    cell.ondragleave = function() { this.classList.remove('drag-over'); };
    cell.ondrop = function(e) {
      e.preventDefault();
      this.classList.remove('drag-over');
      const presetKey = e.dataTransfer.getData('preset-key');
      if (!presetKey || !PRESETS[presetKey]) return;
      // Si ce port est parmi les sélectionnés → applique sur toute la sélection
      // Sinon → applique uniquement sur ce port
      if (!selectedPorts.has(portNum) || selectedPorts.size === 0) {
        selectedPorts.clear();
        selectedPorts.add(portNum);
      }
      applyPreset(presetKey);
    };

    cell.innerHTML = `
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
  if (preset)   title = 'Port ' + i + ' — ' + preset.label;
  else if (raw) title = 'Port ' + i + ' — VLAN ' + (raw.pvid !== undefined ? raw.pvid : 1);
  else          title = 'Port ' + i + ' — Libre';

  const titleColor = preset ? preset.color : (raw ? 'var(--text)' : 'var(--text3)');
  let html = `<div class="tt-title" style="color:${titleColor}">${title}</div>`;

  const cfg = preset || raw;
  if (cfg) {
    const pvid   = preset ? preset.pvid   : (raw.pvid !== undefined ? raw.pvid : 1);
    const tagged = preset ? (preset.tagged || []) : (Array.isArray(raw.tagged) ? raw.tagged : []);
    const poe    = preset ? preset.poe    : raw.poe;
    html += `<div class="tt-row"><span>VLAN natif</span><b>VLAN ${pvid}</b></div>`;
    html += `<div class="tt-row"><span>Taggés</span><b>${tagged.length ? tagged.join(', ') : '—'}</b></div>`;
    html += `<div class="tt-row"><span>PoE</span><b>${poe && poe !== false ? String(poe).toUpperCase() : 'OFF'}</b></div>`;
    if (preset && preset.storm_control || raw && raw.storm_control) html += `<div class="tt-row"><span>Storm-control</span><b>ON</b></div>`;
    if (preset && preset.stp           || raw && raw.stp)           html += `<div class="tt-row"><span>STP portfast</span><b>ON</b></div>`;
    if (preset && preset.qos           || raw && raw.qos)           html += `<div class="tt-row"><span>QoS DSCP</span><b>ON</b></div>`;
  }

  const ls = portLinkStats[i];
  if (ls) {
    const linkLabel = !ls.up ? '↓ Déconnecté'
      : ls.speed >= 1000 ? '↑ 1 Gb/s'
      : ls.speed >= 100  ? '↑ 100 Mb/s'
      : ls.speed >= 10   ? '↑ 10 Mb/s' : '↑ Lien actif';
    html += `<div class="tt-row"><span>Lien</span><b>${linkLabel}</b></div>`;
  }
  if (desc) html += `<div class="tt-desc">${desc}</div>`;

  tt.innerHTML = html;
  const rect = e.currentTarget.getBoundingClientRect();
  tt.style.left    = (rect.right + 8) + 'px';
  tt.style.top     = Math.min(rect.top, window.innerHeight - 180) + 'px';
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

let _pendingPresetKey = null;

function applyPreset(key) {
  if (!selectedPorts.size) {
    toast('Sélectionnez d\'abord un ou plusieurs ports', 'info');
    return;
  }
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
      <td><span class="preset-dot" style="background:${cur ? cur.color : 'var(--border2)'}"></span> ${cur ? cur.label : 'Libre'}</td>
      <td style="color:var(--text3)">→</td>
      <td><span class="preset-dot" style="background:${p.color}"></span> ${p.label}</td>
    </tr>`;
  }).join('');
  content.innerHTML = `
    <p style="font-size:12px;color:var(--text2);margin-bottom:10px">Ces ports ont déjà une configuration. Confirmer le remplacement ?</p>
    <table style="width:100%;font-size:12px;border-collapse:collapse">
      <thead><tr style="color:var(--text3);font-size:10px;text-transform:uppercase">
        <th style="text-align:left;padding:4px 8px">Port</th>
        <th style="text-align:left;padding:4px 8px">Actuel</th>
        <th style="padding:4px 4px"></th>
        <th style="text-align:left;padding:4px 8px">Nouveau</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  document.getElementById('modal-confirm-preset').classList.add('open');
}

function confirmPresetApply() {
  document.getElementById('modal-confirm-preset').classList.remove('open');
  if (_pendingPresetKey) { doApplyPreset(_pendingPresetKey); _pendingPresetKey = null; }
}

function cancelPresetApply() {
  document.getElementById('modal-confirm-preset').classList.remove('open');
  _pendingPresetKey = null;
}

// ── Panneau de détail ─────────────────────────────────────────────────────────

function _inputStyle() {
  return 'background:var(--bg4);border:1px solid var(--border);border-radius:4px;padding:3px 6px;font-size:11px;color:var(--text)';
}

function _buildVlanRows(portNum, pvid, tagged) {
  const vlanList = typeof getVlans === 'function' ? getVlans() : [];
  const s = _inputStyle();
  if (!vlanList.length) {
    return `
      <div class="detail-row">
        <span class="dl">VLAN natif (PVID)</span>
        <input type="number" value="${pvid}" min="1" max="4094" style="${s};width:70px"
          onchange="updatePortField(${portNum},'pvid',+this.value)" />
      </div>
      <div class="detail-row">
        <span class="dl">VLANs taggés</span>
        <input type="text" value="${tagged.join(',')}" placeholder="10,20,30" style="${s};width:120px"
          onchange="updatePortField(${portNum},'tagged',this.value.split(',').map(v=>parseInt(v.trim())).filter(n=>n>0))" />
      </div>`;
  }

  const pvidOpts = vlanList.map(v =>
    `<option value="${v.id}" ${v.id === pvid ? 'selected' : ''}>${v.id} – ${v.name}</option>`
  ).join('');

  const tagLabel = tagged.length ? tagged.join(', ') : '— aucun';

  return `
    <div class="detail-row" style="align-items:center">
      <span class="dl">VLAN natif (PVID)</span>
      <select style="${s};max-width:140px" onchange="updatePortField(${portNum},'pvid',+this.value)">${pvidOpts}</select>
    </div>
    <div class="detail-row" style="align-items:center">
      <span class="dl">VLANs taggés</span>
      <button id="tagged-btn-${portNum}" class="btn btn-ghost"
        style="font-size:11px;padding:3px 8px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
        onclick="openTaggedPicker(event,${portNum})">${tagLabel}</button>
    </div>`;
}

function openTaggedPicker(event, portNum) {
  const vlanList = typeof getVlans === 'function' ? getVlans() : [];
  const tagged   = (portRawConfigs[portNum] && portRawConfigs[portNum].tagged) || [];

  let picker = document.getElementById('vlan-tagged-picker');
  if (!picker) {
    picker = document.createElement('div');
    picker.id = 'vlan-tagged-picker';
    picker.style.cssText = [
      'position:fixed;z-index:2000',
      'background:var(--bg3);border:1px solid var(--border2)',
      'border-radius:var(--r2);padding:10px 12px',
      'min-width:190px;max-height:260px;overflow-y:auto',
      'box-shadow:0 6px 24px rgba(0,0,0,.5)',
    ].join(';');
    document.body.appendChild(picker);
  }

  picker.innerHTML = `
    <div style="font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">VLANs taggés</div>
    ${vlanList.map(v => `
      <label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border)">
        <input type="checkbox" style="width:auto;flex-shrink:0" ${tagged.includes(v.id) ? 'checked' : ''}
          onchange="toggleTaggedVlan(${portNum},${v.id},this.checked)" />
        <span style="font-family:var(--mono);color:var(--text3);font-size:11px;min-width:28px">${v.id}</span>
        <span style="color:var(--text)">${v.name}</span>
      </label>`).join('')}
  `;

  // Positionnement sous le bouton
  const rect = event.currentTarget.getBoundingClientRect();
  const left = Math.min(rect.left, window.innerWidth - 210);
  const top  = rect.bottom + 6;
  picker.style.left    = left + 'px';
  picker.style.top     = top  + 'px';
  picker.style.display = 'block';

  // Fermeture au clic extérieur
  setTimeout(function() {
    function close(e) {
      if (!picker.contains(e.target) && e.target !== event.currentTarget) {
        picker.style.display = 'none';
        document.removeEventListener('mousedown', close);
      }
    }
    document.addEventListener('mousedown', close);
  }, 10);
}

function toggleTaggedVlan(portNum, vlanId, checked) {
  if (!portRawConfigs[portNum]) {
    portRawConfigs[portNum] = { enabled: true, poe: false, pvid: 1, tagged: [], stp: false, storm_control: false, qos: false, description: '' };
  }
  let tagged = Array.isArray(portRawConfigs[portNum].tagged) ? portRawConfigs[portNum].tagged.slice() : [];
  if (checked && !tagged.includes(vlanId)) tagged.push(vlanId);
  else if (!checked) tagged = tagged.filter(v => v !== vlanId);
  portRawConfigs[portNum].tagged = tagged.sort((a, b) => a - b);
  updatePortField(portNum, 'tagged', portRawConfigs[portNum].tagged);
  // Mettre à jour le label du bouton sans fermer le picker
  const btn = document.getElementById('tagged-btn-' + portNum);
  if (btn) btn.textContent = portRawConfigs[portNum].tagged.length
    ? portRawConfigs[portNum].tagged.join(', ')
    : '— aucun';
}

function showPortDetail(key, ports) {
  const panel = document.getElementById('detail-panel');
  panel.style.display = 'block';
  if (ports.length > 1) return showMultiPortDetail(ports);

  const portNum = ports[0];
  const preset  = key && key !== 'unknown' ? PRESETS[key] : null;
  const raw     = portRawConfigs[portNum] || null;
  const link    = portLinkStats[portNum]  || null;

  const cfg     = preset || raw || {};
  const pvid    = cfg.pvid    !== undefined ? cfg.pvid    : 1;
  const tagged  = Array.isArray(cfg.tagged) ? cfg.tagged  : [];
  const poe     = cfg.poe     !== undefined ? cfg.poe     : false;
  const enabled = cfg.enabled !== false;
  const sc      = !!cfg.storm_control;
  const stp     = !!cfg.stp;
  const qos     = !!cfg.qos;
  const desc    = portDescriptions[portNum] || cfg.description || '';
  const color   = preset ? preset.color : (raw ? 'var(--border)' : 'var(--border2)');
  const label   = preset ? preset.label : (raw ? 'VLAN ' + pvid : 'Libre');
  const poeVal  = poe === false ? 'false' : String(poe);

  let linkHtml = '<span style="color:var(--text3);font-size:10px">—</span>';
  if (link) {
    if (!link.up)            linkHtml = '<span style="color:var(--text3);font-size:11px">↓ Déconnecté</span>';
    else if (link.speed >= 1000) linkHtml = '<span style="color:var(--green);font-size:11px">↑ 1 Gb/s</span>';
    else if (link.speed >= 100)  linkHtml = '<span style="color:var(--amber);font-size:11px">↑ 100 Mb/s</span>';
    else if (link.speed >= 10)   linkHtml = '<span style="color:var(--red);font-size:11px">↑ 10 Mb/s</span>';
    else                         linkHtml = '<span style="color:var(--green);font-size:11px">↑ Lien actif</span>';
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

    <div class="detail-row" style="align-items:center">
      <span class="dl">PoE</span>
      <select style="${s};width:80px" onchange="updatePortField(${portNum},'poe',this.value==='false'?false:this.value)">
        <option value="false" ${poeVal==='false'?'selected':''}>OFF</option>
        <option value="24v"   ${poeVal==='24v'?'selected':''}>24V</option>
        <option value="48v"   ${poeVal==='48v'?'selected':''}>48V</option>
        <option value="48VH"  ${poeVal==='48VH'||poeVal==='48vHV'?'selected':''}>48VH</option>
      </select>
    </div>

    ${_buildVlanRows(portNum, pvid, tagged)}

    <div class="detail-row" style="border:none">
      <span class="dl">Description</span>
      <input value="${desc.replace(/"/g,'&quot;')}" placeholder="(optionnel)" style="${s};width:130px"
        oninput="updatePortField(${portNum},'description',this.value)" />
    </div>

    <div style="display:flex;gap:10px;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;cursor:pointer">
        <input type="checkbox" style="width:auto" ${sc?'checked':''} onchange="updatePortField(${portNum},'storm_control',this.checked)" /> Storm-ctrl
      </label>
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;cursor:pointer">
        <input type="checkbox" style="width:auto" ${stp?'checked':''} onchange="updatePortField(${portNum},'stp',this.checked)" /> STP
      </label>
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;cursor:pointer">
        <input type="checkbox" style="width:auto" ${qos?'checked':''} onchange="updatePortField(${portNum},'qos',this.checked)" /> QoS
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
