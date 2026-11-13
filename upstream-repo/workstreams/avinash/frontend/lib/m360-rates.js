'use strict';

/**
 * Matrix360 Real Channel Cost Estimator
 * Replaces hard-coded per-conversation myths with real per-message India rates + 18% GST.
 */

const RATES = {
  WhatsApp: {
    marketing: 0.8631,
    utility: 0.1150,
    authentication: 0.1150,
    service: 0.0
  },
  Email: {
    standard: 0.01
  },
  SMS: {
    standard: 0.15
  }
};

const GST_RATE = 0.18; // 18% GST in India

/**
 * Calculates estimated channel cost in INR based on real delivery pricing + GST.
 * @param {Object} options
 * @param {string} options.channel - 'WhatsApp', 'Email', 'SMS', etc.
 * @param {string} [options.templateCategory='marketing'] - 'marketing', 'utility', 'authentication'
 * @param {number} [options.recipientCount=0] - Number of target recipients
 * @returns {number} Cost in INR rounded to 4 decimals
 */
function estimateChannelCostInr({ channel = 'WhatsApp', templateCategory = 'marketing', recipientCount = 0 } = {}) {
  const count = Math.max(0, Number(recipientCount) || 0);
  if (count === 0) return 0;

  const ch = String(channel).trim();
  let baseRate = 0;

  if (/whatsapp/i.test(ch)) {
    const cat = String(templateCategory).toLowerCase();
    baseRate = RATES.WhatsApp[cat] !== undefined ? RATES.WhatsApp[cat] : RATES.WhatsApp.marketing;
  } else if (/email/i.test(ch)) {
    baseRate = RATES.Email.standard;
  } else if (/sms/i.test(ch)) {
    baseRate = RATES.SMS.standard;
  } else {
    baseRate = 0;
  }

  const baseCost = count * baseRate;
  const totalWithGst = baseCost * (1 + GST_RATE);
  return Number(totalWithGst.toFixed(4));
}

module.exports = {
  RATES,
  GST_RATE,
  estimateChannelCostInr
};
