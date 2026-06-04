'use strict';

const MODEL_PORTS = { 'WS-8': 8, 'WS-12': 12, 'WS-26': 26, 'WISP-12': 12, 'WISP-16': 16 };

let portStates    = {};   // { portNum: presetKey | null }
let selectedPorts = new Set();

function getPortCount(model) {
  return MODEL_PORTS[model] || 12;
}

function renderPortGrid(count) {
  const grid = document.getElementById('port-grid');
  const cols  = count <= 8 ? 4 : count <= 12 ? 6 : 8;
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.innerHTML = '';

  for (let i = 1; i <= count; i++) {
    const key  = portStates[i];
    const p    = key ? PRESETS[key] : null;
    const cell = document.createElement('div');
    cell.id        = `port-${i}`;
    cell.className = 'port-cell' + (p ? ' ' + p.cls : '') + (selectedPorts.has(i) ? ' selected' : '');
    cell.onclick   = () => togglePort(i);
    cell.oncontextmenu = e => { e.preventDefault(); clearPortSelection(); };
    cell.innerHTML = `
      ${p && p.poe ? '<div class="poe-dot" title="PoE actif"></div>' : ''}
      <div class="port-icon">${p ? p.icon : '🔲'}</div>
      <div class="port-num">${i}</div>
      <div class="port-label">${p ? p.label : 'Libre'}</div>
    `;
    grid.appendChild(cell);
  }
  renderPortLegend();
}

function togglePort(i) {
  if (selectedPorts.has(i)) selectedPorts.delete(i);
  else selectedPorts.add(i);

  document.querySelectorAll('.port-cell').forEach((el, idx) => {
    el.classList.toggle('selected', selectedPorts.has(idx + 1));
  });

  if (selectedPorts.size === 1) {
    const key = portStates[[...selectedPorts][0]];
    key ? showPortDetail(key, [...selectedPorts]) : hidePortDetail();
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

function applyPreset(key) {
  if (!selectedPorts.size) {
    toast('Sélectionnez d\'abord un ou plusieurs ports', 'info');
    return;
  }
  selectedPorts.forEach(p => { portStates[p] = key; });
  const currentSw = window.App?.currentSw;
  renderPortGrid(getPortCount(currentSw?.model));
  showPortDetail(key, [...selectedPorts]);
  toast(`"${PRESETS[key].label}" appliqué sur ${selectedPorts.size} port${selectedPorts.size > 1 ? 's' : ''}`, 'ok');
}

function clearPreset(ports) {
  ports.forEach(p => { portStates[p] = null; });
  const currentSw = window.App?.currentSw;
  renderPortGrid(getPortCount(currentSw?.model));
  hidePortDetail();
  clearPortSelection();
}

function showPortDetail(key, ports) {
  const p     = PRESETS[key];
  const panel = document.getElementById('detail-panel');
  panel.className = 'visible';
  panel.style.display = 'block';
  panel.innerHTML = `
    <div style="font-weight:600;font-size:13px;margin-bottom:8px;color:${p.color}">${p.icon} ${p.label} — Port${ports.length > 1 ? 's' : ''} ${ports.join(', ')}</div>
    <div class="detail-row"><span class="dl">VLAN natif (PVID)</span><span class="dv">VLAN ${p.pvid}</span></div>
    <div class="detail-row"><span class="dl">VLANs taggés</span><span class="dv">${p.tagged.length ? p.tagged.map(v => 'VLAN ' + v).join(', ') : '—'}</span></div>
    <div class="detail-row"><span class="dl">PoE</span><span class="dv" style="color:${p.poe ? 'var(--green)' : 'var(--text3)'}">${p.poe ? '✓ Activé' : '✗ Désactivé'}</span></div>
    <div style="margin-top:8px;font-size:11px;color:var(--text3)">${p.desc}</div>
    <div style="margin-top:10px">
      <button class="btn btn-ghost" onclick="clearPreset(${JSON.stringify(ports)})" style="font-size:11px">Effacer preset</button>
    </div>
  `;
}

function showMultiPortDetail(ports) {
  const panel = document.getElementById('detail-panel');
  panel.className = 'visible';
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

function renderPortLegend() {
  const used = new Set(Object.values(portStates).filter(Boolean));
  const el   = document.getElementById('port-legend');
  if (!used.size) {
    el.innerHTML = '<span style="color:var(--text3);font-size:11px">Aucun preset appliqué</span>';
    return;
  }
  el.innerHTML = '';
  used.forEach(key => {
    const p     = PRESETS[key];
    const count = Object.values(portStates).filter(v => v === key).length;
    const item  = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:11px';
    item.innerHTML = `
      <span style="font-size:14px">${p.icon}</span>
      <span style="color:var(--text2)">${p.label}</span>
      <span style="color:var(--text3);margin-left:auto">${count} port${count > 1 ? 's' : ''}</span>
    `;
    el.appendChild(item);
  });
}

function resetPortStates() {
  portStates = {};
  selectedPorts.clear();
}

function buildPortsPayload(count) {
  const payload = {};
  for (let i = 1; i <= count; i++) {
    if (portStates[i]) payload[String(i)] = portStates[i];
  }
  return payload;
}
