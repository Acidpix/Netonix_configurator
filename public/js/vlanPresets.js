'use strict';

let VLAN_PRESETS = [];
let _pendingVlanPreset = null;

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
    btn.dataset.presetKey = p.key;
    btn.innerHTML = `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${p.color};margin-right:4px"></span>${p.label}`;
    btn.onclick = () => selectVlanPreset(p);
    container.appendChild(btn);
  });
  _pendingVlanPreset = null;
  const applyBtn = document.getElementById('btn-apply-vlan-preset');
  if (applyBtn) applyBtn.style.display = 'none';
}

function selectVlanPreset(preset) {
  if (!preset.vlans || !Array.isArray(preset.vlans) || preset.vlans.length === 0) {
    toast('Preset vide', 'err');
    return;
  }
  _pendingVlanPreset = preset;
  document.querySelectorAll('#vlan-preset-buttons .btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.presetKey === preset.key);
  });
  const applyBtn = document.getElementById('btn-apply-vlan-preset');
  if (applyBtn) {
    applyBtn.style.display = '';
    applyBtn.textContent = `Appliquer « ${preset.label} »`;
  }
}

function confirmApplyVlanPreset() {
  if (!_pendingVlanPreset) return;
  vlans = JSON.parse(JSON.stringify(_pendingVlanPreset.vlans));
  renderVlanTable();
  toast(`Preset VLAN « ${_pendingVlanPreset.label} » appliqué`, 'ok');
  _pendingVlanPreset = null;
  document.querySelectorAll('#vlan-preset-buttons .btn').forEach(btn => btn.classList.remove('active'));
  const applyBtn = document.getElementById('btn-apply-vlan-preset');
  if (applyBtn) applyBtn.style.display = 'none';
}
