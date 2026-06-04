'use strict';

const db = require('./db');

function _row(r) {
  if (!r) return null;
  return {
    key        : r.key,
    label      : r.label,
    description: r.description,
    vlans      : JSON.parse(r.vlans || '[]'),
    color      : r.color,
    builtin    : r.builtin === 1,
  };
}

function loadAll() {
  return db.prepare('SELECT * FROM vlan_presets ORDER BY rowid').all().map(_row);
}

function findByKey(key) {
  return _row(db.prepare('SELECT * FROM vlan_presets WHERE key = ?').get(key));
}

function upsert(key, data) {
  const vlans = Array.isArray(data.vlans)
    ? JSON.stringify(data.vlans)
    : (typeof data.vlans === 'string' ? data.vlans : '[]');

  db.prepare(`
    INSERT INTO vlan_presets (key,label,description,vlans,color,builtin)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET
      label=excluded.label, description=excluded.description,
      vlans=excluded.vlans, color=excluded.color
  `).run(
    key,
    data.label        || key,
    data.description  || '',
    vlans,
    data.color        || 'var(--text2)',
    data.builtin      ? 1 : 0
  );
  return findByKey(key);
}

function remove(key) {
  db.prepare('DELETE FROM vlan_presets WHERE key = ?').run(key);
}

module.exports = { loadAll, findByKey, upsert, remove };
