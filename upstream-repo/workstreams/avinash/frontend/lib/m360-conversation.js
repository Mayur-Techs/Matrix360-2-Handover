'use strict';

const { randomUUID } = require('node:crypto');
const durableStore = require('./m360-marketing-durable-store');

const conversationStore = new Map();

const CAMPAIGN_TOPIC_QUESTION = 'What should the campaign be about?';

function hasCampaignTopic(message) {
  if (typeof message !== 'string') return false;
  const topic = message.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
  const filler = /\b(?:please|do it|do|get to it|go ahead|proceed|continue|lets go|yes|ok|okay|sure|thanks|can you|i want|could you|start|launch|plan|prepare|draft|create|build|run|set up|an?|the|my|our|me|paid|new|email|marketing|outreach|campaign|for us|for me|for my business|for our company)\b/g;
  return topic.replace(filler, '').trim().length >= 3;
}

function addConversationMessage(conversation, role, content) {
  const text = String(content || '').trim().slice(0, 5000);
  if (!text) throw new Error('Conversation message is required.');
  const message = { message_id: randomUUID(), role, content: text, sequence: conversation.messages.length + 1, created_at: new Date().toISOString() };
  conversation.messages.push(message);
  conversation.updated_at = message.created_at;
  return message;
}

async function continueMarketingConversation(conversation, message) {
  if (message) addConversationMessage(conversation, 'user', message);
  if (!conversation.messages.some(item => item.role === 'user' && hasCampaignTopic(item.content))) {
    conversation.status = 'clarification_required';
    if (!conversation.messages.some(item => item.content === CAMPAIGN_TOPIC_QUESTION))
      addConversationMessage(conversation, 'assistant', CAMPAIGN_TOPIC_QUESTION);
  } else {
    conversation.status = 'ready_to_dispatch';
    addConversationMessage(conversation, 'assistant', 'Preparing a campaign draft from your topic and saved Company Details.');
  }
  conversationStore.set(`${conversation.workspace_id}:${conversation.conversation_id}`, conversation);
  await durableStore.saveConversation(conversation);
  return conversation;
}

async function createMarketingConversation({ workspaceId, message, parentTaskId = null } = {}) {
  if (!workspaceId) throw new Error('workspaceId is required.');
  const now = new Date().toISOString();
  const conversation = { schema_version: '1.0', conversation_id: randomUUID(), correlation_id: randomUUID(), parent_task_id: parentTaskId, workspace_id: workspaceId, status: 'clarification_required', execution_mode: 'deterministic_fallback', messages: [], created_at: now, updated_at: now };
  return continueMarketingConversation(conversation, message);
}

async function getMarketingConversation(workspaceId, conversationId) {
  const local = conversationStore.get(`${workspaceId}:${conversationId}`);
  if (local) return local;
  const stored = await durableStore.loadConversation(workspaceId, conversationId);
  if (stored) conversationStore.set(`${workspaceId}:${conversationId}`, stored);
  return stored;
}

function resetConversationStoreForTests() {
  conversationStore.clear();
}

function getConversationStore() {
  return conversationStore;
}

module.exports = {
  CAMPAIGN_TOPIC_QUESTION,
  hasCampaignTopic,
  addConversationMessage,
  continueMarketingConversation,
  createMarketingConversation,
  getMarketingConversation,
  resetConversationStoreForTests,
  getConversationStore
};
