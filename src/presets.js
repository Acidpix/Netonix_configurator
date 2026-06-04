'use strict';

const presetsStore = require('./presetsStore');

/**
 * Convertit un preset en structure de port compatible Netonix.
 */
function toPortConfig(key) {
  const p = presetsStore.findByKey(key);
  if (!p) throw new Error(`Preset inconnu : ${key}`);
  return {
    enabled      : p.enabled,
    poe          : p.poe,
    pvid         : p.pvid,
    tagged       : p.tagged,
    description  : p.description,
    storm_control: p.storm_control,
    stp          : p.stp,
    qos          : p.qos,
  };
}

/**
 * Compare la config d'un port contre les presets en base.
 */
function detectPreset(portCfg) {
  if (!portCfg || portCfg.enabled === false) return 'disabled';
  const portPvid   = portCfg.pvid !== undefined ? portCfg.pvid : 1;
  const portTagged = (portCfg.tagged || []).slice().sort((a, b) => a - b);
  const presets    = presetsStore.loadAll();

  for (const p of presets) {
    if (p.pvid !== portPvid) continue;
    const presetTagged = (p.tagged || []).slice().sort((a, b) => a - b);
    if (JSON.stringify(presetTagged) === JSON.stringify(portTagged)) return p.key;
  }
  return null;
}

module.exports = { toPortConfig, detectPreset };
