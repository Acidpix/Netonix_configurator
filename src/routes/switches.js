'use strict';

const express      = require('express');
const store        = require('../store');
const nx           = require('../netonix');
const { toPortConfig, detectPreset } = require('../presets');
const modelsStore  = require('../modelsStore');

const router = express.Router();

function sanitize(sw) {
  const { password, ...safe } = sw;
  return { ...safe, password: '***' };
}

// GET /api/switches
router.get('/', (req, res) => {
  res.json(store.load().map(sanitize));
});

// POST /api/switches
router.post('/', (req, res) => {
  const { name, ip, username, password, https: useHttps, group, model, location, snmp_location } = req.body;
  if (!name || !ip || !username || !password)
    return res.status(400).json({ error: 'Champs obligatoires : name, ip, username, password' });

  if (store.load().find(s => s.ip === ip))
    return res.status(409).json({ error: `Un switch avec l'IP ${ip} existe déjà` });

  const sw = store.insert({
    name, ip, username, password,
    https        : useHttps !== false,
    group        : group || 'Défaut',
    model        : model || 'WS-12',
    location     : location || '',
    snmp_location: snmp_location || '',
  });
  res.status(201).json(sanitize(sw));
});

// PUT /api/switches/:id
router.put('/:id', (req, res) => {
  const updated = store.update(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Switch introuvable' });
  res.json(sanitize(updated));
});

// DELETE /api/switches/:id
router.delete('/:id', (req, res) => {
  store.remove(req.params.id);
  res.json({ ok: true });
});

// GET /api/switches/:id/ping
router.get('/:id/ping', async (req, res) => {
  const sw = store.findById(req.params.id);
  if (!sw) return res.status(404).json({ error: 'Switch introuvable' });
  try {
    await nx.ping(sw);
    res.json({ online: true });
  } catch (e) {
    res.json({ online: false, error: e.message });
  }
});

// GET /api/switches/:id/config
router.get('/:id/config', async (req, res) => {
  const sw = store.findById(req.params.id);
  if (!sw) return res.status(404).json({ error: 'Switch introuvable' });
  try {
    const { config } = await nx.getConfig(sw);
    const detectedModel = nx.detectModel(config, modelsStore.loadAll());
    res.json({ ...config, _detectedModel: detectedModel });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/switches/:id/config — pousse + applique
router.post('/:id/config', async (req, res) => {
  const sw = store.findById(req.params.id);
  if (!sw) return res.status(404).json({ error: 'Switch introuvable' });
  try {
    const patch = { ...req.body };
    // Injecte la location SNMP si renseignée
    if (sw.snmp_location) {
      patch.system = { ...(patch.system || {}), location: sw.snmp_location };
    }
    const result = await nx.pushConfig(sw, patch);
    let message = 'Configuration appliquée avec succès';
    if (result && result.downgraded && result.downgraded.length) {
      message += ` — PoE non supporté sur le(s) port(s) ${result.downgraded.join(', ')} : rétrogradé automatiquement`;
    }
    if (result && result.confirmed === false) {
      message += ' — ⚠ confirmation anti-revert échouée : le switch risque de rétablir l\'ancienne config';
    }
    res.json({ ok: true, message, downgraded: (result && result.downgraded) || [], confirmed: result ? result.confirmed : null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/switches/:id/ports — applique un preset sur N ports
router.post('/:id/ports', async (req, res) => {
  const sw = store.findById(req.params.id);
  if (!sw) return res.status(404).json({ error: 'Switch introuvable' });

  const { ports, preset, vlans } = req.body;
  if (!Array.isArray(ports) || !ports.length)
    return res.status(400).json({ error: 'ports[] requis' });
  if (!preset)
    return res.status(400).json({ error: 'preset requis' });

  try {
    const portCfg      = toPortConfig(preset);
    const portsPayload = {};
    ports.forEach(n => { portsPayload[String(n)] = portCfg; });

    const patch = { ports: portsPayload };
    if (vlans) patch.vlans = vlans;

    const result = await nx.pushConfig(sw, patch);
    let message = `Preset "${preset}" appliqué sur les ports ${ports.join(', ')}`;
    if (result && result.downgraded && result.downgraded.length) {
      message += ` — PoE non supporté sur le(s) port(s) ${result.downgraded.join(', ')} : rétrogradé automatiquement`;
    }
    if (result && result.confirmed === false) {
      message += ' — ⚠ confirmation anti-revert échouée : le switch risque de rétablir l\'ancienne config';
    }
    res.json({ ok: true, message, downgraded: (result && result.downgraded) || [], confirmed: result ? result.confirmed : null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/switches/:id/reset — reset propre (conserve IP + nom)
router.post('/:id/reset', async (req, res) => {
  const sw = store.findById(req.params.id);
  if (!sw) return res.status(404).json({ error: 'Switch introuvable' });
  try {
    const result = await nx.resetConfig(sw, req.body);
    res.json({ ok: true, message: `Reset effectué — ${result.hostname} conserve l'IP ${result.ip}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/switches/:id/reboot — redémarre le switch
router.post('/:id/reboot', async (req, res) => {
  const sw = store.findById(req.params.id);
  if (!sw) return res.status(404).json({ error: 'Switch introuvable' });
  try {
    await nx.reboot(sw);
    res.json({ ok: true, message: `Redémarrage de "${sw.name}" lancé` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/switches/:id/linkstatus — statut de lien temps réel de tous les ports
router.get('/:id/linkstatus', async (req, res) => {
  const sw = store.findById(req.params.id);
  if (!sw) return res.status(404).json({ error: 'Switch introuvable' });
  try {
    const data = await nx.linkStatus(sw);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/switches/:id/stats/:port — stats temps réel d'un port
var _portStatsLogged = false;
router.get('/:id/stats/:port', async (req, res) => {
  const sw = store.findById(req.params.id);
  if (!sw) return res.status(404).json({ error: 'Switch introuvable' });
  try {
    const data = await nx.portStats(sw, req.params.port);
    if (!_portStatsLogged) {
      console.log('[portdetail] port', req.params.port, '->', JSON.stringify(data));
      _portStatsLogged = true;
    }
    res.json(data);
  } catch (e) {
    console.error('[portStats] port', req.params.port, ':', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
