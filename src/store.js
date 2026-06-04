'use strict';

const { randomUUID } = require('crypto');
const db = require('./db');

function _row(r) {
  if (!r) return null;
  return {
    id           : r.id,
    name         : r.name,
    ip           : r.ip,
    username     : r.username,
    password     : r.password,
    group        : r.group_name,
    model        : r.model,
    https        : r.https === 1,
    location     : r.location,
    snmp_location: r.snmp_location,
  };
}

function load() {
  return db.prepare('SELECT * FROM switches ORDER BY group_name, name').all().map(_row);
}

function findById(id) {
  return _row(db.prepare('SELECT * FROM switches WHERE id = ?').get(id));
}

function insert(data) {
  const id = data.id || randomUUID();
  db.prepare(
    'INSERT INTO switches (id,name,ip,username,password,group_name,model,https,location,snmp_location) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(
    id,
    data.name,
    data.ip,
    data.username,
    data.password,
    data.group || 'Défaut',
    data.model || 'WS-12',
    data.https !== false ? 1 : 0,
    data.location || '',
    data.snmp_location || ''
  );
  return findById(id);
}

function update(id, patch) {
  const cur = db.prepare('SELECT * FROM switches WHERE id = ?').get(id);
  if (!cur) return null;
  const password = (!patch.password || patch.password === '***') ? cur.password : patch.password;
  db.prepare(
    'UPDATE switches SET name=?,ip=?,username=?,password=?,group_name=?,model=?,https=?,location=?,snmp_location=? WHERE id=?'
  ).run(
    (patch.name !== undefined && patch.name !== null) ? patch.name : cur.name,
    (patch.ip !== undefined && patch.ip !== null) ? patch.ip : cur.ip,
    (patch.username !== undefined && patch.username !== null) ? patch.username : cur.username,
    password,
    (patch.group !== undefined && patch.group !== null) ? patch.group : cur.group_name,
    (patch.model !== undefined && patch.model !== null) ? patch.model : cur.model,
    patch.https !== undefined ? (patch.https !== false ? 1 : 0) : cur.https,
    (patch.location !== undefined && patch.location !== null) ? patch.location : cur.location,
    (patch.snmp_location !== undefined && patch.snmp_location !== null) ? patch.snmp_location : cur.snmp_location,
    id
  );
  return findById(id);
}

function remove(id) {
  db.prepare('DELETE FROM switches WHERE id = ?').run(id);
}

module.exports = { load, findById, insert, update, remove };
