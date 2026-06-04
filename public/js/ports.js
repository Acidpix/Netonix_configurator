'use strict';

let MODEL_PORTS = {};   // { key: portCount } — chargé depuis /api/models

let portStates       = {};  // { portNum: presetKey | 'unknown' | null }
let portDescriptions = {};  // { portNum: string }
let selectedPorts    = new Set();

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
    const p    = key === 'unknown' ? PRESET_UNKNOWN : (key ? PRESETS[key] : null);
    const desc = portDescriptions[i] || '';

    const cell = document.createElement('div');
    cell.id        = `port-${i}`;
    cell.className = 'port-cell' + (p ? ' ' + p.cls : '') + (selectedPorts.has(i) ? ' selected' : '');
    cell.onclick   = () => togglePort(i);
    cell.oncontextmenu = e => { e.preventDefault(); clearPortSelection(); };
    cell.onmouseenter  = e => showPortTooltip(e, i);
    cell.onmouseleave  = () => hidePortTooltip();
    cell.innerHTML = `
      ${p && p.poe && p.poe !== false ? '<div class="poe-dot" title="PoE actif"></div>' : ''}
      <div class="port-color-dot" style="background:${p ? p.color : 'var(--border2)'}"></div>
      <div class="port-num">${i}</div>
      <div class="port-label">${desc || (p ? p.label : 'Libre')}</div>
    `;
    grid.appendChild(cell);
  }
  renderPortLegend();
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function showPortTooltip(e, i) {
  const key  = portStates[i];
  const p    = key === 'unknown' ? PRESET_UNKNOWN : (key ? PRESETS[key] : null);
  const desc = portDescriptions[i] || '';
  const tt   = document.getElementById('port-tooltip');

  let html = `<div class="tt-title" style="color:${p ? p.color : 'var(--text2)'}">Port ${i} — ${p ? p.label : 'Libre'}</div>`;
  if (p && key !== 'unknown') {
    html += `<div class="tt-row"><span>VLAN natif</span><b>VLAN ${p.pvid}</b></div>`;
    html += `<div class="tt-row"><span>Taggés</span><b>${p.tagged && p.tagged.length ? p.tagged.join(', ') : '—'}</b></div>`;
    html += `<div class="tt-row"><span>PoE</span><b>${p.poe && p.poe !== false ? p.poe : 'OFF'}</b></div>`;
    if (p.storm_control) html += `<div class="tt-row"><span>Storm-control</span><b>ON</b></div>`;
    if (p.stp)           html += `<div class="tt-row"><span>STP portfast</span><b>ON</b></div>`;
    if (p.qos)           html += `<div class="tt-row"><span>QoS DSCP</span><b>ON</b></div>`;
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
    const key = portStates[[...selectedPorts][0]];
    key ? showPortDetail(key, [...selectedPorts]) : showFreePortDetail([...selectedPorts]);
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

function showPortDetail(key, ports) {
  const p     = key === 'unknown' ? PRESET_UNKNOWN : PRESETS[key];
  if (!p) return showFreePortDetail(ports);
  const panel = document.getElementById('detail-panel');
  panel.style.display = 'block';

  const singlePort = ports.length === 1 ? ports[0] : null;
  const curDesc    = singlePort ? (portDescriptions[singlePort] || '') : '';

  panel.innerHTML = `
    <div style="font-weight:600;font-size:13px;margin-bottom:8px;display:flex;align-items:center;gap:8px">
      <span class="preset-dot" style="background:${p.color};width:10px;height:10px;border-radius:2px;display:inline-block"></span>
      ${p.label} — Port${ports.length > 1 ? 's' : ''} ${ports.join(', ')}
    </div>
    ${key !== 'unknown' ? `
    <div class="detail-row"><span class="dl">VLAN natif (PVID)</span><span class="dv">VLAN ${p.pvid}</span></div>
    <div class="detail-row"><span class="dl">VLANs taggés</span><span class="dv">${p.tagged && p.tagged.length ? p.tagged.map(v => 'VLAN ' + v).join(', ') : '—'}</span></div>
    <div class="detail-row"><span class="dl">PoE</span><span class="dv" style="color:${p.poe && p.poe !== false ? 'var(--green)' : 'var(--text3)'}">${p.poe && p.poe !== false ? p.poe : 'OFF'}</span></div>
    ` : '<div style="font-size:11px;color:var(--text3);margin-bottom:8px">Configuration non reconnue comme preset standard.</div>'}
    ${singlePort !== null ? `
    <div class="detail-row" style="border:none;margin-top:6px">
      <span class="dl">Description</span>
      <input id="port-desc-input" value="${curDesc}" placeholder="(optionnel)"
        style="background:var(--bg4);border:1px solid var(--border);border-radius:4px;padding:3px 6px;font-size:11px;color:var(--text);width:140px"
        oninput="portDescriptions[${singlePort}] = this.value; renderPortGrid(getPortCount(window.App?.currentSw?.model))" />
    </div>
    ` : ''}
    <div style="margin-top:10px;display:flex;gap:6px">
      <button class="btn btn-ghost" onclick="clearPreset(${JSON.stringify(ports)})" style="font-size:11px">Effacer preset</button>
    </div>
  `;
}

function showFreePortDetail(ports) {
  const panel = document.getElementById('detail-panel');
  panel.style.display = 'block';
  const singlePort = ports.length === 1 ? ports[0] : null;
  const curDesc    = singlePort ? (portDescriptions[singlePort] || '') : '';

  panel.innerHTML = `
    <div style="font-weight:600;font-size:13px;margin-bottom:8px;color:var(--text2)">
      Port${ports.length > 1 ? 's' : ''} ${ports.join(', ')} — Libre
    </div>
    <div style="font-size:11px;color:var(--text3);margin-bottom:8px">Aucun preset appliqué. Choisissez un preset dans la liste.</div>
    ${singlePort !== null ? `
    <div class="detail-row" style="border:none">
      <span class="dl">Description</span>
      <input id="port-desc-input" value="${curDesc}" placeholder="(optionnel)"
        style="background:var(--bg4);border:1px solid var(--border);border-radius:4px;padding:3px 6px;font-size:11px;color:var(--text);width:140px"
        oninput="portDescriptions[${singlePort}] = this.value; renderPortGrid(getPortCount(window.App?.currentSw?.model))" />
    </div>
    ` : ''}
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
  ports.forEach(p => { portStates[p] = null; });
  const currentSw = window.App?.currentSw;
  renderPortGrid(getPortCount(currentSw?.model));
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
  selectedPorts.clear();
}

function buildPortsPayload(count) {
  const payload = {};
  for (let i = 1; i <= count; i++) {
    if (portStates[i] && portStates[i] !== 'unknown') {
      payload[String(i)] = { preset: portStates[i], description: portDescriptions[i] || null };
    }
  }
  return payload;
}
