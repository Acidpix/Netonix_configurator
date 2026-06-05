'use strict';

const fetch        = require('node-fetch');
const https        = require('https');
const { execFile } = require('child_process');
const { SWITCH_TIMEOUT, IGNORE_SSL } = require('./config');

const sslAgent = new https.Agent({ rejectUnauthorized: !IGNORE_SSL });

// ── Cache de session ───────────────────────────────────────────────────────────
// Session conservée indéfiniment : on ne reloggue que si le switch refuse (401).
// Un seul login est lancé à la fois par switch (déduplication via Promise).
const _sessions  = {};  // { ip: { auth } }
const _loggingIn = {};  // { ip: Promise<auth> }  — login en cours

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
  if (res.status === 401) {
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
  if (res.status === 401) {
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

function toNativePoe(poe) {
  if (!poe || poe === false || poe === 'false' || poe === 'Off') return 'Off';
  if (poe === '24v')                      return '24V';
  if (poe === '48v')                      return '48V';
  if (poe === '48VH' || poe === '48vHV') return '48VH';
  return String(poe);
}

async function pushConfig(sw, patch) {
  var auth   = await getAuth(sw);
  var result = await get(sw, '/api/v1/config', auth);
  var config = result.data;

  var nativePorts = JSON.parse(JSON.stringify(config.Ports || []));
  var nativeVlans = JSON.parse(JSON.stringify(config.VLANs || []));
  var portCount   = nativePorts.length;

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
    if (cfg.poe !== undefined)                                      portObj.PoE    = toNativePoe(cfg.poe);
    if (cfg.stp !== undefined)                                      portObj.STP    = !!cfg.stp;
  });

  var portVlanMap = {};
  Object.keys(patchPorts).forEach(function(numStr) {
    var portNum = parseInt(numStr);
    var cfg     = patchPorts[numStr];
    portVlanMap[portNum] = { pvid: cfg.pvid || 1, tagged: cfg.tagged || [] };
  });

  var patchVlans = patch.vlans || [];
  patchVlans.forEach(function(pv) {
    var pvId = parseInt(pv.id || pv.ID);
    if (!pvId) return;
    var exists = nativeVlans.some(function(v) { return parseInt(v.ID) === pvId; });
    if (!exists) {
      nativeVlans.push({
        ID: String(pvId), Name: pv.name || pv.Name || ('VLAN ' + pvId),
        Enable: true, PortSettings: new Array(portCount + 1).join('N'),
        IPv4_Enable: false, IPv4_Address: '', IPv4_Netmask: '',
        IPv6_Enable: false, IPv6_Address: '', IGMP_Querier: false,
      });
    } else {
      nativeVlans.forEach(function(v) {
        if (parseInt(v.ID) === pvId && (pv.name || pv.Name)) v.Name = pv.name || pv.Name;
      });
    }
  });

  nativeVlans.forEach(function(vlan) {
    var vlanId   = parseInt(vlan.ID);
    var settings = (vlan.PortSettings || '').split('');
    while (settings.length < portCount) settings.push('N');
    Object.keys(portVlanMap).forEach(function(numStr) {
      var portNum = parseInt(numStr);
      var idx     = portNum - 1;
      if (idx < 0 || idx >= settings.length) return;
      var vm = portVlanMap[portNum];
      if (vm.pvid === vlanId)                  settings[idx] = 'U';
      else if (vm.tagged.indexOf(vlanId) !== -1) settings[idx] = 'T';
      else                                     settings[idx] = 'N';
    });
    vlan.PortSettings = settings.join('');
  });

  var merged = Object.assign({}, config, { Ports: nativePorts, VLANs: nativeVlans });
  Object.keys(patch).forEach(function(k) {
    if (k !== 'ports' && k !== 'vlans') merged[k] = patch[k];
  });
  await post(sw, '/api/v1/config', merged, auth);
  await post(sw, '/api/v1/apply', {}, auth);
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
  await post(sw, '/api/v1/apply', {}, auth);
  return { hostname: newConfig.Switch_Name, ip: newConfig.IPv4_Address };
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

module.exports = { login, getAuth, invalidateSession, get, post, getConfig, pushConfig, resetConfig, ping, reboot, portStats, detectModel };
