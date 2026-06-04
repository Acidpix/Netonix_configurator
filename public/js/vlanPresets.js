'use strict';

let VLAN_PRESETS = [];

async function initVlanPresets() {
  try {
    const r = await fetch('/api/vlan-presets');
    VLAN_PRESETS = await r.json();
  } catch (e) {
    console.error('Erreur chargement presets VLAN :', e);
    VLAN_PRESETS = [];
  }
}

function renderVlanPresetButtons() {
  const container = document.getElementById('vlan-preset-buttons');
  if (!container) return;
  container.innerHTML = '';
  VLAN_PRESETS.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.style.fontSize = '11px';
    btn.style.padding = '4px 8px';
    btn.title = p.description;
    btn.innerHTML = `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${p.color};margin-right:4px"></span>${p.label}`;
    btn.onclick = () => applyVlanPreset(p);
    container.appendChild(btn);
  });
}

function applyVlanPreset(preset) {
  if (!preset.vlans || !Array.isArray(preset.vlans) || preset.vlans.length === 0) {
    toast('Preset vide', 'err');
    return;
  }
  vlans = JSON.parse(JSON.stringify(preset.vlans));
  renderVlanTable();
  toast(`Preset VLAN "${preset.label}" appliqué`, 'ok');
}
