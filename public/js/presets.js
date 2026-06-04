'use strict';

const PRESETS = {
  cam: {
    label : 'Caméra IP',
    cls   : 'p-cam',
    icon  : '📷',
    color : 'var(--pink)',
    poe   : true,
    pvid  : 30,
    tagged: [],
    desc  : 'VLAN 30 · PoE ON · Storm-control · STP portfast',
  },
  ap: {
    label : 'AP WiFi',
    cls   : 'p-ap',
    icon  : '📡',
    color : 'var(--accent)',
    poe   : true,
    pvid  : 10,
    tagged: [10, 20, 30, 40, 50],
    desc  : 'Trunk multi-VLAN · PoE ON · STP portfast',
  },
  uplink: {
    label : 'Uplink / Trunk',
    cls   : 'p-uplink',
    icon  : '⬆️',
    color : 'var(--teal)',
    poe   : false,
    pvid  : 1,
    tagged: [1, 10, 20, 30, 40, 50],
    desc  : 'Trunk tous VLANs · PoE OFF',
  },
  voip: {
    label : 'VoIP',
    cls   : 'p-voip',
    icon  : '📞',
    color : 'var(--amber)',
    poe   : true,
    pvid  : 40,
    tagged: [10],
    desc  : 'VLAN 40 + data VLAN 10 · PoE ON · QoS DSCP',
  },
  server: {
    label : 'Serveur / NAS',
    cls   : 'p-server',
    icon  : '🖥',
    color : 'var(--purple)',
    poe   : false,
    pvid  : 20,
    tagged: [],
    desc  : 'VLAN 20 · PoE OFF',
  },
  disabled: {
    label : 'Désactivé',
    cls   : 'p-disabled',
    icon  : '🚫',
    color : 'var(--text3)',
    poe   : false,
    pvid  : 1,
    tagged: [],
    desc  : 'Shutdown administratif · PoE OFF',
  },
};

// Heuristique : devine le preset d'un port depuis sa config JSON Netonix
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
