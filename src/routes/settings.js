'use strict';

const express = require('express');
const { get, set, getAll } = require('../settingsStore');
const router = express.Router();

// GET /api/settings — retourne tous les settings
router.get('/', (req, res) => {
  const all = getAll();
  const obj = {};
  all.forEach(({ key, value }) => { obj[key] = value; });
  res.json(obj);
});

// GET /api/settings/:key
router.get('/:key', (req, res) => {
  const value = get(req.params.key);
  res.json({ key: req.params.key, value });
});

// PUT /api/settings/:key  { value: "..." }
router.put('/:key', (req, res) => {
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: 'value requis' });
  const result = set(req.params.key, String(value));
  res.json(result);
});

module.exports = router;
