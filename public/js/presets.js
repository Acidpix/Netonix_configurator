'use strict';

// Chargé depuis /api/presets au démarrage via initPresets()
let PRESETS = {};

const PRESET_UNKNOWN = {
  label        : 'Inconnu',
  cls          : 'p-unknown',
  color        : 'var(--text3)',
  poe          : false,
  pvid         : null,
  tagged       : [],
  description  : '',
  storm_control: false,
  stp          : false,
  qos          : false,
};

async function initPresets() {
  const r    = await fetch('/api/presets');
  const list = await r.json();
  PRESETS    = {};
  list.forEach(p => { PRESETS[p.key] = p; });
  renderPresetButtons();
}

// Génère dynamiquement les boutons preset dans #preset-grid
function renderPresetButtons() {
  const grid = document.getElementById('preset-grid');
  if (!grid) return;
  grid.innerHTML = '';
  Object.entries(PRESETS).forEach(([key, p]) => {
    const btn = document.createElement('button');
    btn.className = `preset-btn preset-${key}`;
    btn.onclick = () => applyPreset(key);
    btn.innerHTML = `
      <span class="preset-dot" style="background:${p.color}"></span>
      ${p.label}
    `;
    grid.appendChild(btn);
  });
}

// Heuristique : devine le preset d'un port depuis sa config JSON Netonix
function detectPreset(portCfg) {
  if (!portCfg || portCfg.enabled === false) return 'disabled';
  const { pvid = 1, tagged = [] } = portCfg;
  if (tagged.length > 3) return 'ap';
  if (tagged.length > 0) return 'uplink';
  if (pvid === 30)        return 'cam';
  if (pvid === 40)        return 'voip';
  if (pvid === 20)        return 'server';
  return null;
}
