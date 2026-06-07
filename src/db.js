'use strict';

const path     = require('path');
const fs       = require('fs');
const Database = require('better-sqlite3');
const { DB_FILE, DATA_FILE } = require('./config');

const dir = path.dirname(DB_FILE);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Tables ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS switches (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    ip            TEXT NOT NULL UNIQUE,
    username      TEXT NOT NULL,
    password      TEXT NOT NULL,
    group_name    TEXT NOT NULL DEFAULT 'Défaut',
    model         TEXT NOT NULL DEFAULT 'WS-12',
    https         INTEGER NOT NULL DEFAULT 1,
    location      TEXT NOT NULL DEFAULT '',
    snmp_location TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS presets (
    key           TEXT PRIMARY KEY,
    label         TEXT NOT NULL,
    pvid          INTEGER NOT NULL DEFAULT 1,
    tagged        TEXT NOT NULL DEFAULT '[]',
    poe           TEXT NOT NULL DEFAULT 'false',
    enabled       INTEGER NOT NULL DEFAULT 1,
    storm_control INTEGER NOT NULL DEFAULT 0,
    stp           INTEGER NOT NULL DEFAULT 0,
    qos           INTEGER NOT NULL DEFAULT 0,
    description   TEXT NOT NULL DEFAULT '',
    color         TEXT NOT NULL DEFAULT 'var(--text2)',
    cls           TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS switch_models (
    key           TEXT PRIMARY KEY,
    label         TEXT NOT NULL,
    port_count    INTEGER NOT NULL,
    builtin       INTEGER NOT NULL DEFAULT 0,
    poe_24v_ports TEXT NOT NULL DEFAULT '',
    poe_48v_ports TEXT NOT NULL DEFAULT '',
    poe_vh_ports  TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS vlan_presets (
    key         TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    vlans       TEXT NOT NULL DEFAULT '[]',
    color       TEXT NOT NULL DEFAULT 'var(--text2)',
    builtin     INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ── Migration colonnes (DB existantes) ────────────────────────────────────────
const _modelCols = db.prepare("PRAGMA table_info(switch_models)").all();
const _hasCol = (n) => _modelCols.some(c => c.name === n);
if (!_hasCol('poe_vh_ports')) {
  db.exec("ALTER TABLE switch_models ADD COLUMN poe_vh_ports TEXT NOT NULL DEFAULT ''");
}
// 24V / 48V : par défaut supportés sur tous les ports (backfill unique à l'ajout de la colonne)
if (!_hasCol('poe_24v_ports')) {
  db.exec("ALTER TABLE switch_models ADD COLUMN poe_24v_ports TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE switch_models SET poe_24v_ports = '1-' || port_count");
}
if (!_hasCol('poe_48v_ports')) {
  db.exec("ALTER TABLE switch_models ADD COLUMN poe_48v_ports TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE switch_models SET poe_48v_ports = '1-' || port_count");
}

// ── Seed switch_models ────────────────────────────────────────────────────────
const seedModels = [
  { key: 'WS-6',    label: 'WS-6-100W (6 ports)',     port_count: 6,  builtin: 1 },
  { key: 'WS-8',    label: 'WS-8-150W (8 ports)',     port_count: 8,  builtin: 1 },
  { key: 'WS-12',   label: 'WS-12-250W (12 ports)',   port_count: 12, builtin: 1 },
  { key: 'WS-26',   label: 'WS-26-500W (26 ports)',   port_count: 26, builtin: 1 },
  { key: 'WISP-12', label: 'WISP-12-MINI (12 ports)', port_count: 12, builtin: 1 },
  { key: 'WISP-16', label: 'WISP-16 (16 ports)',      port_count: 16, builtin: 1 },
];
const stmtModel = db.prepare(
  'INSERT OR IGNORE INTO switch_models (key,label,port_count,builtin,poe_24v_ports,poe_48v_ports,poe_vh_ports) VALUES (?,?,?,?,?,?,?)'
);
// 24V/48V supportés sur tous les ports par défaut ; 48VH à configurer (vide = aucun).
for (const m of seedModels) stmtModel.run(m.key, m.label, m.port_count, m.builtin, '1-' + m.port_count, '1-' + m.port_count, '');

// ── Seed vlan_presets ─────────────────────────────────────────────────────────
const seedVlanPresets = [
  { key: 'standard', label: 'Réseau standard', description: 'Configuration VLAN standard avec 6 VLANs', vlans: '[{"id":1,"name":"Management","subnet":"192.168.1.0/24","desc":"Gestion switches"},{"id":10,"name":"LAN","subnet":"10.0.10.0/24","desc":"Réseau local"},{"id":20,"name":"Serveurs","subnet":"10.0.20.0/24","desc":"Infra / NAS"},{"id":30,"name":"Cameras","subnet":"10.0.30.0/24","desc":"Vidéosurveillance"},{"id":40,"name":"VoIP","subnet":"10.0.40.0/24","desc":"Téléphonie IP"},{"id":50,"name":"IoT","subnet":"10.0.50.0/24","desc":"Objets connectés"}]', color: 'var(--text2)', builtin: 1 },
];
const stmtVlanPreset = db.prepare(
  'INSERT OR IGNORE INTO vlan_presets (key,label,description,vlans,color,builtin) VALUES (?,?,?,?,?,?)'
);
for (const vp of seedVlanPresets) {
  stmtVlanPreset.run(vp.key, vp.label, vp.description, vp.vlans, vp.color, vp.builtin);
}

// ── Seed presets ──────────────────────────────────────────────────────────────
const seedPresets = [
  { key: 'cam',      label: 'Caméra IP',      pvid: 30, tagged: '[]',               poe: '48v',   enabled: 1, storm_control: 1, stp: 1, qos: 0, description: 'IP Camera',         color: 'var(--pink)',   cls: 'p-cam'      },
  { key: 'ap',       label: 'AP WiFi',         pvid: 10, tagged: '[10,20,30,40,50]', poe: '48v',   enabled: 1, storm_control: 0, stp: 1, qos: 0, description: 'WiFi Access Point', color: 'var(--accent)', cls: 'p-ap'       },
  { key: 'uplink',   label: 'Uplink / Trunk',  pvid: 1,  tagged: '[1,10,20,30,40,50]',poe: 'false', enabled: 1, storm_control: 0, stp: 0, qos: 0, description: 'Uplink',           color: 'var(--teal)',   cls: 'p-uplink'   },
  { key: 'voip',     label: 'VoIP',            pvid: 40, tagged: '[10]',             poe: '48v',   enabled: 1, storm_control: 0, stp: 1, qos: 1, description: 'VoIP Phone',        color: 'var(--amber)',  cls: 'p-voip'     },
  { key: 'server',   label: 'Serveur / NAS',   pvid: 20, tagged: '[]',               poe: 'false', enabled: 1, storm_control: 0, stp: 0, qos: 0, description: 'Server',           color: 'var(--purple)', cls: 'p-server'   },
  { key: 'disabled', label: 'Désactivé',       pvid: 1,  tagged: '[]',               poe: 'false', enabled: 0, storm_control: 0, stp: 0, qos: 0, description: 'Disabled',         color: 'var(--text3)',  cls: 'p-disabled' },
];
const stmtPreset = db.prepare(
  'INSERT OR IGNORE INTO presets (key,label,pvid,tagged,poe,enabled,storm_control,stp,qos,description,color,cls) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
);
for (const p of seedPresets) {
  stmtPreset.run(p.key, p.label, p.pvid, p.tagged, p.poe, p.enabled, p.storm_control, p.stp, p.qos, p.description, p.color, p.cls);
}

// ── Seed settings ─────────────────────────────────────────────────────────────
const { DEFAULT_USERNAME, DEFAULT_PASSWORD } = require('./config');
const stmtSetting = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
stmtSetting.run('scan_default_username', DEFAULT_USERNAME);
stmtSetting.run('scan_default_password', DEFAULT_PASSWORD);

// ── Migration depuis switches.json ────────────────────────────────────────────
if (fs.existsSync(DATA_FILE)) {
  try {
    const existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO switches (id,name,ip,username,password,group_name,model,https,location,snmp_location) VALUES (?,?,?,?,?,?,?,?,?,?)'
    );
    const migrate = db.transaction((list) => {
      for (const s of list) {
        stmt.run(
          s.id, s.name, s.ip, s.username, s.password,
          s.group || 'Défaut', s.model || 'WS-12',
          s.https !== false ? 1 : 0,
          s.location || '', s.snmp_location || ''
        );
      }
    });
    migrate(existing);
    fs.renameSync(DATA_FILE, DATA_FILE + '.bak');
    console.log(`[db] Migration switches.json → SQLite (${existing.length} switch(es)), fichier renommé en .bak`);
  } catch (e) {
    console.error('[db] Erreur migration :', e.message);
  }
}

module.exports = db;
