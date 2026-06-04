'use strict';

const path = require('path');

module.exports = {
  PORT         : parseInt(process.env.PORT, 10) || 3000,
  DATA_FILE    : path.resolve(process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'switches.json')),
  SWITCH_TIMEOUT: parseInt(process.env.SWITCH_TIMEOUT, 10) || 10000,
  IGNORE_SSL   : process.env.IGNORE_SSL !== 'false',
};
