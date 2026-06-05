'use strict';

/**
 * Client pour l'API REST des switchs Netonix.
 *
 * Endpoints utilisés :
 *   POST /api/v1/login        { username, password }  → cookie de session
 *   GET  /api/v1/config                               → config JSON complète
 *   POST /api/v1/config       { ...config }           → sauvegarde config
 *   POST /api/v1/apply        {}                      → applique la config
 *   GET  /api/v1/portdetail?port=N                    → stats temps réel d'un port
 *   GET  /api/v1/syslog                               → logs système
 */

const fetch      = require('node-fetch');
const https      = require('https');
const { execFile } = require('child_process');
const { SWITCH_TIMEOUT, IGNORE_SSL } = require('./config');

const sslAgent = new https.Agent({ rejectUnauthorized: !IGNORE_SSL });

function baseUrl(sw) {
  return `${sw.https !== false ? 'https' : 'http'}://${sw.ip}`;
}

function agent(sw) {
  return sw.https !== false ? sslAgent : undefined;
}

/**
 * Extrait le cookie de session depuis Set-Cookie.
 * Cherche PHPSESSID, session, ou tout autre cookie contenant "sess"/"auth"/"token".
 * En dernier recours, prend le premier cookie disponible.
 */
function extractSessionCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  // Priorité : PHPSESSID ou session (original)
  var m = setCookieHeader.match(/(?:PHPSESSID|session)=([^;,\s]+)/i);
  if (m) return m[0];
  // Fallback : premier cookie
  var first = setCookieHeader.match(/^([A-Za-z_][A-Za-z0-9_-]*=[^;,\s]+)/);
  return first ? first[1] : null;
}

/**
 * Authentifie et retourne un objet { Cookie: "..." }.
 * Méthode 1 : /index.fcgi (firmware récent 1.5.25+)
 * Méthode 2 : /api/v1/login JSON (firmware ancien)
 */
async function login(sw) {
  var formBody = 'username=' + encodeURIComponent(sw.username) + '&password=' + encodeURIComponent(sw.password);

  // Méthode 1 : /index.fcgi
  try {
    var r1 = await fetch(baseUrl(sw) + '/index.fcgi', {
      method : 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body   : formBody,
      agent  : agent(sw),
      timeout: SWITCH_TIMEOUT,
      redirect: 'manual',
    });
    if ([200, 301, 302].includes(r1.status)) {
      var c1 = extractSessionCookie(r1.headers.get('set-cookie'));
      if (c1) return { Cookie: c1 };
    }
  } catch (e) {}

  // Méthode 2 : /api/v1/login JSON (firmware ancien)
  try {
    var r2 = await fetch(baseUrl(sw) + '/api/v1/login', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ username: sw.username, password: sw.password }),
      agent  : agent(sw),
      timeout: SWITCH_TIMEOUT,
      redirect: 'manual',
    });
    if ([200, 201, 301, 302].includes(r2.status)) {
      var c2 = extractSessionCookie(r2.headers.get('set-cookie'));
      if (c2) return { Cookie: c2 };
    }
  } catch (e) {}

  throw new Error('Authentification échouée — vérifiez les credentials du switch');
}

/**
 * GET JSON depuis le switch. Si auth est fourni, réutilise la session existante.
 */
async function get(sw, endpoint, auth) {
  if (!auth) auth = await login(sw);
  var res = await fetch(baseUrl(sw) + endpoint, {
    headers : auth,
    agent   : agent(sw),
    timeout : SWITCH_TIMEOUT,
  });
  // Session invalidée par une opération concurrente (ping, pushConfig…) — réessai avec nouvelle auth
  if (res.status === 401) {
    auth = await login(sw);
    res = await fetch(baseUrl(sw) + endpoint, {
      headers : auth,
      agent   : agent(sw),
      timeout : SWITCH_TIMEOUT,
    });
  }
  if (!res.ok) throw new Error('GET ' + endpoint + ' → HTTP ' + res.status);
  return { data: await res.json(), auth: auth };
}

/**
 * POST JSON vers le switch, réutilise l'auth existante si fournie.
 */
async function post(sw, endpoint, body, auth) {
  if (!body) body = {};
  if (!auth) auth = await login(sw);
  var makeReq = function(a) {
    return fetch(baseUrl(sw) + endpoint, {
      method  : 'POST',
      headers : Object.assign({ 'Content-Type': 'application/json' }, a),
      body    : JSON.stringify(body),
      agent   : agent(sw),
      timeout : SWITCH_TIMEOUT,
    });
  };
  var res = await makeReq(auth);
  if (res.status === 401) {
    auth = await login(sw);
    res = await makeReq(auth);
  }
  if (!res.ok) throw new Error('POST ' + endpoint + ' → HTTP ' + res.status);
  var text = await res.text();
  try { return JSON.parse(text); } catch (e) { return { raw: text }; }
}

/**
 * Récupère la config complète.
 */
async function getConfig(sw) {
  var result = await get(sw, '/api/v1/config');
  return { config: result.data, auth: result.auth };
}

/**
 * Convertit notre format PoE vers le format natif Netonix.
 */
function toNativePoe(poe) {
  if (!poe || poe === false || poe === 'false' || poe === 'Off') return 'Off';
  if (poe === '24v')   return '24V';
  if (poe === '48v')   return '48V';
  if (poe === '48vHV') return '48VH';
  return String(poe);
}

/**
 * Sauvegarde + applique une config au format natif Netonix.
 *
 * patch.ports = { "1": { pvid, tagged[], poe, stp, enabled, description, ... }, ... }
 * patch.vlans = [{ id, name }, ...]
 *
 * Traduit vers :
 *   Ports  = tableau natif mis à jour (PoE, STP, Enable, Name)
 *   VLANs  = tableau natif avec PortSettings reconstruits (U/T/N par port)
 */
async function pushConfig(sw, patch) {
  var auth   = await login(sw);
  var result = await get(sw, '/api/v1/config', auth);
  var config = result.data;

  // Cloner les tableaux natifs
  var nativePorts = JSON.parse(JSON.stringify(config.Ports || []));
  var nativeVlans = JSON.parse(JSON.stringify(config.VLANs || []));
  var portCount   = nativePorts.length;

  // ── 1. Mise à jour des propriétés de ports ────────────────────────────────
  var patchPorts = patch.ports || {};
  Object.keys(patchPorts).forEach(function(numStr) {
    var portNum = parseInt(numStr);
    var cfg     = patchPorts[numStr];
    var portObj = null;
    for (var i = 0; i < nativePorts.length; i++) {
      if (nativePorts[i].Number === portNum) { portObj = nativePorts[i]; break; }
    }
    if (!portObj) return;

    if (cfg.description !== undefined && cfg.description !== null)
      portObj.Name   = cfg.description;
    if (cfg.enabled !== undefined)
      portObj.Enable = cfg.enabled !== false;
    if (cfg.poe !== undefined)
      portObj.PoE    = toNativePoe(cfg.poe);
    if (cfg.stp !== undefined)
      portObj.STP    = !!cfg.stp;
  });

  // ── 2. Mise à jour des VLANs — PortSettings ──────────────────────────────
  // Construire la carte pvid/tagged par port pour les ports modifiés
  var portVlanMap = {};
  Object.keys(patchPorts).forEach(function(numStr) {
    var portNum = parseInt(numStr);
    var cfg     = patchPorts[numStr];
    portVlanMap[portNum] = {
      pvid  : cfg.pvid   || 1,
      tagged: cfg.tagged || [],
    };
  });

  // S'assurer que tous les VLANs utilisés dans les presets existent
  var patchVlans = patch.vlans || [];
  patchVlans.forEach(function(pv) {
    var pvId = parseInt(pv.id || pv.ID);
    if (!pvId) return;
    var exists = nativeVlans.some(function(v) { return parseInt(v.ID) === pvId; });
    if (!exists) {
      nativeVlans.push({
        ID          : String(pvId),
        Name        : pv.name || pv.Name || ('VLAN ' + pvId),
        Enable      : true,
        PortSettings: new Array(portCount + 1).join('N'),
        IPv4_Enable : false, IPv4_Address: '', IPv4_Netmask: '',
        IPv6_Enable : false, IPv6_Address: '', IGMP_Querier: false,
      });
    } else {
      // Mettre à jour le nom si fourni
      nativeVlans.forEach(function(v) {
        if (parseInt(v.ID) === pvId && (pv.name || pv.Name))
          v.Name = pv.name || pv.Name;
      });
    }
  });

  // Reconstruire PortSettings pour chaque VLAN
  nativeVlans.forEach(function(vlan) {
    var vlanId   = parseInt(vlan.ID);
    var settings = (vlan.PortSettings || '').split('');
    while (settings.length < portCount) settings.push('N');

    Object.keys(portVlanMap).forEach(function(numStr) {
      var portNum = parseInt(numStr);
      var idx     = portNum - 1;
      if (idx < 0 || idx >= settings.length) return;
      var vm = portVlanMap[portNum];

      if (vm.pvid === vlanId) {
        settings[idx] = 'U';
      } else if (vm.tagged.indexOf(vlanId) !== -1) {
        settings[idx] = 'T';
      } else {
        settings[idx] = 'N';
      }
    });

    vlan.PortSettings = settings.join('');
  });

  // ── 3. Merge et envoi ─────────────────────────────────────────────────────
  // Copie les champs libres du patch (Switch_Name, Switch_Location, etc.)
  var merged = Object.assign({}, config, { Ports: nativePorts, VLANs: nativeVlans });
  Object.keys(patch).forEach(function(k) {
    if (k !== 'ports' && k !== 'vlans') merged[k] = patch[k];
  });
  await post(sw, '/api/v1/config', merged, auth);
  await post(sw, '/api/v1/apply', {}, auth);
}

/**
 * Reset propre : reconstruit une config minimale.
 */
async function resetConfig(sw, options) {
  if (!options) options = {};
  var auth     = await login(sw);
  var result   = await get(sw, '/api/v1/config', auth);
  var config   = result.data;
  var newConfig = {
    Switch_Name : config.Switch_Name || config.hostname,
    IPv4_Address: config.IPv4_Address || config.ip,
    IPv4_Netmask: config.IPv4_Netmask || config.netmask,
    IPv4_Gateway: config.IPv4_Gateway || config.gateway,
    VLANs       : options.vlans || config.VLANs || config.vlans || [],
    Ports       : config.Ports  || config.ports  || [],
  };
  await post(sw, '/api/v1/config', newConfig, auth);
  await post(sw, '/api/v1/apply', {}, auth);
  return { hostname: newConfig.Switch_Name, ip: newConfig.IPv4_Address };
}

/**
 * Test de connectivité via ping ICMP — sans consommer de session HTTP.
 */
function ping(sw) {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(sw.ip)) return Promise.reject(new Error('IP invalide'));
  var isWin = process.platform === 'win32';
  var args  = isWin ? ['-n', '1', '-w', '1000', sw.ip] : ['-c', '1', '-W', '1', sw.ip];
  return new Promise(function(resolve, reject) {
    execFile('ping', args, function(err) {
      if (err) reject(new Error('Hôte injoignable : ' + sw.ip));
      else resolve(true);
    });
  });
}

/**
 * Redémarre le switch.
 */
async function reboot(sw) {
  var auth = await login(sw);
  await post(sw, '/api/v1/reboot', {}, auth);
  return true;
}

/**
 * Stats temps réel d'un port.
 */
async function portStats(sw, portNum) {
  var result = await get(sw, '/api/v1/portdetail?port=' + portNum);
  return result.data;
}

/**
 * Tente de détecter le modèle du switch depuis sa config.
 * Regarde d'abord config.hardware / config.model, puis déduit depuis le nombre de ports.
 * @param {object} config    - config JSON du switch
 * @param {Array}  models    - liste des modèles disponibles (depuis modelsStore)
 * @returns {string|null}    - clé de modèle ou null
 */
function detectModel(config, models = []) {
  if (!config) return null;

  // Champ direct dans la config (certains firmware)
  const hw = config.hardware || config.model || '';
  if (hw) {
    const match = models.find(m => hw.toUpperCase().includes(m.key.toUpperCase()));
    if (match) return match.key;
  }

  // Déduction depuis le nombre de ports
  const portCount = Object.keys(config.ports || {}).length;
  if (portCount > 0) {
    const byCount = models
      .filter(m => m.port_count === portCount)
      .sort((a, b) => a.builtin - b.builtin);
    if (byCount.length) return byCount[0].key;
  }

  return null;
}

module.exports = { login, get, post, getConfig, pushConfig, resetConfig, ping, reboot, portStats, detectModel };
