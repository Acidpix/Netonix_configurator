'use strict';

const db = require('./db');

function get(key, defaultValue = null) {
  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const row = stmt.get(key);
  return row ? row.value : defaultValue;
}

function set(key, value) {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  stmt.run(key, value);
  return { key, value };
}

function getAll() {
  const stmt = db.prepare('SELECT key, value FROM settings');
  return stmt.all();
}

module.exports = { get, set, getAll };
