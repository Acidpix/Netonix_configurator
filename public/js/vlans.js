'use strict';

const DEFAULT_VLANS = [
  { id: 1,  name: 'Management', subnet: '192.168.1.0/24', desc: 'Gestion switches' },
  { id: 10, name: 'LAN',        subnet: '10.0.10.0/24',   desc: 'Réseau local' },
  { id: 20, name: 'Serveurs',   subnet: '10.0.20.0/24',   desc: 'Infra / NAS' },
  { id: 30, name: 'Cameras',    subnet: '10.0.30.0/24',   desc: 'Vidéosurveillance' },
  { id: 40, name: 'VoIP',       subnet: '10.0.40.0/24',   desc: 'Téléphonie IP' },
  { id: 50, name: 'IoT',        subnet: '10.0.50.0/24',   desc: 'Objets connectés' },
];

const VLAN_COLORS = ['#888780','#3b82f6','#a855f7','#ec4899','#f59e0b','#14b8a6','#ef4444','#22c55e'];

let vlans = JSON.parse(JSON.stringify(DEFAULT_VLANS));

function getVlans() { return vlans; }

function setVlans(list) {
  vlans = list.map(v => ({
    id    : v.id,
    name  : v.name  || v.description || 'VLAN ' + v.id,
    subnet: v.subnet || '',
    desc  : v.description || v.name || '',
  }));
  renderVlanTable();
}

function resetVlans() {
  vlans = JSON.parse(JSON.stringify(DEFAULT_VLANS));
  renderVlanTable();
}

function addVlan() {
  vlans.push({ id: 100 + vlans.length, name: 'Nouveau', subnet: '10.0.x.0/24', desc: '' });
  renderVlanTable();
  if (window.markConfigDirty) markConfigDirty();
}

function removeVlan(idx) {
  vlans.splice(idx, 1);
  renderVlanTable();
  if (window.markConfigDirty) markConfigDirty();
}

// Déplace le VLAN de l'index `from` à la position de l'index `to` (insertion avant la cible).
function moveVlan(from, to) {
  if (from == null || to == null || from === to) return;
  const item = vlans.splice(from, 1)[0];
  vlans.splice(from < to ? to - 1 : to, 0, item);
  renderVlanTable();
  if (window.markConfigDirty) markConfigDirty();
}

let _vlanDragIdx = null;

function renderVlanTable() {
  const tbody = document.getElementById('vlan-tbody');
  tbody.innerHTML = '';
  vlans.forEach((v, idx) => {
    const color = VLAN_COLORS[idx % VLAN_COLORS.length];
    const tr    = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="vlan-grip" draggable="true" title="Glisser pour réordonner">⠿</span>
          <div class="vlan-dot" style="background:${color}"></div>
          <input type="number" value="${v.id}" style="width:52px" onchange="vlans[${idx}].id=+this.value;markConfigDirty()" />
        </div>
      </td>
      <td><input type="text" value="${v.name}"   onchange="vlans[${idx}].name=this.value;markConfigDirty()" /></td>
      <td><input type="text" value="${v.subnet||''}" placeholder="10.0.x.0/24" onchange="vlans[${idx}].subnet=this.value;markConfigDirty()" /></td>
      <td><input type="text" value="${v.desc||''}"   placeholder="Description"  onchange="vlans[${idx}].desc=this.value;markConfigDirty()" /></td>
      <td><button class="btn btn-danger" style="padding:3px 7px;font-size:11px" onclick="removeVlan(${idx})">✕</button></td>
    `;

    // Réordonnancement par glisser-déposer (poignée ⠿ uniquement, pour ne pas gêner les champs)
    const grip = tr.querySelector('.vlan-grip');
    grip.ondragstart = (e) => {
      _vlanDragIdx = idx;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(idx)); } catch (_) {}
      tr.classList.add('vlan-dragging');
    };
    grip.ondragend = () => {
      _vlanDragIdx = null;
      document.querySelectorAll('.vlan-dragging, .vlan-dragover')
        .forEach(el => el.classList.remove('vlan-dragging', 'vlan-dragover'));
    };
    tr.ondragover = (e) => {
      if (_vlanDragIdx === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      tr.classList.add('vlan-dragover');
    };
    tr.ondragleave = () => tr.classList.remove('vlan-dragover');
    tr.ondrop = (e) => {
      e.preventDefault();
      tr.classList.remove('vlan-dragover');
      moveVlan(_vlanDragIdx, idx);
      _vlanDragIdx = null;
    };

    tbody.appendChild(tr);
  });
}

function buildVlansPayload() {
  return vlans.map(v => ({ id: v.id, name: v.name, description: v.desc || v.name }));
}

// ── Mode trunk global (case « Tous les ports en trunk ») ──────────────────────
function getAllPortsTrunk() {
  const el = document.getElementById('vlan-all-trunk');
  return !!(el && el.checked);
}

function setAllPortsTrunk(on) {
  const el = document.getElementById('vlan-all-trunk');
  if (el) el.checked = !!on;
}

function onAllPortsTrunkChange() {
  if (window.markConfigDirty) markConfigDirty();
}
