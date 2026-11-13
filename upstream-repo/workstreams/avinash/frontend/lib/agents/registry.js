'use strict';

/**
 * Matrix360 Multi-Agent Registry
 *
 * Defines the 6 specialized agents, their purposes, and their allowed toolsets:
 * - research_agent: Project and market analysis
 * - audience_agent: Segmentation and consent verification
 * - content_agent: Copywriting and asset integration
 * - compliance_agent: Regulatory and bulk-sending rule compliance
 * - supervisor_agent: Pipeline coordination, quality gates, human approval routing
 * - outreach_agent: Final channel execution (requires server-verified approval)
 */

const AGENT_REGISTRY = Object.freeze({
  research_agent: Object.freeze({
    name: 'research_agent',
    displayName: 'Research Specialist',
    purpose: 'Market, competitor, and project research from verified sources',
    allowedTools: Object.freeze([
      'search_market_facts',
      'extract_website_assets',
      'fetch_crm_profile'
    ])
  }),
  audience_agent: Object.freeze({
    name: 'audience_agent',
    displayName: 'Audience Specialist',
    purpose: 'Audience segmentation, consent verification, and suppression filtering',
    allowedTools: Object.freeze([
      'query_crm_leads',
      'verify_lead_consent',
      'filter_suppressed_contacts'
    ])
  }),
  content_agent: Object.freeze({
    name: 'content_agent',
    displayName: 'Content & Creative Specialist',
    purpose: 'Multi-channel creative drafting, personalization, and copy revisions',
    allowedTools: Object.freeze([
      'generate_channel_copy',
      'load_creative_assets',
      'render_email_preview'
    ])
  }),
  compliance_agent: Object.freeze({
    name: 'compliance_agent',
    displayName: 'Compliance & Safety Specialist',
    purpose: 'CAN-SPAM, GDPR, WhatsApp policy, and Gmail/Yahoo bulk alignment checks',
    allowedTools: Object.freeze([
      'check_email_compliance',
      'check_whatsapp_template_compliance',
      'verify_domain_alignment'
    ])
  }),
  supervisor_agent: Object.freeze({
    name: 'supervisor_agent',
    displayName: 'Campaign Supervisor',
    purpose: 'Autonomous workflow orchestration, gate validation, and human approval requests',
    allowedTools: Object.freeze([
      'post_bus_directive',
      'evaluate_pipeline_gates',
      'request_human_approval'
    ])
  }),
  outreach_agent: Object.freeze({
    name: 'outreach_agent',
    displayName: 'Outreach Dispatcher',
    purpose: 'Controlled multi-channel dispatch through verified provider adapters',
    allowedTools: Object.freeze([
      'send_marketing_email',
      'send_whatsapp_message'
    ])
  })
});

function getAgent(name) {
  const norm = String(name || '').trim().toLowerCase();
  return AGENT_REGISTRY[norm] || null;
}

function listAgents() {
  return Object.values(AGENT_REGISTRY);
}

function isToolAllowed(agentName, toolName) {
  const agent = getAgent(agentName);
  if (!agent) return false;
  return agent.allowedTools.includes(toolName);
}

module.exports = {
  AGENT_REGISTRY,
  getAgent,
  listAgents,
  isToolAllowed
};
