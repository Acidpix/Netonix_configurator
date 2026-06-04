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
  const portPvid = portCfg.pvid !== undefined ? portCfg.pvid : 1;

  var rawTagged = portCfg.tagged || portCfg.vlans_tagged || portCfg.trunk || [];
  var portTagged;
  if (Array.isArray(rawTagged)) {
    portTagged = rawTagged.slice().sort(function(a, b) { return a - b; });
  } else if (rawTagged && typeof rawTagged === 'object') {
    portTagged = Object.keys(rawTagged).map(Number).sort(function(a, b) { return a - b; });
  } else {
    portTagged = [];
  }

  var presets = presetsStore.loadAll();
  for (var i = 0; i < presets.length; i++) {
    var p = presets[i];
    if (p.pvid !== portPvid) continue;
    var presetTagged = (Array.isArray(p.tagged) ? p.tagged : []).slice().sort(function(a, b) { return a - b; });
    if (JSON.stringify(presetTagged) === JSON.stringify(portTagged)) return p.key;
  }
  return null;
}

module.exports = { toPortConfig, detectPreset };
