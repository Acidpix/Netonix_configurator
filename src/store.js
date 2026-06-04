'use strict';

const fs   = require('fs');
const path = require('path');
const { DATA_FILE } = require('./config');

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[store] Erreur lecture :', e.message);
  }
  return [];
}

function save(list) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}

function findById(id) {
  return load().find(s => s.id === id) || null;
}

function insert(sw) {
  const list = load();
  list.push(sw);
  save(list);
  return sw;
}

function update(id, patch) {
  const list = load();
  const idx  = list.findIndex(s => s.id === id);
  if (idx === -1) return null;
  if (!patch.password || patch.password === '***') patch.password = list[idx].password;
  list[idx] = { ...list[idx], ...patch };
  save(list);
  return list[idx];
}

function remove(id) {
  const list = load().filter(s => s.id !== id);
  save(list);
}

module.exports = { load, save, findById, insert, update, remove };
