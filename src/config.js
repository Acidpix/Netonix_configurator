'use strict';

const path = require('path');

module.exports = {
  PORT           : parseInt(process.env.PORT, 10) || 3000,
  DB_FILE        : path.resolve(process.env.DB_FILE    || path.join(__dirname, '..', 'data', 'netonix.db')),
  DATA_FILE      : path.resolve(process.env.DATA_FILE  || path.join(__dirname, '..', 'data', 'switches.json')),
  SWITCH_TIMEOUT : parseInt(process.env.SWITCH_TIMEOUT, 10) || 10000,
  IGNORE_SSL     : process.env.IGNORE_SSL !== 'false',
  DEFAULT_USERNAME: process.env.DEFAULT_USERNAME || 'admin',
  DEFAULT_PASSWORD: process.env.DEFAULT_PASSWORD || 'netonix',
};
