'use strict';

const db = require('./db');

function _row(r) {
  if (!r) return null;
  return {
    key          : r.key,
    label        : r.label,
    pvid         : r.pvid,
    tagged       : JSON.parse(r.tagged || '[]'),
    poe          : r.poe === 'false' ? false : r.poe,
    enabled      : r.enabled === 1,
    storm_control: r.storm_control === 1,
    stp          : r.stp === 1,
    qos          : r.qos === 1,
    description  : r.description,
    color        : r.color,
    cls          : r.cls,
  };
}

function loadAll() {
  return db.prepare('SELECT * FROM presets ORDER BY rowid').all().map(_row);
}

function findByKey(key) {
  return _row(db.prepare('SELECT * FROM presets WHERE key = ?').get(key));
}

function upsert(key, data) {
  const tagged = Array.isArray(data.tagged)
    ? JSON.stringify(data.tagged)
    : (typeof data.tagged === 'string' ? data.tagged : '[]');
  const poe = (data.poe === false || data.poe === 'false') ? 'false' : (data.poe || 'false');

  db.prepare(`
    INSERT INTO presets (key,label,pvid,tagged,poe,enabled,storm_control,stp,qos,description,color,cls)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET
      label=excluded.label, pvid=excluded.pvid, tagged=excluded.tagged,
      poe=excluded.poe, enabled=excluded.enabled, storm_control=excluded.storm_control,
      stp=excluded.stp, qos=excluded.qos, description=excluded.description,
      color=excluded.color, cls=excluded.cls
  `).run(
    key,
    data.label        || key,
    parseInt(data.pvid) || 1,
    tagged,
    poe,
    data.enabled !== false ? 1 : 0,
    data.storm_control ? 1 : 0,
    data.stp  ? 1 : 0,
    data.qos  ? 1 : 0,
    data.description || '',
    data.color       || 'var(--text2)',
    data.cls         || `p-${key}`
  );
  return findByKey(key);
}

function remove(key) {
  db.prepare('DELETE FROM presets WHERE key = ?').run(key);
}

module.exports = { loadAll, findByKey, upsert, remove };
