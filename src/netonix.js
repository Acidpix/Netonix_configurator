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
 * Authentifie et retourne le cookie de session.
 * Supporte deux formats :
 * - Ancien : POST /api/v1/login avec JSON
 * - Nouveau (1.5.25+) : POST / avec form-urlencoded
 */
async function login(sw) {
  const body = `username=${encodeURIComponent(sw.username)}&password=${encodeURIComponent(sw.password)}`;
  const res = await fetch(`${baseUrl(sw)}/index.fcgi`, {
    method  : 'POST',
    headers : { 'Content-Type': 'application/x-www-form-urlencoded' },
    body    : body,
    agent   : agent(sw),
    timeout : SWITCH_TIMEOUT,
    redirect: 'manual',
  });

  if (![200, 301, 302].includes(res.status)) {
    throw new Error(`Authentification échouée : HTTP ${res.status} — vérifiez les credentials`);
  }

  const setCookie = res.headers.get('set-cookie') || '';
  const match = setCookie.match(/(?:PHPSESSID|session)=([^;]+)/i);
  if (!match) throw new Error('Aucun cookie de session reçu — vérifiez les credentials');
  return `${match[0]}`;
}

/**
 * GET JSON depuis le switch.
 */
async function get(sw, endpoint) {
  const cookie = await login(sw);
  const res    = await fetch(`${baseUrl(sw)}${endpoint}`, {
    headers : { Cookie: cookie },
    agent   : agent(sw),
    timeout : SWITCH_TIMEOUT,
  });
  if (!res.ok) throw new Error(`GET ${endpoint} → HTTP ${res.status}`);
  return { data: await res.json(), cookie };
}

/**
 * POST JSON vers le switch, réutilise un cookie existant si fourni.
 */
async function post(sw, endpoint, body = {}, cookie = null) {
  if (!cookie) cookie = await login(sw);
  const res = await fetch(`${baseUrl(sw)}${endpoint}`, {
    method  : 'POST',
    headers : { 'Content-Type': 'application/json', Cookie: cookie },
    body    : JSON.stringify(body),
    agent   : agent(sw),
    timeout : SWITCH_TIMEOUT,
  });
  if (!res.ok) throw new Error(`POST ${endpoint} → HTTP ${res.status}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

/**
 * Récupère la config complète.
 */
async function getConfig(sw) {
  const { data, cookie } = await get(sw, '/api/v1/config');
  return { config: data, cookie };
}

/**
 * Sauvegarde + applique une config (merge avec l'existante pour préserver
 * les champs non gérés par l'interface).
 */
async function pushConfig(sw, patch) {
  const cookie     = await login(sw);
  const { config } = await getConfig({ ...sw, _cookie: cookie });

  const merged = { ...config, ...patch };

  await post(sw, '/api/v1/config', merged, cookie);
  await post(sw, '/api/v1/apply', {}, cookie);
}

/**
 * Reset propre : reconstruit une config minimale en conservant
 * hostname, ip, netmask, gateway du switch réel.
 */
async function resetConfig(sw, { vlans, ports } = {}) {
  const cookie       = await login(sw);
  const { config }   = await getConfig({ ...sw });

  const newConfig = {
    hostname : config.hostname,
    ip       : config.ip,
    netmask  : config.netmask,
    gateway  : config.gateway,
    vlans    : vlans  || config.vlans,
    ports    : ports  || {},
  };

  await post(sw, '/api/v1/config', newConfig, cookie);
  await post(sw, '/api/v1/apply', {}, cookie);
  return { hostname: newConfig.hostname, ip: newConfig.ip };
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
  const { data } = await get(sw, `/api/v1/portdetail?port=${portNum}`);
  return data;
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
