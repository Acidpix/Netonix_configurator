'use strict';

const express      = require('express');
const net          = require('net');
const { getConfig, detectModel } = require('../netonix');
const { get }      = require('../settingsStore');
const modelsStore  = require('../modelsStore');
const router       = express.Router();

function tcpCheck(ip, port, timeout = 600) {
  return new Promise(resolve => {
    const sock = new net.Socket();
    let settled = false;
    const done = (ok) => { if (!settled) { settled = true; sock.destroy(); resolve(ok); } };
    sock.setTimeout(timeout);
    sock.on('connect', () => done(true));
    sock.on('error',   () => done(false));
    sock.on('timeout', () => done(false));
    sock.connect(port, ip);
  });
}

function expandCidr(subnet) {
  const [network, prefixStr] = subnet.split('/');
  const bits = parseInt(prefixStr || '24');
  if (bits < 20) throw new Error('Subnet trop large — min /20 (~4000 hôtes)');
  if (bits > 30) throw new Error('Subnet trop petit — max /30');

  const parts = network.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255))
    throw new Error('Adresse IP invalide');

  const netInt   = parts.reduce((acc, v) => ((acc << 8) | v) >>> 0, 0);
  const mask     = bits === 32 ? 0xFFFFFFFF : (~(0xFFFFFFFF >>> bits)) >>> 0;
  const net      = (netInt & mask) >>> 0;
  const bcast    = (net | (~mask >>> 0)) >>> 0;

  const ips = [];
  for (let i = net + 1; i < bcast; i++) {
    ips.push(`${(i >>> 24) & 255}.${(i >>> 16) & 255}.${(i >>> 8) & 255}.${i & 255}`);
  }
  return ips;
}

async function getDeviceInfo(ip, https) {
  try {
    const username = get('scan_default_username', 'admin');
    const password = get('scan_default_password', 'netonix');
    const result = await getConfig({ ip, https, username, password });
    const raw    = result.config || {};
    const model  = detectModel(raw, modelsStore.loadAll());
    return {
      hostname: raw.Switch_Name || raw.hostname || raw.sysname || null,
      location: raw.Switch_Location || raw.location || null,
      model   : model || null,
    };
  } catch {
    return { hostname: null, location: null, model: null };
  }
}

// POST /api/scan/probe  { ip, username, password, https } — récupère les infos d'un seul switch
router.post('/probe', async (req, res) => {
  const { ip, username, password, https: useHttps } = req.body;
  if (!ip) return res.status(400).json({ error: 'ip requis' });
  try {
    const result = await getConfig({
      ip,
      https   : !!useHttps,
      username: username || 'admin',
      password: password || 'netonix',
    });
    const raw   = result.config || {};
    const model = detectModel(raw, modelsStore.loadAll());
    res.json({
      hostname: raw.Switch_Name     || raw.hostname || null,
      location: raw.Switch_Location || raw.location || null,
      model   : model || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/scan  { subnet: "192.168.1.0/24" }
router.post('/', async (req, res) => {
  const { subnet } = req.body;
  if (!subnet) return res.status(400).json({ error: 'subnet requis (ex: 192.168.1.0/24)' });

  let ips;
  try { ips = expandCidr(subnet); } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const BATCH = 50;
  const found = [];

  try {
    for (let i = 0; i < ips.length; i += BATCH) {
      const batch   = ips.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(async function(ip) {
        try {
          var useHttps = false;
          if (await tcpCheck(ip, 443)) useHttps = true;
          else if (!(await tcpCheck(ip, 80))) return null;
          var info = await getDeviceInfo(ip, useHttps);
          return { ip: ip, https: useHttps, hostname: info.hostname, location: info.location, model: info.model };
        } catch (e) {
          return null;
        }
      }));
      found.push.apply(found, results.filter(Boolean));
    }
    res.json({ found: found, scanned: ips.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
