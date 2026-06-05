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

const fetch  = require('node-fetch');
const https  = require('https');
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

  // Méthode 2 : /api/v1/login JSON
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
 * GET JSON depuis le switch.
 */
async function get(sw, endpoint) {
  var auth = await login(sw);
  console.log('[get] ' + baseUrl(sw) + endpoint + ' auth=' + JSON.stringify(auth));
  var res  = await fetch(baseUrl(sw) + endpoint, {
    headers : auth,
    agent   : agent(sw),
    timeout : SWITCH_TIMEOUT,
  });
  console.log('[get] response status=' + res.status);
  if (!res.ok) throw new Error('GET ' + endpoint + ' → HTTP ' + res.status);
  return { data: await res.json(), auth: auth };
}

/**
 * POST JSON vers le switch, réutilise l'auth existante si fournie.
 */
async function post(sw, endpoint, body, auth) {
  if (!body) body = {};
  if (!auth) auth = await login(sw);
  var headers = Object.assign({ 'Content-Type': 'application/json' }, auth);
  var res = await fetch(baseUrl(sw) + endpoint, {
    method  : 'POST',
    headers : headers,
    body    : JSON.stringify(body),
    agent   : agent(sw),
    timeout : SWITCH_TIMEOUT,
  });
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
 * Sauvegarde + applique une config (merge avec l'existante).
 */
async function pushConfig(sw, patch) {
  var auth     = await login(sw);
  var result   = await get(sw, '/api/v1/config');
  var merged   = Object.assign({}, result.data, patch);
  await post(sw, '/api/v1/config', merged, auth);
  await post(sw, '/api/v1/apply', {}, auth);
}

/**
 * Reset propre : reconstruit une config minimale.
 */
async function resetConfig(sw, options) {
  if (!options) options = {};
  var auth     = await login(sw);
  var result   = await get(sw, '/api/v1/config');
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
 * Test de connectivité (login uniquement).
 */
async function ping(sw) {
  await login(sw);
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

module.exports = { login, get, post, getConfig, pushConfig, resetConfig, ping, portStats, detectModel };
