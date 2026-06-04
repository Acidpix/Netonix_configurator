'use strict';

const express      = require('express');
const presetsStore = require('../presetsStore');
const router       = express.Router();

// GET /api/presets
router.get('/', (req, res) => {
  res.json(presetsStore.loadAll());
});

// POST /api/presets — nouveau preset
router.post('/', (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'key requis' });
  if (presetsStore.findByKey(key)) return res.status(409).json({ error: `Preset "${key}" existe déjà` });
  try {
    res.status(201).json(presetsStore.upsert(key, req.body));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/presets/:key — modifier
router.put('/:key', (req, res) => {
  try {
    res.json(presetsStore.upsert(req.params.key, req.body));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/presets/:key
router.delete('/:key', (req, res) => {
  presetsStore.remove(req.params.key);
  res.json({ ok: true });
});

module.exports = router;
