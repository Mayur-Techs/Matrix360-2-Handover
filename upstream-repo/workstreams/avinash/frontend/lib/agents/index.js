'use strict';

const registry = require('./registry');
const tools = require('./tools');
const bus = require('./bus');
const supervisor = require('./supervisor');

module.exports = {
  ...registry,
  ...tools,
  ...bus,
  ...supervisor
};
