'use strict';

const express      = require('express');
const modelsStore  = require('../modelsStore');
const router       = express.Router();

// GET /api/models
router.get('/', (req, res) => {
  res.json(modelsStore.loadAll());
});

// POST /api/models
router.post('/', (req, res) => {
  const { key, label, port_count } = req.body;
  if (!key || !label || !port_count)
    return res.status(400).json({ error: 'key, label, port_count requis' });
  if (modelsStore.findByKey(key))
    return res.status(409).json({ error: `Modèle "${key}" existe déjà` });
  try {
    res.status(201).json(modelsStore.insert({ key, label, port_count: parseInt(port_count) }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/models/:key
router.delete('/:key', (req, res) => {
  try {
    modelsStore.remove(req.params.key);
    res.json({ ok: true });
  } catch (e) {
    res.status(403).json({ error: e.message });
  }
});

module.exports = router;
