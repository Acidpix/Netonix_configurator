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

// Compare la config d'un port contre les presets chargés dynamiquement
function detectPreset(portCfg) {
  if (!portCfg || portCfg.enabled === false) return 'disabled';
  const portPvid   = portCfg.pvid ?? 1;
  const portTagged = (portCfg.tagged || []).slice().sort((a, b) => a - b);

  for (const [key, p] of Object.entries(PRESETS)) {
    if (p.pvid !== portPvid) continue;
    const presetTagged = (p.tagged || []).slice().sort((a, b) => a - b);
    if (JSON.stringify(presetTagged) === JSON.stringify(portTagged)) return key;
  }
  return null;
}
