'use strict';

const fetch        = require('node-fetch');
const https        = require('https');
const { execFile } = require('child_process');
const { SWITCH_TIMEOUT, IGNORE_SSL } = require('./config');
const modelsStore  = require('./modelsStore');
const { parseRanges } = require('./ranges');

const sslAgent = new https.Agent({ rejectUnauthorized: !IGNORE_SSL });

// ── Cache de session ───────────────────────────────────────────────────────────
// Session conservée indéfiniment : on ne reloggue que si le switch refuse (401).
// Un seul login est lancé à la fois par switch (déduplication via Promise).
const _sessions  = {};  // { ip: { auth } }
const _loggingIn = {};  // { ip: Promise<auth> }  — login en cours

// Verrou « apply en cours » : pendant un apply + sa confirmation anti-revert, on
// INTERDIT tout re-login. Se relogger pendant que la session est encore valide fait
// planter le firmware Netonix. Un 401 transitoire pendant cette fenêtre est ignoré
// (réessai avec la même session), jamais traité comme une expiration de token.
const _applying  = {};  // { ip: true }

function baseUrl(sw) {
  return (sw.https !== false ? 'https' : 'http') + '://' + sw.ip;
}

function agent(sw) {
  return sw.https !== false ? sslAgent : undefined;
}

function extractSessionCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  var m = setCookieHeader.match(/(?:PHPSESSID|session)=([^;,\s]+)/i);
  if (m) return m[0];
  var first = setCookieHeader.match(/^([A-Za-z_][A-Za-z0-9_-]*=[^;,\s]+)/);
  return first ? first[1] : null;
}

async function login(sw) {
  var formBody = 'username=' + encodeURIComponent(sw.username) + '&password=' + encodeURIComponent(sw.password);

  try {
    var r1 = await fetch(baseUrl(sw) + '/index.fcgi', {
      method  : 'POST',
      headers : { 'Content-Type': 'application/x-www-form-urlencoded' },
      body    : formBody,
      agent   : agent(sw),
      timeout : SWITCH_TIMEOUT,
      redirect: 'manual',
    });
    if ([200, 301, 302].includes(r1.status)) {
      var c1 = extractSessionCookie(r1.headers.get('set-cookie'));
      if (c1) return { Cookie: c1 };
    }
  } catch (e) {}

  try {
    var r2 = await fetch(baseUrl(sw) + '/api/v1/login', {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json' },
      body    : JSON.stringify({ username: sw.username, password: sw.password }),
      agent   : agent(sw),
      timeout : SWITCH_TIMEOUT,
      redirect: 'manual',
    });
    if ([200, 201, 301, 302].includes(r2.status)) {
      var c2 = extractSessionCookie(r2.headers.get('set-cookie'));
      if (c2) return { Cookie: c2 };
    }
  } catch (e) {}

  throw new Error('Authentification échouée — vérifiez les credentials du switch');
}

// Retourne l'auth en cache ou lance un unique login (dédupliqué).
// La session est gardée jusqu'au premier 401 du switch.
async function getAuth(sw) {
  if (_sessions[sw.ip]) return _sessions[sw.ip].auth;
  if (_loggingIn[sw.ip]) return _loggingIn[sw.ip];

  _loggingIn[sw.ip] = login(sw)
    .then(function(auth) {
      _sessions[sw.ip] = { auth: auth };
      delete _loggingIn[sw.ip];
      return auth;
    })
    .catch(function(err) {
      delete _loggingIn[sw.ip];
      throw err;
    });
  return _loggingIn[sw.ip];
}

function invalidateSession(ip) {
  delete _sessions[ip];
}

async function get(sw, endpoint, auth) {
  if (!auth) auth = await getAuth(sw);
  var res = await fetch(baseUrl(sw) + endpoint, {
    headers : auth,
    agent   : agent(sw),
    timeout : SWITCH_TIMEOUT,
  });
  // Re-login sur 401 UNIQUEMENT hors fenêtre d'apply (sinon on planterait le switch).
  if (res.status === 401 && !_applying[sw.ip]) {
    invalidateSession(sw.ip);
    auth = await getAuth(sw);
    res  = await fetch(baseUrl(sw) + endpoint, {
      headers : auth,
      agent   : agent(sw),
      timeout : SWITCH_TIMEOUT,
    });
  }
  if (!res.ok) throw new Error('GET ' + endpoint + ' → HTTP ' + res.status);
  return { data: await res.json(), auth: auth };
}

async function post(sw, endpoint, body, auth) {
  if (!body) body = {};
  if (!auth) auth = await getAuth(sw);
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
  // Re-login sur 401 UNIQUEMENT hors fenêtre d'apply.
  if (res.status === 401 && !_applying[sw.ip]) {
    invalidateSession(sw.ip);
    auth = await getAuth(sw);
    res  = await makeReq(auth);
  }
  if (!res.ok) throw new Error('POST ' + endpoint + ' → HTTP ' + res.status);
  var text = await res.text();
  try { return JSON.parse(text); } catch (e) { return { raw: text }; }
}

async function getConfig(sw) {
  var result = await get(sw, '/api/v1/config');
  return { config: result.data, auth: result.auth };
}

function _delay(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

// Détecte si l'apply Netonix est terminé d'après la réponse de /api/v1/applystatus.
function _isApplyDone(s) {
  if (!s || typeof s !== 'object') return false;
  var result = String(s.result || s.Result || s.Status || s.status || s.State || s.state || '').toLowerCase();
  if (result && /(ok|done|complete|applied|success|idle|finish|ready)/.test(result)) return true;
  if (s.Applying === false || s.applying === false) return true;
  if (s.Done === true || s.done === true || s.Finished === true || s.finished === true) return true;
  if (typeof s.Progress === 'number' && s.Progress >= 100) return true;
  if (typeof s.progress === 'number' && s.progress >= 100) return true;
  return false;
}

// Confirmation anti-revert : le firmware Netonix arme un revert timer à l'apply et
// rétablit l'ancienne config après ~60 s si le client ne revient pas prouver que le
// lien de management a survécu. On poll /api/v1/applystatus avec la session COURANTE.
//
// IMPORTANT : on ne se relogue JAMAIS ici (fetch direct, pas via get()). Un re-login
// pendant une session valide fait planter le switch. Un 401 transitoire ou un blip
// réseau pendant l'apply → on réessaie tel quel, sans toucher à la session.
// Renvoie true si l'apply est confirmé, false si le switch a rétabli l'ancienne config.
async function confirmApply(sw, auth) {
  var confirmed = false;
  for (var i = 0; i < 25; i++) {
    await _delay(600);
    try {
      var res = await fetch(baseUrl(sw) + '/api/v1/applystatus?_=' + Date.now(), {
        headers : auth,
        agent   : agent(sw),
        timeout : SWITCH_TIMEOUT,
      });
      if (res.status === 401 || !res.ok) continue;  // transitoire → on réessaie, jamais de relogin
      var s = {};
      try { s = await res.json(); } catch (e) { continue; }
      if (s.reverted === true) { confirmed = false; break; }  // le switch a rollback
      confirmed = true;                                        // client revenu → connectivité prouvée
      if (_isApplyDone(s)) break;                              // apply terminé → on arrête de poller
    } catch (e) {
      // Blip réseau pendant l'apply → on réessaie avec la MÊME session (pas de relogin).
    }
  }
  return confirmed;
}

function toNativePoe(poe) {
  if (!poe || poe === false || poe === 'false' || poe === 'Off') return 'Off';
  if (poe === '24v')                      return '24V';
  if (poe === '48v')                      return '48V';
  if (poe === '48VH' || poe === '48vHV') return '48VH';
  return String(poe);
}

// Normalise une valeur PoE vers une clé canonique : '24v' | '48v' | '48VH' | false (Off).
function _poeKey(poe) {
  if (poe === false || poe === null || poe === undefined) return false;
  var up = String(poe).toUpperCase();
  if (up === 'OFF' || up === 'FALSE' || up === '') return false;
  if (up.indexOf('VH') !== -1) return '48VH';
  if (up === '48V') return '48v';
  if (up === '24V') return '24v';
  return false;
}

var _POE_ORDER = ['24v', '48v', '48VH'];  // puissance croissante

// Capacités PoE par type pour le modèle du switch, ou null si modèle inconnu (= pas de restriction).
function poeCapsFor(sw) {
  if (!sw || !sw.model) return null;
  var m = modelsStore.findByKey(sw.model);
  if (!m) return null;
  return {
    '24v' : parseRanges(m.poe_24v_ports || ''),
    '48v' : parseRanges(m.poe_48v_ports || ''),
    '48VH': parseRanges(m.poe_vh_ports  || ''),
  };
}

function _portSupports(caps, portNum, key) {
  if (!caps) return true;  // modèle inconnu → on ne restreint pas
  var arr = caps[key];
  return Array.isArray(arr) && arr.indexOf(portNum) !== -1;
}

// Résout le PoE effectif d'un port : si le type demandé n'est pas supporté, on rétrograde
// vers le type supporté le plus puissant en-dessous, sinon Off. Renvoie { poe, changed }.
function resolvePoeForPort(caps, portNum, requested) {
  var key = _poeKey(requested);
  if (!key) return { poe: false, changed: false };          // Off toujours autorisé
  if (_portSupports(caps, portNum, key)) return { poe: requested, changed: false };
  var idx = _POE_ORDER.indexOf(key);
  for (var i = idx - 1; i >= 0; i--) {
    if (_portSupports(caps, portNum, _POE_ORDER[i])) return { poe: _POE_ORDER[i], changed: true };
  }
  return { poe: false, changed: true };                     // aucun type supporté → Off
}

async function pushConfig(sw, patch) {
  var auth   = await getAuth(sw);
  var result = await get(sw, '/api/v1/config', auth);
  var config = result.data;

  var nativePorts = JSON.parse(JSON.stringify(config.Ports || []));
  var nativeVlans = JSON.parse(JSON.stringify(config.VLANs || []));
  var portCount   = nativePorts.length;

  var poeCaps    = poeCapsFor(sw);
  var downgraded = [];

  var patchPorts = patch.ports || {};
  Object.keys(patchPorts).forEach(function(numStr) {
    var portNum = parseInt(numStr);
    var cfg     = patchPorts[numStr];
    var portObj = null;
    for (var i = 0; i < nativePorts.length; i++) {
      if (nativePorts[i].Number === portNum) { portObj = nativePorts[i]; break; }
    }
    if (!portObj) return;
    if (cfg.description !== undefined && cfg.description !== null) portObj.Name   = cfg.description;
    if (cfg.enabled !== undefined)                                  portObj.Enable = cfg.enabled !== false;
    if (cfg.poe !== undefined) {
      // Sécurité : chaque type de PoE n'est appliqué que sur les ports déclarés capables.
      var resolved = resolvePoeForPort(poeCaps, portNum, cfg.poe);
      if (resolved.changed) downgraded.push(portNum);
      portObj.PoE = toNativePoe(resolved.poe);
    }
    if (cfg.stp !== undefined)                                      portObj.STP    = !!cfg.stp;
  });

  // ── Trunk global : champ AllowedVLANs par port ──────────────────────────────
  // "1-4096" = port trunk (tous les VLANs autorisés) ; "" = non trunk.
  // Non touché si patch.allPortsTrunk est indéfini.
  if (patch.allPortsTrunk !== undefined) {
    var allowedVal = patch.allPortsTrunk ? '1-4096' : '';
    nativePorts.forEach(function (p) { p.AllowedVLANs = allowedVal; });
  }

  var portVlanMap = {};
  Object.keys(patchPorts).forEach(function(numStr) {
    var portNum = parseInt(numStr);
    var cfg     = patchPorts[numStr];
    portVlanMap[portNum] = { pvid: cfg.pvid || 1, tagged: cfg.tagged || [] };
  });

  // ── VLANs : on ne conserve QUE ceux de la config poussée ────────────────────
  // Les VLANs présents sur le switch mais absents du patch sont supprimés.
  // Les VLANs conservés réutilisent leur objet natif (préserve IPv4, IGMP, etc.).
  var patchVlans = patch.vlans || [];
  var newVlans;
  if (patchVlans.length === 0) {
    newVlans = nativeVlans;   // sécurité : table vide → on ne supprime aucun VLAN
  } else {
    newVlans = patchVlans.map(function (pv) {
      var pvId = parseInt(pv.id || pv.ID);
      if (!pvId) return null;
      var existing = nativeVlans.find(function (v) { return parseInt(v.ID) === pvId; });
      var vlan = existing || {
        ID: String(pvId), Enable: true,
        PortSettings: new Array(portCount + 1).join('E'),
        IPv4_Enable: false, IPv4_Address: '', IPv4_Netmask: '',
        IPv6_Enable: false, IPv6_Address: '', IGMP_Querier: false,
      };
      if (pv.name || pv.Name) vlan.Name = pv.name || pv.Name;
      if (!vlan.Name) vlan.Name = 'VLAN ' + pvId;
      return vlan;
    }).filter(Boolean);
  }

  // ── PortSettings : U = natif (PVID), T = tagged, E = exclu ───────────────────
  newVlans.forEach(function(vlan) {
    var vlanId   = parseInt(vlan.ID);
    var settings = (vlan.PortSettings || '').split('');
    while (settings.length < portCount) settings.push('E');
    for (var idx = 0; idx < settings.length; idx++) {
      var vm = portVlanMap[idx + 1];
      if (!vm) continue;   // port non géré par le patch → état existant conservé
      if (vm.pvid === vlanId)                    settings[idx] = 'U';
      else if (vm.tagged.indexOf(vlanId) !== -1) settings[idx] = 'T';
      else                                       settings[idx] = 'E';
    }
    vlan.PortSettings = settings.join('');
  });

  var merged = Object.assign({}, config, { Ports: nativePorts, VLANs: newVlans });
  Object.keys(patch).forEach(function(k) {
    if (k !== 'ports' && k !== 'vlans' && k !== 'allPortsTrunk') merged[k] = patch[k];
  });
  await post(sw, '/api/v1/config', merged, auth);

  // Fenêtre d'apply : on verrouille pour interdire tout re-login (planterait le switch).
  _applying[sw.ip] = true;
  var confirmed;
  try {
    await post(sw, '/api/v1/apply', {}, auth);
    confirmed = await confirmApply(sw, auth);
  } finally {
    delete _applying[sw.ip];
  }
  return { downgraded: downgraded, confirmed: confirmed };
}

async function resetConfig(sw, options) {
  if (!options) options = {};
  var auth      = await getAuth(sw);
  var result    = await get(sw, '/api/v1/config', auth);
  var config    = result.data;
  var newConfig = {
    Switch_Name : config.Switch_Name || config.hostname,
    IPv4_Address: config.IPv4_Address || config.ip,
    IPv4_Netmask: config.IPv4_Netmask || config.netmask,
    IPv4_Gateway: config.IPv4_Gateway || config.gateway,
    VLANs       : options.vlans || config.VLANs || config.vlans || [],
    Ports       : config.Ports  || config.ports  || [],
  };
  await post(sw, '/api/v1/config', newConfig, auth);

  _applying[sw.ip] = true;
  var confirmed;
  try {
    await post(sw, '/api/v1/apply', {}, auth);
    confirmed = await confirmApply(sw, auth);
  } finally {
    delete _applying[sw.ip];
  }
  return { hostname: newConfig.Switch_Name, ip: newConfig.IPv4_Address, confirmed: confirmed };
}

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

async function reboot(sw) {
  var auth = await getAuth(sw);
  await post(sw, '/api/v1/reboot', {}, auth);
  return true;
}

async function portStats(sw, portNum) {
  var result = await get(sw, '/api/v1/portdetail?port=' + portNum);
  var data = result.data;
  // Le switch retourne { PortDetail: {...} } — on unwrappe
  return (data && typeof data === 'object' && data.PortDetail) ? data.PortDetail : data;
}

// Statut temps réel : GET /api/v1/status/30sec renvoie { Ports: [{ Number, Link, PoE, Power, ... }], ... }
// Le champ Link vaut "1G" / "100M-F" / "10M-H" / "Down" (suffixe -F/-H = full/half duplex).
async function linkStatus(sw) {
  var result = await get(sw, '/api/v1/status/30sec?_=' + Date.now());
  return result.data;
}

function detectModel(config, models) {
  if (!models) models = [];
  if (!config) return null;

  // Cherche un champ hardware/model (plusieurs conventions de nommage)
  const hw = config.hardware || config.Hardware || config.model || config.Model
           || config.Switch_Model || config.hardware_model || config.HW_Version || '';
  if (hw) {
    const match = models.find(m => hw.toUpperCase().includes(m.key.toUpperCase()));
    if (match) return match.key;
  }

  // Fallback : nombre de ports (Netonix retourne config.Ports, pas config.ports)
  const ports = config.Ports || config.ports || [];
  const portCount = Array.isArray(ports) ? ports.length : Object.keys(ports).length;
  if (portCount > 0) {
    const byCount = models.filter(m => m.port_count === portCount).sort((a, b) => a.builtin - b.builtin);
    if (byCount.length) return byCount[0].key;
  }
  return null;
}

module.exports = { login, getAuth, invalidateSession, get, post, getConfig, pushConfig, resetConfig, ping, reboot, portStats, linkStatus, detectModel };
