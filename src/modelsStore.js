'use strict';

const db = require('./db');

function _row(r) {
  if (!r) return null;
  return {
    key       : r.key,
    label     : r.label,
    port_count: r.port_count,
    builtin   : r.builtin === 1,
  };
}

function loadAll() {
  return db.prepare('SELECT * FROM switch_models ORDER BY port_count, key').all().map(_row);
}

function findByKey(key) {
  return _row(db.prepare('SELECT * FROM switch_models WHERE key = ?').get(key));
}

function insert(data) {
  db.prepare('INSERT INTO switch_models (key,label,port_count,builtin) VALUES (?,?,?,0)')
    .run(data.key, data.label, data.port_count);
  return findByKey(data.key);
}

function remove(key) {
  const m = findByKey(key);
  if (!m) return;
  if (m.builtin) throw new Error('Les modèles intégrés ne peuvent pas être supprimés');
  db.prepare('DELETE FROM switch_models WHERE key = ? AND builtin = 0').run(key);
}

module.exports = { loadAll, findByKey, insert, remove };
