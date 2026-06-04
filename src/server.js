'use strict';

// Charge les variables d'environnement depuis .env si présent
try { require('fs').readFileSync('.env', 'utf8').split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && !k.startsWith('#') && !(k.trim() in process.env))
    process.env[k.trim()] = v.join('=').trim();
}); } catch {}

const express       = require('express');
const path          = require('path');
const { PORT }      = require('./config');
const swRoutes      = require('./routes/switches');
const presetsRoutes = require('./routes/presets');
const modelsRoutes  = require('./routes/models');
const scanRoutes    = require('./routes/scan');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// API
app.use('/api/switches', swRoutes);
app.use('/api/presets',  presetsRoutes);
app.use('/api/models',   modelsRoutes);
app.use('/api/scan',     scanRoutes);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  Netonix Manager  ->  http://localhost:${PORT}\n`);
});
