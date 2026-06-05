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
    btn.draggable = true;
    btn.title = 'Cliquer ou glisser sur un port';
    btn.onclick = () => applyPreset(key);
    btn.ondragstart = (e) => {
      e.dataTransfer.setData('preset-key', key);
      e.dataTransfer.effectAllowed = 'copy';
    };
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
  const portPvid = portCfg.pvid !== undefined ? portCfg.pvid : 1;

  // tagged peut être un tableau, un objet {vlanId: true} ou une chaîne
  let rawTagged = portCfg.tagged || portCfg.vlans_tagged || portCfg.trunk || [];
  let portTagged;
  if (Array.isArray(rawTagged)) {
    portTagged = rawTagged.slice().sort((a, b) => a - b);
  } else if (typeof rawTagged === 'object') {
    portTagged = Object.keys(rawTagged).map(Number).sort((a, b) => a - b);
  } else {
    portTagged = [];
  }

  for (const key in PRESETS) {
    const p = PRESETS[key];
    if (p.pvid !== portPvid) continue;
    const presetTagged = (Array.isArray(p.tagged) ? p.tagged : []).slice().sort((a, b) => a - b);
    if (JSON.stringify(presetTagged) === JSON.stringify(portTagged)) return key;
  }
  return null;
}
