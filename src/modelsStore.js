'use strict';

const db = require('./db');

function _row(r) {
  if (!r) return null;
  return {
    key          : r.key,
    label        : r.label,
    port_count   : r.port_count,
    builtin      : r.builtin === 1,
    poe_24v_ports: r.poe_24v_ports || '',
    poe_48v_ports: r.poe_48v_ports || '',
    poe_vh_ports : r.poe_vh_ports  || '',
  };
}

function loadAll() {
  return db.prepare('SELECT * FROM switch_models ORDER BY port_count, key').all().map(_row);
}

function findByKey(key) {
  return _row(db.prepare('SELECT * FROM switch_models WHERE key = ?').get(key));
}

function insert(data) {
  const c = data.port_count;
  // 24V/48V supportés sur tous les ports par défaut ; 48VH à configurer.
  db.prepare('INSERT INTO switch_models (key,label,port_count,builtin,poe_24v_ports,poe_48v_ports,poe_vh_ports) VALUES (?,?,?,0,?,?,?)')
    .run(data.key, data.label, c, '1-' + c, '1-' + c, '');
  return findByKey(data.key);
}

// Met à jour les ports supportant chaque type de PoE (24V / 48V / 48VH).
// Seuls les champs fournis dans `data` sont modifiés. Autorisé sur les modèles intégrés.
function setPoePorts(key, data) {
  const m = findByKey(key);
  if (!m) throw new Error(`Modèle "${key}" introuvable`);
  const v24 = data.poe_24v_ports !== undefined ? (data.poe_24v_ports || '') : m.poe_24v_ports;
  const v48 = data.poe_48v_ports !== undefined ? (data.poe_48v_ports || '') : m.poe_48v_ports;
  const vvh = data.poe_vh_ports  !== undefined ? (data.poe_vh_ports  || '') : m.poe_vh_ports;
  db.prepare('UPDATE switch_models SET poe_24v_ports = ?, poe_48v_ports = ?, poe_vh_ports = ? WHERE key = ?')
    .run(v24, v48, vvh, key);
  return findByKey(key);
}

function remove(key) {
  const m = findByKey(key);
  if (!m) return;
  if (m.builtin) throw new Error('Les modèles intégrés ne peuvent pas être supprimés');
  db.prepare('DELETE FROM switch_models WHERE key = ? AND builtin = 0').run(key);
}

module.exports = { loadAll, findByKey, insert, setPoePorts, remove };
