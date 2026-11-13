'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { estimateChannelCostInr, RATES, GST_RATE } = require('../lib/m360-rates');

describe('Stage 4: Real Cost Preview from Rates Table', () => {
  it('asserts a 100-recipient marketing WhatsApp estimate = 100 * 0.8631 * 1.18 = 101.8458', () => {
    const cost = estimateChannelCostInr({
      channel: 'WhatsApp',
      templateCategory: 'marketing',
      recipientCount: 100
    });
    const expected = Number((100 * 0.8631 * 1.18).toFixed(4));
    assert.equal(expected, 101.8458);
    assert.equal(cost, 101.8458);
  });

  it('asserts utility WhatsApp rate is 0.1150 + 18% GST', () => {
    const cost = estimateChannelCostInr({
      channel: 'WhatsApp',
      templateCategory: 'utility',
      recipientCount: 50
    });
    const expected = Number((50 * 0.1150 * 1.18).toFixed(4));
    assert.equal(cost, expected);
  });

  it('asserts email rate is 0.01 + 18% GST', () => {
    const cost = estimateChannelCostInr({
      channel: 'Email',
      recipientCount: 1000
    });
    const expected = Number((1000 * 0.01 * 1.18).toFixed(4));
    assert.equal(cost, expected);
  });

  it('returns 0 for zero recipients', () => {
    assert.equal(estimateChannelCostInr({ channel: 'WhatsApp', recipientCount: 0 }), 0);
  });
});
