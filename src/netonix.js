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
 * Extrait le premier cookie de session depuis les headers Set-Cookie.
 * Accepte n'importe quel nom de cookie.
 */
function extractCookie(res) {
  var setCookie = res.headers.get('set-cookie') || '';
  // Prend le premier cookie (avant le premier ;)
  var match = setCookie.match(/^([^;]+)/);
  return match ? match[1].trim() : null;
}

/**
 * Tente une méthode de login.
 * Retourne { header: 'Cookie: ...' ou 'Authorization: Bearer ...' } ou null.
 */
async function tryLogin(sw, method) {
  try {
    var res;
    var formBody = 'username=' + encodeURIComponent(sw.username) + '&password=' + encodeURIComponent(sw.password);
    if (method === 'fcgi') {
      res = await fetch(baseUrl(sw) + '/index.fcgi', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody, agent: agent(sw), timeout: SWITCH_TIMEOUT, redirect: 'manual',
      });
    } else if (method === 'api-json') {
      res = await fetch(baseUrl(sw) + '/api/v1/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: sw.username, password: sw.password }),
        agent: agent(sw), timeout: SWITCH_TIMEOUT, redirect: 'manual',
      });
    } else {
      res = await fetch(baseUrl(sw) + '/api/v1/login', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody, agent: agent(sw), timeout: SWITCH_TIMEOUT, redirect: 'manual',
      });
    }

    console.log('[login/' + method + '] status=' + res.status + ' set-cookie=' + (res.headers.get('set-cookie') || '(none)'));
    if (![200, 201, 301, 302].includes(res.status)) return null;

    // 1. Cookie dans Set-Cookie (n'importe quel nom)
    var cookie = extractCookie(res);
    if (cookie) return { Cookie: cookie };

    // 2. Token dans header custom
    var xToken = res.headers.get('x-auth-token') || res.headers.get('x-session-token') || res.headers.get('authorization');
    if (xToken) return { Authorization: xToken.startsWith('Bearer ') ? xToken : 'Bearer ' + xToken };

    // 3. Token dans le body JSON
    try {
      var text = await res.text();
      if (text) {
        var body = JSON.parse(text);
        var token = body.token || body.session || body.access_token || body.sessionId
                 || body.Session || body.Token || body.sid || body.key || null;
        if (token) return { Authorization: 'Bearer ' + token };
      }
    } catch (e) {}

    return null;
  } catch (e) { return null; }
}

/**
 * Authentifie en testant les méthodes dans l'ordre.
 * Valide chaque credential obtenu sur /api/v1/config avant de le retourner.
 * Retourne un objet { headers } prêt à injecter dans les requêtes API.
 */
async function login(sw) {
  var methods = ['api-json', 'fcgi', 'api-form'];

  for (var i = 0; i < methods.length; i++) {
    var auth = await tryLogin(sw, methods[i]);
    if (!auth) continue;

    // Valide sur l'API
    try {
      var res = await fetch(baseUrl(sw) + '/api/v1/config', {
        headers: auth, agent: agent(sw), timeout: SWITCH_TIMEOUT,
      });
      if (res.status !== 401) return auth;
    } catch (e) {
      return auth; // erreur réseau → on fait confiance
    }
  }

  throw new Error('Authentification échouée — vérifiez les credentials du switch');
}

/**
 * GET JSON depuis le switch.
 */
async function get(sw, endpoint) {
  var auth = await login(sw);
  var res  = await fetch(baseUrl(sw) + endpoint, {
    headers : auth,
    agent   : agent(sw),
    timeout : SWITCH_TIMEOUT,
  });
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
