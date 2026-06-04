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
 * Heuristique : devine le preset d'un port depuis sa config JSON Netonix.
 */
function detectPreset(portCfg) {
  if (!portCfg || portCfg.enabled === false) return 'disabled';
  const { pvid = 1, tagged = [] } = portCfg;
  if (tagged.length > 3) return 'ap';
  if (tagged.length > 0) return 'uplink';
  if (pvid === 30)        return 'cam';
  if (pvid === 40)        return 'voip';
  if (pvid === 20)        return 'server';
  return null;
}

module.exports = { toPortConfig, detectPreset };
