'use strict';

let MODEL_PORTS = {};
let MODEL_POE   = {};   // { modelKey: { '24v':[ports], '48v':[ports], '48VH':[ports] } }
let portStates       = {};
let portDescriptions = {};
let portRawConfigs   = {};
let portLinkStats    = {};
let selectedPorts    = new Set();
let unlockedPorts    = new Set();   // ports HS déverrouillés manuellement (session)

// ── Verrou ports HS (hors service) ────────────────────────────────────────────
// Un port nommé "HS" est protégé : il faut le déverrouiller (clic) avant toute modif.
function isPortNameHS(name) {
  return String(name || '').trim().toUpperCase() === 'HS';
}
function isPortLocked(i) {
  return isPortNameHS(portDescriptions[i]) && !unlockedPorts.has(i);
}
function unlockPort(i) {
  unlockedPorts.add(i);
  const sw = window.App && window.App.currentSw;
  renderPortGrid(getPortCount(sw ? sw.model : null));
  showPortDetail(portStates[i], [i]);
}

// ── Couleur des ports ─────────────────────────────────────────────────────────
let _portColorMode = 'preset'; // 'preset' | 'poe'
let _portViewMode  = 'grid';   // 'grid'   | 'table'

const _COLOR_MODE_LABELS = { preset: 'Mode: Preset', poe: 'Mode: PoE' };

function togglePortColorMode() {
  _portColorMode = _portColorMode === 'preset' ? 'poe' : 'preset';
  const btn = document.getElementById('btn-color-mode');
  if (btn) btn.textContent = _COLOR_MODE_LABELS[_portColorMode];
  const sw = window.App && window.App.currentSw;
  renderPortGrid(getPortCount(sw ? sw.model : null));
}

function togglePortViewMode() {
  _portViewMode = _portViewMode === 'grid' ? 'table' : 'grid';
  const btn = document.getElementById('btn-view-mode');
  if (btn) btn.textContent = _portViewMode === 'grid' ? '☰ Tableau' : '⊞ Grille';
  const hint = document.getElementById('port-grid-hint');
  if (hint) hint.style.display = _portViewMode === 'table' ? 'none' : '';
  const sw = window.App && window.App.currentSw;
  renderPortGrid(getPortCount(sw ? sw.model : null));
}

function _poeModeBackground(poe) {
  if (!poe || poe === false || poe === 'Off' || poe === 'false') return 'var(--bg3)';
  const up = String(poe).toUpperCase();
  if (up === '48VH' || up === '48VHV') return 'rgba(239,68,68,.18)';   // rouge
  if (up === '48V')                    return 'rgba(34,197,94,.18)';    // vert
  if (up === '24V')                    return 'rgba(245,158,11,.18)';   // jaune
  return 'var(--bg3)';
}

// ── Drag-sélection ────────────────────────────────────────────────────────────
let _dragSelecting = false;
let _dragStart     = null;

document.addEventListener('mouseup', function() {
  if (!_dragSelecting) return;
  _dragSelecting = false;
  togglePort(_dragStart);   // sélection simple : un seul port à la fois
});

// ── Badges ────────────────────────────────────────────────────────────────────

function poeBadgeHtml(poe) {
  if (!poe || poe === false || poe === 'false' || poe === 'Off')
    return `<span class="port-badge badge-poe-gray" title="PoE désactivé">Off</span>`;
  var up = String(poe).toUpperCase();
  var label, cls;
  if (up === '48VH' || up === '48VHV') { label = '48VH'; cls = 'badge-poe-red'; }
  else if (up === '48V')               { label = '48V';  cls = 'badge-poe-green'; }
  else if (up === '24V')               { label = '24V';  cls = 'badge-poe-amber'; }
  else                                 { label = up;     cls = 'badge-poe-gray'; }
  return `<span class="port-badge ${cls}" title="PoE ${label}">${label}</span>`;
}

function linkBadgeHtml(portNum) {
  const s = portLinkStats[portNum];
  if (!s)      return `<span class="port-badge badge-link-down" title="Lien inconnu">—</span>`;
  if (!s.up)   return `<span class="port-badge badge-link-down" title="Déconnecté">↓</span>`;
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
  MODEL_POE   = {};
  list.forEach(m => {
    MODEL_PORTS[m.key] = m.port_count;
    MODEL_POE[m.key]   = {
      '24v' : parseRanges(m.poe_24v_ports || '', { max: m.port_count }),
      '48v' : parseRanges(m.poe_48v_ports || '', { max: m.port_count }),
      '48VH': parseRanges(m.poe_vh_ports  || '', { max: m.port_count }),
    };
  });
  populateModelSelect();
}

const _POE_ORDER = ['24v', '48v', '48VH'];  // puissance croissante

// Normalise une valeur PoE vers une clé canonique : '24v' | '48v' | '48VH' | false (Off).
function poeKey(poe) {
  if (poe === false || poe === null || poe === undefined) return false;
  const up = String(poe).toUpperCase();
  if (up === 'OFF' || up === 'FALSE' || up === '') return false;
  if (up.indexOf('VH') !== -1) return '48VH';
  if (up === '48V') return '48v';
  if (up === '24V') return '24v';
  return false;
}

// Vrai si le port supporte ce type de PoE pour ce modèle (modèle inconnu = pas de restriction).
function portSupportsPoeType(model, portNum, key) {
  const caps = MODEL_POE[model];
  if (!caps) return true;
  const arr = caps[key];
  return Array.isArray(arr) && arr.indexOf(portNum) !== -1;
}

// Résout le PoE effectif d'un port : rétrograde vers le type inférieur supporté, sinon Off.
function resolvePoeForPort(model, portNum, requested) {
  const key = poeKey(requested);
  if (!key) return { poe: false, changed: false };
  if (portSupportsPoeType(model, portNum, key)) return { poe: requested, changed: false };
  const idx = _POE_ORDER.indexOf(key);
  for (let i = idx - 1; i >= 0; i--) {
    if (portSupportsPoeType(model, portNum, _POE_ORDER[i])) return { poe: _POE_ORDER[i], changed: true };
  }
  return { poe: false, changed: true };
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

// WS-8 / WS-10 / WS-12 : ports disposés comme sur le switch physique
// (impairs en haut, pairs en bas, sur 2 rangées).
function isPhysicalLayout(model) {
  return /^WS-?(8|10|12)\b/i.test(String(model || ''));
}

// ── Rendu tableau ──────────────────────────────────────────────────────────────

function _renderPortTable(count) {
  const grid = document.getElementById('port-grid');
  grid.style.gridTemplateColumns = '';
  grid.innerHTML = '';

  const table = document.createElement('table');
  table.className = 'port-table';
  table.innerHTML = `<thead><tr>
    <th style="width:54px">#</th>
    <th>Preset / Config</th>
    <th style="width:100px">VLAN natif</th>
    <th style="width:140px">VLANs taggés</th>
    <th style="width:68px">PoE</th>
    <th style="width:90px">Lien</th>
  </tr></thead>`;

  const tbody = document.createElement('tbody');
  for (let i = 1; i <= count; i++) {
    const key  = portStates[i];
    const p    = key && key !== 'unknown' ? PRESETS[key] : null;
    const raw  = portRawConfigs[i] || null;
    const desc = portDescriptions[i] || '';
    const cfg  = p || raw || {};
    const pvid   = raw && raw.pvid !== undefined ? raw.pvid : (p ? p.pvid : 1);
    const tagged = Array.isArray(raw && raw.tagged) ? raw.tagged : (p ? (p.tagged || []) : []);
    const poe    = raw ? raw.poe : (p ? p.poe : false);
    const ls     = portLinkStats[i];

    const locked = isPortLocked(i);
    let presetHtml;
    if (locked) {
      presetHtml = `<span class="port-badge badge-lock" style="display:inline-block" title="Port hors service — verrouillé">🔒 HS</span>`;
    } else if (p) {
      presetHtml = `<span class="preset-dot" style="background:${p.color}"></span> <span style="font-weight:500">${desc || p.label}</span>`;
    } else if (raw) {
      presetHtml = `<span class="preset-dot" style="background:var(--border2)"></span> <span style="color:var(--text2)">${desc || 'VLAN&nbsp;' + (raw.pvid || 1)}</span>`;
    } else {
      presetHtml = `<span style="color:var(--text3)">— Libre</span>`;
    }

    let linkHtml;
    if (!ls)               linkHtml = `<span style="color:var(--text3)">—</span>`;
    else if (!ls.up)       linkHtml = `<span style="color:var(--text3)">↓ Déco.</span>`;
    else if (ls.speed >= 1000) linkHtml = `<span style="color:var(--green)">↑ 1 Gb/s</span>`;
    else if (ls.speed >= 100)  linkHtml = `<span style="color:var(--amber)">↑ 100 Mb/s</span>`;
    else if (ls.speed >= 10)   linkHtml = `<span style="color:var(--red)">↑ 10 Mb/s</span>`;
    else                       linkHtml = `<span style="color:var(--green)">↑ Actif</span>`;

    const poeNorm = poe && poe !== false && poe !== 'false' && poe !== 'Off';
    const poeHtml = poeNorm
      ? `<span style="color:var(--green);font-family:var(--mono);font-size:11px">${String(poe).toUpperCase()}</span>`
      : `<span style="color:var(--text3)">—</span>`;

    const tr = document.createElement('tr');
    const cls = key && key !== 'unknown' && PRESETS[key] ? ' p-' + key : (key === 'unknown' ? ' p-unknown' : '');
    tr.className = 'port-row' + cls + (selectedPorts.has(i) ? ' selected' : '') + (locked ? ' locked' : '');
    tr.innerHTML = `
      <td style="font-family:var(--mono);font-weight:700;font-size:13px">${i}</td>
      <td>${presetHtml}</td>
      <td style="font-family:var(--mono);color:var(--text2);font-size:11px">${pvid}</td>
      <td style="font-family:var(--mono);color:var(--text2);font-size:11px">${
        tagged.length === 0 ? '<span style="color:var(--text3)">—</span>' : formatRanges(tagged)
      }</td>
      <td>${poeHtml}</td>
      <td style="font-size:11px">${linkHtml}</td>
    `;

    const portNum = i;
    tr.onmousedown    = function(e) { e.preventDefault(); _dragSelecting = true; _dragStart = portNum; };
    tr.oncontextmenu  = function(e) { e.preventDefault(); clearPortSelection(); };
    tr.onmouseenter   = function(e) { showPortTooltip(e, portNum); };
    tr.onmouseleave   = function()  { hidePortTooltip(); };
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  grid.appendChild(table);
  renderPortLegend();
}

// ── Rendu grille ──────────────────────────────────────────────────────────────

function renderPortGrid(count) {
  if (_portViewMode === 'table') return _renderPortTable(count);

  const grid     = document.getElementById('port-grid');
  const sw       = window.App && window.App.currentSw;
  const model    = sw ? sw.model : null;
  const isMobile = window.matchMedia('(max-width: 768px)').matches;

  // Disposition physique (WS-8/10/12) : impairs en haut, pairs en bas.
  // minmax(...) → colonnes pleine largeur sur desktop, défilables sur mobile.
  let order;
  if (isPhysicalLayout(model)) {
    const pairs = Math.ceil(count / 2);
    grid.style.gridTemplateColumns = `repeat(${pairs}, minmax(${isMobile ? 58 : 48}px, 1fr))`;
    const odd = [], even = [];
    for (let n = 1; n <= count; n++) (n % 2 ? odd : even).push(n);
    order = odd.concat(even);
  } else {
    const cols = isMobile ? Math.min(count, 4)
               : count <= 6 ? 6 : count <= 8 ? 4 : count <= 12 ? 6 : count <= 16 ? 8 : 9;
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    order = [];
    for (let n = 1; n <= count; n++) order.push(n);
  }
  grid.innerHTML = '';

  for (const i of order) {
    const key  = portStates[i];
    const p    = key && key !== 'unknown' ? PRESETS[key] : null;
    const raw  = portRawConfigs[i] || null;
    const desc = portDescriptions[i] || '';

    let cellLabel;
    if (p) {
      cellLabel = desc || p.label;
    } else if (raw) {
      cellLabel = desc || ('VLAN ' + (raw.pvid !== undefined ? raw.pvid : 1));
    } else {
      cellLabel = desc || 'Libre';
    }
    // PoE réel du port (raw) prioritaire — le preset n'est qu'une étiquette VLAN,
    // son PoE par défaut ne reflète pas forcément l'état réel du port.
    const poeSrc = raw ? raw.poe : (p ? p.poe : null);

    const isLinkUp = portLinkStats[i] && portLinkStats[i].up;
    const locked   = isPortLocked(i);
    const lockCls  = locked ? ' locked' : '';

    const cell = document.createElement('div');
    cell.id = `port-${i}`;

    if (_portColorMode === 'poe') {
      cell.className     = 'port-cell' + (selectedPorts.has(i) ? ' selected' : '') + (isLinkUp ? ' link-up' : '') + lockCls;
      cell.style.background  = locked ? '' : _poeModeBackground(poeSrc);
      cell.style.borderColor = '';  // géré par .link-up
    } else {
      // Mode preset (défaut)
      cell.className     = 'port-cell' + (p ? ' ' + p.cls : '') + (selectedPorts.has(i) ? ' selected' : '') + (isLinkUp ? ' link-up' : '') + lockCls;
      cell.style.background  = '';
      cell.style.borderColor = '';  // géré par .link-up
    }
    cell.oncontextmenu = e => { e.preventDefault(); clearPortSelection(); };
    cell.onmouseenter  = e => showPortTooltip(e, i);
    cell.onmouseleave  = () => hidePortTooltip();

    // Sélection simple au clic (un seul port à la fois)
    const portNum = i;
    cell.onmousedown = function(e) {
      e.preventDefault();
      _dragSelecting = true;
      _dragStart     = portNum;
    };

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
      if (isPortLocked(portNum)) {
        toast(`Port ${portNum} verrouillé (HS) — déverrouillez-le d'abord`, 'info');
        return;
      }
      // Applique uniquement sur ce port (sélection simple)
      selectedPorts.clear();
      selectedPorts.add(portNum);
      applyPreset(presetKey);
    };

    cell.innerHTML = `
      <div class="port-num">${i}</div>
      <div class="port-label">${cellLabel}</div>
      <div class="port-badges">${locked ? '<span class="port-badge badge-lock" title="Port hors service — verrouillé">🔒 HS</span>' : poeBadgeHtml(poeSrc) + linkBadgeHtml(i)}</div>
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
  if (isPortLocked(i)) html += `<div class="tt-row"><span>🔒 État</span><b style="color:var(--amber)">HS — verrouillé</b></div>`;

  // Config réelle du port (raw) prioritaire ; le preset n'est qu'un fallback d'étiquette.
  const cfg = raw || preset;
  if (cfg) {
    const pvid   = cfg.pvid !== undefined ? cfg.pvid : 1;
    const tagged = Array.isArray(cfg.tagged) ? cfg.tagged : [];
    const poe    = cfg.poe;
    html += `<div class="tt-row"><span>VLAN natif</span><b>VLAN ${pvid}</b></div>`;
    html += `<div class="tt-row"><span>Taggés</span><b>${tagged.length ? formatRanges(tagged) : '—'}</b></div>`;
    html += `<div class="tt-row"><span>PoE</span><b>${poe && poe !== false ? String(poe).toUpperCase() : 'OFF'}</b></div>`;
    if (cfg.storm_control) html += `<div class="tt-row"><span>Storm-control</span><b>ON</b></div>`;
    if (cfg.stp)           html += `<div class="tt-row"><span>STP portfast</span><b>ON</b></div>`;
    if (cfg.qos)           html += `<div class="tt-row"><span>QoS DSCP</span><b>ON</b></div>`;
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
  const x = Math.min(e.clientX + 14, window.innerWidth - 240);
  const y = Math.max(10, Math.min(e.clientY - 20, window.innerHeight - 200));
  tt.style.left    = x + 'px';
  tt.style.top     = y + 'px';
  tt.style.display = 'block';
}

function hidePortTooltip() {
  document.getElementById('port-tooltip').style.display = 'none';
}

// ── Sélection ─────────────────────────────────────────────────────────────────

// Sélection simple : un seul port à la fois (re-cliquer le port sélectionné le désélectionne).
function togglePort(i) {
  const wasOnlySelected = selectedPorts.size === 1 && selectedPorts.has(i);
  selectedPorts.clear();
  if (!wasOnlySelected) selectedPorts.add(i);

  document.querySelectorAll('.port-cell, .port-row').forEach((el, idx) => {
    el.classList.toggle('selected', selectedPorts.has(idx + 1));
  });

  if (selectedPorts.size === 1) showPortDetail(portStates[i], [i]);
  else hidePortDetail();
}

function clearPortSelection() {
  selectedPorts.clear();
  document.querySelectorAll('.port-cell, .port-row').forEach(el => el.classList.remove('selected'));
  hidePortDetail();
}

// ── Application de preset ─────────────────────────────────────────────────────

let _pendingPresetKey = null;

function applyPreset(key) {
  if (!selectedPorts.size) {
    toast('Sélectionnez d\'abord un port', 'info');
    return;
  }
  const locked = [...selectedPorts].filter(isPortLocked);
  if (locked.length) {
    toast(`Port ${locked.join(', ')} verrouillé (HS) — déverrouillez-le d'abord`, 'info');
    return;
  }
  doApplyPreset(key);
}

function doApplyPreset(key) {
  const p         = PRESETS[key];
  const count     = selectedPorts.size;
  const currentSw = window.App?.currentSw;
  const model     = currentSw?.model;
  const downgraded = [];

  selectedPorts.forEach(portNum => {
    portStates[portNum] = key;

    // Chaque type de PoE n'est appliqué que sur les ports capables — sinon rétrogradé.
    const res = resolvePoeForPort(model, portNum, p.poe);
    if (res.changed) downgraded.push(portNum);

    portRawConfigs[portNum] = {
      enabled      : p.enabled !== false,
      poe          : res.poe,
      pvid         : p.pvid !== undefined ? p.pvid : 1,
      tagged       : Array.isArray(p.tagged) ? p.tagged.slice() : [],
      stp          : !!p.stp,
      storm_control: !!p.storm_control,
      qos          : !!p.qos,
      description  : portDescriptions[portNum] || '',
    };
  });

  renderPortGrid(getPortCount(model));
  clearPortSelection();
  if (window.markConfigDirty) markConfigDirty();
  toast(`"${p.label}" appliqué sur ${count} port${count > 1 ? 's' : ''}`, 'ok');
  if (downgraded.length) {
    toast(`PoE non supporté sur le(s) port(s) ${formatRanges(downgraded)} → rétrogradé`, 'info');
  }
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
        <input type="text" value="${formatRanges(tagged)}" placeholder="10,20,230-240" style="${s};width:140px"
          onchange="updatePortField(${portNum},'tagged',parseRanges(this.value))" />
      </div>`;
  }

  const pvidOpts = vlanList.map(v =>
    `<option value="${v.id}" ${v.id === pvid ? 'selected' : ''}>${v.id} – ${v.name}</option>`
  ).join('');

  const tagLabel = tagged.length ? formatRanges(tagged) : '— aucun';

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
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
      <span style="font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">VLANs taggés</span>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:8px">
      <button class="btn btn-ghost" style="flex:1;font-size:10px;padding:3px 6px" onclick="setAllTaggedVlans(${portNum},true)">Tout cocher</button>
      <button class="btn btn-ghost" style="flex:1;font-size:10px;padding:3px 6px" onclick="setAllTaggedVlans(${portNum},false)">Tout décocher</button>
    </div>
    ${vlanList.map(v => `
      <label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border)">
        <input type="checkbox" data-vlan="${v.id}" style="width:auto;flex-shrink:0" ${tagged.includes(v.id) ? 'checked' : ''}
          onchange="toggleTaggedVlan(${portNum},${v.id},this.checked)" />
        <span style="font-family:var(--mono);color:var(--text3);font-size:11px;min-width:28px">${v.id}</span>
        <span style="color:var(--text)">${v.name}</span>
      </label>`).join('')}
  `;

  // Positionnement — sous le bouton par défaut, au-dessus si ça dépasse du bas
  const rect      = event.currentTarget.getBoundingClientRect();
  const maxH      = 280;
  const left      = Math.min(rect.left, window.innerWidth - 210);
  const topBelow  = rect.bottom + 6;
  const topAbove  = rect.top - maxH - 6;
  const top       = topBelow + maxH > window.innerHeight ? Math.max(10, topAbove) : topBelow;
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
  _updateTaggedBtnLabel(portNum);
}

// Coche ou décoche tous les VLANs taggés du port d'un seul coup.
function setAllTaggedVlans(portNum, checked) {
  if (!portRawConfigs[portNum]) {
    portRawConfigs[portNum] = { enabled: true, poe: false, pvid: 1, tagged: [], stp: false, storm_control: false, qos: false, description: '' };
  }
  const vlanList = typeof getVlans === 'function' ? getVlans() : [];
  portRawConfigs[portNum].tagged = checked ? vlanList.map(v => v.id).sort((a, b) => a - b) : [];
  updatePortField(portNum, 'tagged', portRawConfigs[portNum].tagged);
  _updateTaggedBtnLabel(portNum);

  // Reflète l'état sur les cases du picker sans le fermer
  const picker = document.getElementById('vlan-tagged-picker');
  if (picker) picker.querySelectorAll('input[type=checkbox][data-vlan]').forEach(cb => { cb.checked = checked; });
}

function _updateTaggedBtnLabel(portNum) {
  const btn = document.getElementById('tagged-btn-' + portNum);
  if (btn) btn.textContent = portRawConfigs[portNum].tagged.length
    ? formatRanges(portRawConfigs[portNum].tagged)
    : '— aucun';
}

function showPortDetail(key, ports) {
  const panel = document.getElementById('detail-panel');
  panel.style.display = 'block';
  if (ports.length > 1) return showMultiPortDetail(ports);

  const portNum = ports[0];

  // Port hors service (HS) verrouillé : on n'affiche pas les contrôles tant qu'il n'est pas déverrouillé.
  if (isPortLocked(portNum)) {
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:18px">🔒</span>
        <span style="font-weight:600;font-size:13px;color:var(--amber)">Port ${portNum} — Hors service (HS)</span>
        <button class="detail-close" style="margin-left:auto" onclick="clearPortSelection()" title="Fermer">✕</button>
      </div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:12px">
        Ce port est marqué <b>HS</b> et verrouillé pour éviter toute modification accidentelle.
        Déverrouillez-le pour modifier sa configuration.
      </div>
      <button class="btn btn-primary" style="font-size:12px" onclick="unlockPort(${portNum})">🔓 Déverrouiller ce port</button>
    `;
    return;
  }

  const preset  = key && key !== 'unknown' ? PRESETS[key] : null;
  const raw     = portRawConfigs[portNum] || null;
  const link    = portLinkStats[portNum]  || null;
  const swDetail = window.App && window.App.currentSw;
  const _model   = swDetail ? swDetail.model : null;
  const sup24    = portSupportsPoeType(_model, portNum, '24v');
  const sup48    = portSupportsPoeType(_model, portNum, '48v');
  const vhOk     = portSupportsPoeType(_model, portNum, '48VH');

  // Config réelle du port (raw) prioritaire pour les valeurs éditables ;
  // le preset ne sert qu'au libellé/couleur ci-dessous.
  const cfg     = raw || preset || {};
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
      <button class="detail-close" onclick="clearPortSelection()" title="Fermer">✕</button>
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
      <select style="${s};width:150px" onchange="updatePortField(${portNum},'poe',this.value==='false'?false:this.value)">
        <option value="false" ${poeVal==='false'?'selected':''}>OFF</option>
        <option value="24v"   ${poeVal==='24v'?'selected':''} ${sup24?'':'disabled'}>24V${sup24?'':' (non supporté)'}</option>
        <option value="48v"   ${poeVal==='48v'?'selected':''} ${sup48?'':'disabled'}>48V${sup48?'':' (non supporté)'}</option>
        <option value="48VH"  ${poeVal==='48VH'||poeVal==='48vHV'?'selected':''} ${vhOk?'':'disabled'}>48VH${vhOk?'':' (non supporté)'}</option>
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
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <span style="font-weight:600;font-size:13px">${ports.length} ports sélectionnés : ${ports.join(', ')}</span>
      <button class="detail-close" style="margin-left:auto" onclick="clearPortSelection()" title="Fermer">✕</button>
    </div>
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
  unlockedPorts.clear();
}

function updatePortField(portNum, field, value) {
  if (!portRawConfigs[portNum]) {
    portRawConfigs[portNum] = { enabled: true, poe: false, pvid: 1, tagged: [], stp: false, storm_control: false, qos: false, description: '' };
  }

  // PoE non supporté sur ce port → rétrogradé vers le type inférieur supporté (ou Off).
  let poeDowngraded = false;
  if (field === 'poe') {
    const sw  = window.App && window.App.currentSw;
    const res = resolvePoeForPort(sw ? sw.model : null, portNum, value);
    if (res.changed) { value = res.poe; poeDowngraded = true; }
  }

  portRawConfigs[portNum][field] = value;
  if (window.markConfigDirty) markConfigDirty();
  if (field === 'description') {
    portDescriptions[portNum] = value;
    // L'utilisateur tape "HS" sur un port en cours d'édition : on le garde déverrouillé
    // pour cette session (le verrou se réengagera au prochain chargement de la config).
    if (isPortNameHS(value)) unlockedPorts.add(portNum);
  }

  let detected = null;
  try { detected = detectPreset(portRawConfigs[portNum]); } catch (e) {}
  portStates[portNum] = portRawConfigs[portNum].enabled === false
    ? 'disabled'
    : (detected === null ? 'unknown' : detected);

  const sw = window.App && window.App.currentSw;
  renderPortGrid(getPortCount(sw ? sw.model : null));

  if (poeDowngraded) {
    toast(`Port ${portNum} ne supporte pas ce PoE → rétrogradé`, 'info');
    showPortDetail(portStates[portNum], [portNum]);  // rafraîchit le select PoE
  }
}

function buildPortsPayload(count) {
  const payload = {};
  for (let i = 1; i <= count; i++) {
    const raw = portRawConfigs[i];
    if (!raw) continue;
    if (isPortLocked(i)) continue;   // port HS verrouillé → jamais modifié par un push
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
