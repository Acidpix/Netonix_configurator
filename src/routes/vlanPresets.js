'use strict';

const express           = require('express');
const vlanPresetsStore  = require('../vlanPresetsStore');
const router            = express.Router();

// GET /api/vlan-presets
router.get('/', (req, res) => {
  res.json(vlanPresetsStore.loadAll());
});

// POST /api/vlan-presets — nouveau preset VLAN
router.post('/', (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'key requis' });
  if (vlanPresetsStore.findByKey(key)) return res.status(409).json({ error: `Preset VLAN "${key}" existe déjà` });
  try {
    res.status(201).json(vlanPresetsStore.upsert(key, req.body));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/vlan-presets/:key — modifier
router.put('/:key', (req, res) => {
  try {
    res.json(vlanPresetsStore.upsert(req.params.key, req.body));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/vlan-presets/:key
router.delete('/:key', (req, res) => {
  vlanPresetsStore.remove(req.params.key);
  res.json({ ok: true });
});

module.exports = router;
