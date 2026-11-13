'use strict';

const { randomUUID } = require('node:crypto');
const { getAgent } = require('./registry');

// In-memory message store for fast bus / test suites
const IN_MEMORY_BUS = new Map();
const SEQUENCE_TRACKER = new Map();

/**
 * Dispatches an immutable agent message over the durable coordination bus
 */
async function sendMessage({
  workspaceId,
  correlationId,
  fromAgent,
  toAgent,
  intent,
  payload = {},
  status = 'pending'
} = {}) {
  if (!workspaceId || !correlationId || !fromAgent || !toAgent || !intent) {
    throw new Error('workspaceId, correlationId, fromAgent, toAgent, and intent are required.');
  }

  // Validate registered agents
  if (!getAgent(fromAgent)) {
    throw new Error(`Sender agent '${fromAgent}' is not registered in the agent registry.`);
  }
  if (!getAgent(toAgent)) {
    throw new Error(`Recipient agent '${toAgent}' is not registered in the agent registry.`);
  }

  const busKey = `${workspaceId}:${correlationId}`;
  const seq = (SEQUENCE_TRACKER.get(busKey) || 0) + 1;
  SEQUENCE_TRACKER.set(busKey, seq);

  const message = {
    id: randomUUID(),
    workspace_id: workspaceId,
    correlation_id: correlationId,
    sequence: seq,
    from_agent: fromAgent,
    to_agent: toAgent,
    intent,
    payload,
    status,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  if (!IN_MEMORY_BUS.has(busKey)) {
    IN_MEMORY_BUS.set(busKey, []);
  }
  IN_MEMORY_BUS.get(busKey).push(message);

  return message;
}

/**
 * Retrieves all chronological bus messages for a campaign task
 */
function getMessages(workspaceId, correlationId) {
  const busKey = `${workspaceId}:${correlationId}`;
  return (IN_MEMORY_BUS.get(busKey) || []).map(m => ({ ...m }));
}

/**
 * Retrieves pending messages waiting for a specific agent
 */
function getPendingMessages(workspaceId, correlationId, agentName) {
  const all = getMessages(workspaceId, correlationId);
  return all.filter(m => m.to_agent === agentName && m.status === 'pending');
}

/**
 * Updates message lifecycle state on the bus
 */
function updateMessageStatus(workspaceId, correlationId, messageId, status, resultPayload = null) {
  const busKey = `${workspaceId}:${correlationId}`;
  const list = IN_MEMORY_BUS.get(busKey) || [];
  const msg = list.find(m => m.id === messageId);
  if (msg) {
    msg.status = status;
    msg.updated_at = new Date().toISOString();
    if (resultPayload) {
      msg.payload = { ...msg.payload, result: resultPayload };
    }
  }
  return msg || null;
}

function resetBusForTests() {
  IN_MEMORY_BUS.clear();
  SEQUENCE_TRACKER.clear();
}

module.exports = {
  sendMessage,
  getMessages,
  getPendingMessages,
  updateMessageStatus,
  resetBusForTests
};
