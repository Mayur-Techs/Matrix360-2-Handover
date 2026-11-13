/**
 * Matrix360 Marketing Mode and Team-Testing Guardrails
 *
 * Controlled by:
 * - M360_MARKETING_MODE: 'draft_only' (default), 'team_test', 'live'
 * - M360_TEST_RECIPIENTS: comma-separated list of allowed tester emails and E.164 phone numbers
 * - M360_TEST_WORKSPACES: comma-separated list of allowed workspace IDs
 */

const VALID_MODES = new Set(['draft_only', 'team_test', 'live']);

function mode() {
  const raw = (process.env.M360_MARKETING_MODE || '').trim().toLowerCase();
  return VALID_MODES.has(raw) ? raw : 'draft_only';
}

function parseList(envVal) {
  if (!envVal || typeof envVal !== 'string') return [];
  return envVal
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function isTestRecipient(value) {
  if (!value || typeof value !== 'string') return false;
  const target = value.trim().toLowerCase();
  if (!target) return false;
  const allowed = parseList(process.env.M360_TEST_RECIPIENTS);
  if (allowed.length === 0) return false;
  return allowed.includes(target);
}

function isTestWorkspace(id) {
  if (id === undefined || id === null || id === '') return false;
  const target = String(id).trim().toLowerCase();
  if (!target) return false;
  const allowed = parseList(process.env.M360_TEST_WORKSPACES);
  if (allowed.length === 0) return false;
  return allowed.includes(target);
}

module.exports = {
  mode,
  isTestRecipient,
  isTestWorkspace
};
