'use strict';

/**
 * Presets de configuration par type d'équipement.
 * Chaque preset est converti en structure de port Netonix lors du push.
 */
const PRESETS = {
  cam: {
    label        : 'Caméra IP',
    pvid         : 30,
    tagged       : [],
    poe          : true,
    enabled      : true,
    storm_control : true,
    stp          : true,
    qos          : false,
    description  : 'IP Camera',
  },
  ap: {
    label        : 'AP WiFi',
    pvid         : 10,
    tagged       : [10, 20, 30, 40, 50],
    poe          : true,
    enabled      : true,
    storm_control : false,
    stp          : true,
    qos          : false,
    description  : 'WiFi Access Point',
  },
  uplink: {
    label        : 'Uplink / Trunk',
    pvid         : 1,
    tagged       : [1, 10, 20, 30, 40, 50],
    poe          : false,
    enabled      : true,
    storm_control : false,
    stp          : false,
    qos          : false,
    description  : 'Uplink',
  },
  voip: {
    label        : 'VoIP',
    pvid         : 40,
    tagged       : [10],
    poe          : true,
    enabled      : true,
    storm_control : false,
    stp          : true,
    qos          : true,
    description  : 'VoIP Phone',
  },
  server: {
    label        : 'Serveur / NAS',
    pvid         : 20,
    tagged       : [],
    poe          : false,
    enabled      : true,
    storm_control : false,
    stp          : false,
    qos          : false,
    description  : 'Server',
  },
  disabled: {
    label        : 'Désactivé',
    pvid         : 1,
    tagged       : [],
    poe          : false,
    enabled      : false,
    storm_control : false,
    stp          : false,
    qos          : false,
    description  : 'Disabled',
  },
};

/**
 * Convertit un preset en structure de port compatible Netonix.
 * @param {string} key  - clé du preset
 * @returns {object}    - objet port prêt à insérer dans config.ports
 */
function toPortConfig(key) {
  const p = PRESETS[key];
  if (!p) throw new Error(`Preset inconnu : ${key}`);
  return {
    enabled      : p.enabled,
    poe          : p.poe,
    pvid         : p.pvid,
    tagged       : p.tagged,
    description  : p.description,
    storm_control : p.storm_control,
    stp          : p.stp,
    qos          : p.qos,
  };
}

/**
 * Heuristique : devine le preset d'un port depuis sa config JSON Netonix.
 * @param {object} portCfg - config d'un port issue de /api/v1/config
 * @returns {string|null}  - clé de preset ou null
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

module.exports = { PRESETS, toPortConfig, detectPreset };
